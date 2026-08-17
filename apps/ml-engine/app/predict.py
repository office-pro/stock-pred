"""Prediction pipeline: loads ensemble artifacts and scores symbols."""
import json
import os
from typing import Dict, List, Optional

import numpy as np

from .config import CORE_HORIZONS, HORIZONS, SEQUENCE_LENGTH, settings
from .data import load_candles, load_market_context
from .features import FEATURE_COLUMNS, build_features
from .universes import normalize_universe
from .models.boosted import LgbmModel, XgbModel
from .models.ensemble import blend_probabilities, decide, expected_move
from .models.scaler import Scaler
from .models.sequence import LstmModel, TransformerModel


class HorizonModels:
    """Loaded artifact set for one horizon."""

    def __init__(self, horizon: str):
        directory = os.path.join(settings.models_dir, horizon)
        metadata_path = os.path.join(directory, "metadata.json")
        if not os.path.exists(metadata_path):
            raise FileNotFoundError(missing_models_message())
        with open(metadata_path, "r", encoding="utf-8") as handle:
            self.metadata = json.load(handle)
        self.scaler = Scaler.load(os.path.join(directory, "scaler.json"))
        n_features = len(FEATURE_COLUMNS)
        self.xgb = XgbModel().load(os.path.join(directory, "xgboost.json"))
        self.lgbm = LgbmModel().load(os.path.join(directory, "lightgbm.txt"))
        self.lstm = LstmModel(n_features).load(os.path.join(directory, "lstm.pt"))
        self.transformer = TransformerModel(n_features).load(
            os.path.join(directory, "transformer.pt")
        )


_cache: Dict[str, HorizonModels] = {}


def get_models(horizon: str) -> HorizonModels:
    if horizon not in _cache:
        _cache[horizon] = HorizonModels(horizon)
    return _cache[horizon]


def models_available() -> bool:
    return all(
        os.path.exists(os.path.join(settings.models_dir, horizon, "metadata.json"))
        for horizon in CORE_HORIZONS
    )


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
    market = load_market_context(history_days)
    features = build_features(candles, market)
    matrix = features[FEATURE_COLUMNS].to_numpy(dtype="float32")
    matrix = np.nan_to_num(matrix, nan=0.0)
    if matrix.shape[0] < SEQUENCE_LENGTH:
        raise RuntimeError(f"Not enough feature history for {symbol}")

    results: List[Dict[str, object]] = []
    for horizon in HORIZONS:
        try:
            models = get_models(horizon)
        except FileNotFoundError:
            continue
        x_scaled = models.scaler.transform(matrix)
        latest = x_scaled[-1:]

        probas = {
            "xgboost": models.xgb.predict_proba(latest),
            "lightgbm": models.lgbm.predict_proba(latest),
            "lstm": models.lstm.predict_proba_last(x_scaled),
            "transformer": models.transformer.predict_proba_last(x_scaled),
        }
        blended = blend_probabilities(probas)[0]
        decision = decide(blended)
        results.append(
            {
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
            }
        )
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
