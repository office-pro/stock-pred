"""Prediction pipeline: loads ensemble artifacts and scores symbols."""
import json
import os
from typing import Dict, List, Optional

import numpy as np

from .config import CORE_HORIZONS, HORIZONS, SEQUENCE_LENGTH, settings
from .data import attach_alt_data, load_candles, load_market_context
from .drift import assess_drift
from .price_policy import (
    CANONICAL_MODE,
    assert_same_mode,
    model_price_mode,
    require_canonical_candles,
)
from .provenance import stamp_provenance
from .registry import get_active
from .calibration import (
    DISCLAIMER as CALIBRATION_DISCLAIMER,
    apply_calibrator,
    load_calibrator,
    probabilities_to_dict,
)
from .features import FEATURE_COLUMNS, FEATURE_SET_VERSION, build_features
from .universes import normalize_universe
from .models.boosted import LgbmModel, XgbModel
from .models.ensemble import blend_probabilities, decide, expected_move
from .models.scaler import Scaler
from .models.sequence import LstmModel, TransformerModel
from .regressors import load_path_regressors, predict_path_targets


class HorizonModels:
    """Loaded artifact set for one horizon. LSTM/Transformer are optional."""

    def __init__(self, horizon: str, artifact_dir: str, registry_entry: Dict[str, object]):
        self.model_id = str(registry_entry["modelId"])
        self.artifact_dir = artifact_dir
        self.registry_entry = dict(registry_entry)
        metadata_path = os.path.join(artifact_dir, "metadata.json")
        if not os.path.exists(metadata_path):
            raise FileNotFoundError(
                f"ACTIVE model {self.model_id} for {horizon} is missing metadata.json "
                f"under artifactDir={artifact_dir}"
            )
        with open(metadata_path, "r", encoding="utf-8") as handle:
            self.metadata = json.load(handle)
        trained_feature_version = self.metadata.get("feature_version")
        if trained_feature_version and trained_feature_version != FEATURE_SET_VERSION:
            raise RuntimeError(
                f"Feature version mismatch for {horizon}: "
                f"artifact={trained_feature_version} serve={FEATURE_SET_VERSION}. "
                "Retrain or align FEATURE_SET_VERSION (train/serve parity)."
            )
        self.scaler = Scaler.load(os.path.join(artifact_dir, "scaler.json"))
        cal_path = os.path.join(artifact_dir, "calibration.json")
        self.calibrator = load_calibrator(cal_path)
        n_features = len(FEATURE_COLUMNS)
        self.xgb = XgbModel().load(os.path.join(artifact_dir, "xgboost.json"))
        self.lgbm = LgbmModel().load(os.path.join(artifact_dir, "lightgbm.txt"))
        self.path_regressors = load_path_regressors(artifact_dir)
        self.lstm = None
        self.transformer = None
        lstm_path = os.path.join(artifact_dir, "lstm.pt")
        transformer_path = os.path.join(artifact_dir, "transformer.pt")
        if os.path.exists(lstm_path):
            self.lstm = LstmModel(n_features).load(lstm_path)
        if os.path.exists(transformer_path):
            self.transformer = TransformerModel(n_features).load(transformer_path)

    def probabilities(self, x_scaled: np.ndarray) -> Dict[str, Optional[np.ndarray]]:
        latest = x_scaled[-1:]
        return {
            "xgboost": self.xgb.predict_proba(latest),
            "lightgbm": self.lgbm.predict_proba(latest),
            "lstm": self.lstm.predict_proba_last(x_scaled) if self.lstm is not None else None,
            "transformer": (
                self.transformer.predict_proba_last(x_scaled)
                if self.transformer is not None
                else None
            ),
        }


def clear_model_cache() -> None:
    """Drop in-process HorizonModels so the next predict reloads disk artifacts."""
    _cache.clear()


def models_available() -> bool:
    for horizon in CORE_HORIZONS:
        entry = get_active(horizon)
        artifact_dir = entry.get("artifactDir") if entry else None
        if not artifact_dir or not os.path.isdir(str(artifact_dir)):
            return False
        if not all(
            os.path.isfile(os.path.join(str(artifact_dir), name))
            for name in ("metadata.json", "xgboost.json", "lightgbm.txt")
        ):
            return False
    return True


_cache: Dict[str, HorizonModels] = {}


