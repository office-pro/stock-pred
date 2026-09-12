"""Shared tabular scoring for holdout / walk-forward (trees only)."""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np

from .eval_metrics import cost_aware_summary, imbalance_metrics
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


def tabular_summary(
    x_scaled: np.ndarray,
    y: np.ndarray,
    xgb,
    lgbm,
    *,
    forward_returns: Optional[np.ndarray] = None,
) -> Dict[str, object]:
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
    summary: Dict[str, object] = {
        "overallHitRate": hit,
        "scoredCalls": int(y.shape[0]),
        "byClass": by_class,
        "avgConfidence": round(float(np.mean(confidences)), 2) if confidences else None,
        "source": "time_series_holdout",
        "ensemble": "trees",
        "imbalance": imbalance_metrics(y, pred),
    }
    if forward_returns is not None and len(forward_returns) == len(pred):
        # Gross strategy return when taking UP as long / DOWN as short.
        taken = (pred == 2) | (pred == 0)
        signed = np.where(pred == 2, forward_returns, np.where(pred == 0, -forward_returns, 0.0))
        summary["costAware"] = cost_aware_summary(signed, predictions_taken_mask=taken)
    return summary
