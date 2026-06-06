"""Ensemble blending (spec): 40% XGBoost, 25% LightGBM, 20% LSTM, 15% Transformer.

Pure numpy so the blending math is unit-testable without the heavy runtimes.
"""
from typing import Dict, Optional

import numpy as np

from ..config import CLASSES, ENSEMBLE_WEIGHTS


def blend_probabilities(probas: Dict[str, Optional[np.ndarray]]) -> np.ndarray:
    """Weighted soft-vote. Missing models forfeit their weight (re-normalized)."""
    total_weight = 0.0
    blended: Optional[np.ndarray] = None
    for name, weight in ENSEMBLE_WEIGHTS.items():
        proba = probas.get(name)
        if proba is None:
            continue
        contribution = np.asarray(proba, dtype="float64") * weight
        blended = contribution if blended is None else blended + contribution
        total_weight += weight
    if blended is None or total_weight == 0.0:
        raise RuntimeError("No model produced probabilities")
    return blended / total_weight


def decide(blended_row: np.ndarray) -> Dict[str, float]:
    """Map a blended probability row to direction + confidence."""
    index = int(np.argmax(blended_row))
    return {
        "direction": CLASSES[index],
        "confidence": round(float(blended_row[index]) * 100.0, 2),
        "p_down": round(float(blended_row[0]) * 100.0, 2),
        "p_sideways": round(float(blended_row[1]) * 100.0, 2),
        "p_up": round(float(blended_row[2]) * 100.0, 2),
    }


def expected_move(direction: str, class_moves: Dict[str, float]) -> float:
    """Signed expected move (%) from per-class median |forward return| stats."""
    move = class_moves.get(direction, 0.0)
    if direction == "DOWN":
        return round(-abs(move) * 100.0, 2)
    if direction == "UP":
        return round(abs(move) * 100.0, 2)
    return 0.0