def get_models(horizon: str) -> HorizonModels:
    entry = get_active(horizon)
    if entry is None:
        raise FileNotFoundError(
            f"No ACTIVE registry model for horizon={horizon}; candidates are never served."
        )
    model_id = entry.get("modelId")
    artifact_dir = entry.get("artifactDir")
    if not model_id:
        raise RuntimeError(f"ACTIVE registry entry for horizon={horizon} has no modelId")
    if not artifact_dir:
        raise RuntimeError(
            f"ACTIVE model {model_id} for horizon={horizon} has no artifactDir"
        )
    artifact_dir = str(artifact_dir)
    if not os.path.isdir(artifact_dir):
        raise FileNotFoundError(
            f"ACTIVE model {model_id} artifactDir does not exist: {artifact_dir}"
        )
    cache_key = f"{horizon}:{model_id}"
    for stale_key in [key for key in _cache if key.startswith(f"{horizon}:") and key != cache_key]:
        del _cache[stale_key]
    if cache_key not in _cache:
        _cache[cache_key] = HorizonModels(horizon, artifact_dir, entry)
    return _cache[cache_key]


def train_command(universe: str = "all") -> str:
    basket = normalize_universe(universe)
    return "npm run train:ml:all" if basket == "all" else f"npm run train:ml:{basket}"


def missing_models_message(universe: str = "all") -> str:
    cmd = train_command(universe)
    return (
        f"No trained models in {settings.models_dir}. "
        f"Run `{cmd}` first (direction models are shared across Nifty 50/100/500)."
    )


def predict_symbol(symbol: str, history_days: int = 120) -> List[Dict[str, object]]:
    """Score one symbol for every horizon. Returns spec-shaped prediction dicts."""
    candles = load_candles(symbol, history_days)
    candle_mode = require_canonical_candles(candles, context=f"predict:{symbol}")
    market = attach_alt_data(load_market_context(history_days))
    features = build_features(candles, market, symbol=symbol)
    matrix = features[FEATURE_COLUMNS].to_numpy(dtype="float32")
    matrix = np.nan_to_num(matrix, nan=0.0)
    if matrix.shape[0] < SEQUENCE_LENGTH:
        raise RuntimeError(f"Not enough feature history for {symbol}")

    results: List[Dict[str, object]] = []
    for horizon in HORIZONS:
        models = get_models(horizon)
        trained_mode = model_price_mode(getattr(models, "metadata", None))
        if trained_mode is not None:
            assert_same_mode(
                trained_mode,
                candle_mode,
                context=f"predict:{symbol}:{horizon}:train_vs_serve",
            )
        x_scaled = models.scaler.transform(matrix)
        blended = blend_probabilities(models.probabilities(x_scaled))[0]
        decision = decide(blended)
        source_ts = None
        if "time" in features.columns and len(features):
            source_ts = int(features["time"].iloc[-1])
        payload = {
            "symbol": symbol,
            "horizon": horizon,
            "direction": decision["direction"],
            "confidence": decision["confidence"],
            "expectedMove": expected_move(
                str(decision["direction"]), models.metadata.get("class_moves", {})
            ),
            "probabilities": {
                "DOWN": decision["p_down"],
                "SIDEWAYS": decision["p_sideways"],
                "UP": decision["p_up"],
            },
            "modelVersion": models.metadata.get("model_version", settings.model_version),
            "modelId": models.model_id,
            "priceAdjustmentMode": candle_mode,
        }
        if getattr(models, "calibrator", None) is not None:
            calibrated = apply_calibrator(blended.reshape(1, -1), models.calibrator)[0]
            payload["calibratedProbabilities"] = probabilities_to_dict(calibrated)
            payload["calibrationDisclaimer"] = CALIBRATION_DISCLAIMER
        else:
            payload["calibratedProbabilities"] = None
        # M3 path heads → Trade Intelligence only (never Gate/Risk/Portfolio).
        if getattr(models, "path_regressors", None):
            path_preds = predict_path_targets(models.path_regressors, x_scaled[-1])
            payload.update(path_preds)
            payload["pathTargetsDisclaimer"] = (
                "expectedReturn/expectedMfe/expectedMae are ML advisory estimates "
                "for Trade Intelligence interpretation only — not authorization inputs."
            )
        else:
            payload["expectedReturn"] = None
            payload["expectedMfe"] = None
            payload["expectedMae"] = None
        stamp_provenance(
            payload,
            model_version=str(payload["modelVersion"]),
            feature_version=str(models.metadata.get("feature_version") or FEATURE_SET_VERSION),
            dataset_version=str(
                models.metadata.get("dataset_version") or settings.dataset_version
            ),
            source_data_timestamp=source_ts,
            ttl_seconds=settings.prediction_ttl_seconds,
        )
        drift = assess_drift(horizon, models.artifact_dir, matrix[-1])
        payload["driftStatus"] = drift["status"]
        results.append(payload)
    return results


def main(argv: Optional[List[str]] = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Predict direction for symbols")
    parser.add_argument("symbols", nargs="*", default=["RELIANCE"], help="symbols to score")
    args = parser.parse_args(argv)
    for symbol in args.symbols:
        for prediction in predict_symbol(symbol.upper()):
            print(json.dumps(prediction))
    print("Predictions are probabilistic - this is not investment advice.")


if __name__ == "__main__":
    main()
