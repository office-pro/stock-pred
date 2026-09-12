"""Out-of-sample probability calibration (M2).

Fits isotonic regression per class on OOS predicted probabilities.
confidence (max raw/calibrated score * 100) is NOT a calibrated probability —
use calibratedProbabilities for probability-facing consumers.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .config import CLASSES

DISCLAIMER = (
    "Confidence is not a calibrated probability. Use calibratedProbabilities."
)


def _brier_multiclass(y_true: np.ndarray, probs: np.ndarray, n_classes: int = 3) -> float:
    one_hot = np.eye(n_classes)[y_true.astype(int)]
    return float(np.mean(np.sum((probs - one_hot) ** 2, axis=1)))


def _log_loss(y_true: np.ndarray, probs: np.ndarray, eps: float = 1e-15) -> float:
    clipped = np.clip(probs, eps, 1.0 - eps)
    clipped = clipped / clipped.sum(axis=1, keepdims=True)
    rows = clipped[np.arange(len(y_true)), y_true.astype(int)]
    return float(-np.mean(np.log(rows)))


def _reliability_bins(
    y_true: np.ndarray, probs: np.ndarray, n_bins: int = 10
) -> List[Dict[str, Any]]:
    """Reliability for the predicted-class confidence."""
    pred = probs.argmax(axis=1)
    conf = probs.max(axis=1)
    correct = (pred == y_true).astype(float)
    bins: List[Dict[str, Any]] = []
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        if i == n_bins - 1:
            mask = (conf >= lo) & (conf <= hi)
        else:
            mask = (conf >= lo) & (conf < hi)
        n = int(mask.sum())
        if n == 0:
            bins.append(
                {
                    "bin": i,
                    "lo": round(float(lo), 2),
                    "hi": round(float(hi), 2),
                    "count": 0,
                    "avgConfidence": None,
                    "hitRate": None,
                }
            )
            continue
        bins.append(
            {
                "bin": i,
                "lo": round(float(lo), 2),
                "hi": round(float(hi), 2),
                "count": n,
                "avgConfidence": round(float(conf[mask].mean()), 4),
                "hitRate": round(float(correct[mask].mean()), 4),
            }
        )
    return bins


def _fit_isotonic(x: np.ndarray, y: np.ndarray) -> Dict[str, List[float]]:
    """Simple pooled-adjacent-violators isotonic fit; returns x/y knots."""
    order = np.argsort(x)
    x_sorted = x[order].astype(float)
    y_sorted = y[order].astype(float)
    n = len(x_sorted)
    if n == 0:
        return {"x": [0.0, 1.0], "y": [0.0, 1.0]}
    # PAV
    level = y_sorted.copy()
    weight = np.ones(n, dtype=float)
    i = 0
    while i < n - 1:
        if level[i] <= level[i + 1] + 1e-12:
            i += 1
            continue
        # merge with next
        total_w = weight[i] + weight[i + 1]
        avg = (level[i] * weight[i] + level[i + 1] * weight[i + 1]) / total_w
        level[i] = avg
        weight[i] = total_w
        level = np.delete(level, i + 1)
        weight = np.delete(weight, i + 1)
        x_sorted = np.delete(x_sorted, i + 1)
        n -= 1
        if i > 0:
            i -= 1
    # Expand to unique x knots (use block means already in level)
    return {
        "x": [float(v) for v in x_sorted],
        "y": [float(v) for v in level],
    }


def _apply_isotonic(values: np.ndarray, curve: Dict[str, List[float]]) -> np.ndarray:
    xs = np.asarray(curve["x"], dtype=float)
    ys = np.asarray(curve["y"], dtype=float)
    if len(xs) == 0:
        return values.copy()
    return np.interp(values, xs, ys, left=ys[0], right=ys[-1])


def fit_multiclass_calibrator(
    y_true: np.ndarray,
    raw_probs: np.ndarray,
) -> Dict[str, Any]:
    """Fit one-vs-rest isotonic calibrators on OOS probabilities."""
    y_true = np.asarray(y_true).astype(int)
    raw_probs = np.asarray(raw_probs, dtype=float)
    if raw_probs.ndim != 2 or raw_probs.shape[0] != len(y_true):
        raise ValueError("raw_probs must be (n, n_classes) aligned with y_true")
    n_classes = raw_probs.shape[1]
    curves = []
    for k in range(n_classes):
        target = (y_true == k).astype(float)
        curves.append(_fit_isotonic(raw_probs[:, k], target))

    calibrated = apply_calibrator(raw_probs, {"method": "isotonic_ovr", "curves": curves})
    return {
        "method": "isotonic_ovr",
        "classes": list(CLASSES[:n_classes]),
        "curves": curves,
        "metrics": {
            "brierRaw": round(_brier_multiclass(y_true, raw_probs, n_classes), 6),
            "brierCalibrated": round(_brier_multiclass(y_true, calibrated, n_classes), 6),
            "logLossRaw": round(_log_loss(y_true, raw_probs), 6),
            "logLossCalibrated": round(_log_loss(y_true, calibrated), 6),
            "reliabilityRaw": _reliability_bins(y_true, raw_probs),
            "reliabilityCalibrated": _reliability_bins(y_true, calibrated),
            "samples": int(len(y_true)),
        },
        "disclaimer": DISCLAIMER,
    }


def apply_calibrator(raw_probs: np.ndarray, calibrator: Dict[str, Any]) -> np.ndarray:
    raw_probs = np.asarray(raw_probs, dtype=float)
    curves = calibrator.get("curves") or []
    if not curves:
        return raw_probs.copy()
    out = np.zeros_like(raw_probs)
    for k, curve in enumerate(curves):
        if k >= raw_probs.shape[1]:
            break
        out[:, k] = _apply_isotonic(raw_probs[:, k], curve)
    # Renormalize to a simplex.
    totals = out.sum(axis=1, keepdims=True)
    totals = np.where(totals <= 0, 1.0, totals)
    return out / totals


def save_calibrator(calibrator: Dict[str, Any], path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(calibrator, handle, indent=2)


def load_calibrator(path: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else None


def probabilities_to_dict(probs: np.ndarray) -> Dict[str, float]:
    row = probs.reshape(-1)
    return {
        "DOWN": round(float(row[0]), 6),
        "SIDEWAYS": round(float(row[1]), 6),
        "UP": round(float(row[2]), 6),
    }
