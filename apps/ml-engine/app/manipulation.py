"""Unusual-activity (investigate) scoring. Separate from direction models."""
import json
import os
from typing import Dict, List, Optional

import numpy as np

from .config import settings
from .data import load_candles, load_market_context
from .features import MANIPULATION_FEATURE_COLUMNS, build_features
from .models.boosted import LgbmBinaryModel, XgbBinaryModel
from .models.scaler import Scaler

_models = None
_latest: Dict[str, Dict[str, object]] = {}


def _artifact_dir() -> str:
    return os.path.join(settings.models_dir, "manipulation")


def models_available() -> bool:
    return os.path.exists(os.path.join(_artifact_dir(), "metadata.json"))


class ManipulationModels:
    def __init__(self) -> None:
        directory = _artifact_dir()
        metadata_path = os.path.join(directory, "metadata.json")
        if not os.path.exists(metadata_path):
            raise FileNotFoundError("No manipulation model artifacts (run train_manipulation)")
        with open(metadata_path, "r", encoding="utf-8") as handle:
            self.metadata = json.load(handle)
        self.scaler = Scaler.load(os.path.join(directory, "scaler.json"))
        self.xgb = XgbBinaryModel().load(os.path.join(directory, "xgboost.json"))
        self.lgbm = LgbmBinaryModel().load(os.path.join(directory, "lightgbm.txt"))


def get_models() -> ManipulationModels:
    global _models
    if _models is None:
        _models = ManipulationModels()
    return _models


def _positive_prob(proba: np.ndarray) -> float:
    row = np.asarray(proba, dtype="float64")
    if row.ndim == 2:
        row = row[0]
    if row.size >= 2:
        return float(row[-1])
    return float(row[0])


def predict_symbol(symbol: str, history_days: int = 180) -> Dict[str, object]:
    candles = load_candles(symbol, history_days)
    market = load_market_context(history_days)
    features = build_features(candles, market)
    matrix = features[MANIPULATION_FEATURE_COLUMNS].to_numpy(dtype="float32")
    matrix = np.nan_to_num(matrix, nan=0.0)
    if matrix.shape[0] < 60:
        raise RuntimeError(f"Not enough feature history for {symbol}")
    models = get_models()
    latest = models.scaler.transform(matrix[-1:])
    p_xgb = _positive_prob(models.xgb.predict_proba(latest))
    p_lgb = _positive_prob(models.lgbm.predict_proba(latest))
    probability = round(0.6 * p_xgb + 0.4 * p_lgb, 4)
    payload = {
        "symbol": symbol,
        "investigateProbability": probability,
        "modelVersion": models.metadata.get("model_version", "manipulation-boosted-v1"),
    }
    cache_score(payload)
    return payload


def cache_score(row: Dict[str, object]) -> None:
    symbol = str(row.get("symbol", ""))
    if symbol:
        _latest[symbol] = row


def list_scores(limit: int = 5000) -> List[Dict[str, object]]:
    rows = list(_latest.values())
    if not rows:
        rows = _load_latest_file()
    rows.sort(key=lambda item: float(item.get("investigateProbability") or 0), reverse=True)
    return rows[:limit]


def persist_latest_file() -> None:
    path = os.path.join(_artifact_dir(), "latest.json")
    os.makedirs(_artifact_dir(), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(list(_latest.values()), handle)


def _load_latest_file() -> List[Dict[str, object]]:
    path = os.path.join(_artifact_dir(), "latest.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as handle:
        rows = json.load(handle)
    if not isinstance(rows, list):
        return []
    for row in rows:
        cache_score(row)
    return rows
