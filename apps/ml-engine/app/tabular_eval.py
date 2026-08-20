"""Shared tabular scoring for holdout / walk-forward (trees only)."""
from __future__ import annotations

from typing import Dict

import numpy as np

from .models.ensemble import blend_probabilities, decide


def tabular_decisions(x_scaled: np.ndarray, xgb, lgbm) -> np.ndarray:
    blended = blend_probabilities(
        {
            "xgboost": xgb.predict_proba(x_scaled),
            "lightgbm": lgbm.predict_proba(x_scaled),
            "lstm": None,
            "transformer": None,
        }
    )
    return blended


def tabular_summary(x_scaled: np.ndarray, y: np.ndarray, xgb, lgbm) -> Dict[str, object]:
    if x_scaled.shape[0] == 0:
        return {"overallHitRate": None, "scoredCalls": 0}
    blended = tabular_decisions(x_scaled, xgb, lgbm)
    pred = blended.argmax(axis=1)
    correct = pred == y
    hit = round(float(correct.mean()) * 100.0, 2)
    by_class = {}
    for index, name in enumerate(("DOWN", "SIDEWAYS", "UP")):
        mask = pred == index
        n = int(mask.sum())
        ok = int((correct & mask).sum())
        by_class[name] = {
            "predicted": n,
            "correct": ok,
            "hitRate": round(100.0 * ok / n, 2) if n else None,
        }
    confidences = [decide(row)["confidence"] for row in blended]
    return {
        "overallHitRate": hit,
        "scoredCalls": int(y.shape[0]),
        "byClass": by_class,
        "avgConfidence": round(float(np.mean(confidences)), 2) if confidences else None,
        "source": "time_series_holdout",
        "ensemble": "trees",
    }
