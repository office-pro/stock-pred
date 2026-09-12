"""Cost-aware and class-imbalance metrics for M3 ML evaluation.

These feed promote *evidence* only — not Risk / Portfolio / Gate thresholds.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

import numpy as np

from .costs import SLIPPAGE_RATE, nse_delivery_fee


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return float(raw)


def round_trip_cost_rate(notional: float = 100_000.0) -> float:
    """Approximate fractional round-trip cost (fees + slippage) on notional."""
    buy = notional * (1.0 + SLIPPAGE_RATE)
    sell = notional * (1.0 - SLIPPAGE_RATE)
    fees = nse_delivery_fee(buy, "BUY") + nse_delivery_fee(sell, "SELL")
    slip = notional * (2.0 * SLIPPAGE_RATE)
    return float((fees + slip) / notional)


def net_of_cost_returns(gross_returns: np.ndarray, *, side: str = "LONG") -> np.ndarray:
    """Subtract one round-trip cost rate from gross strategy returns."""
    gross = np.asarray(gross_returns, dtype=float)
    cost = round_trip_cost_rate()
    # Long: pay cost when taking the trade; net = gross - cost
    return gross - cost


def cost_aware_summary(
    gross_returns: np.ndarray,
    *,
    predictions_taken_mask: Optional[np.ndarray] = None,
) -> Dict[str, Any]:
    gross = np.asarray(gross_returns, dtype=float)
    if predictions_taken_mask is not None:
        gross = gross[np.asarray(predictions_taken_mask, dtype=bool)]
    gross = gross[np.isfinite(gross)]
    if gross.size == 0:
        return {
            "samples": 0,
            "avgGrossReturn": None,
            "avgNetReturn": None,
            "costRate": round_trip_cost_rate(),
            "netPositive": False,
        }
    net = net_of_cost_returns(gross)
    avg_gross = float(np.mean(gross))
    avg_net = float(np.mean(net))
    return {
        "samples": int(gross.size),
        "avgGrossReturn": round(avg_gross, 6),
        "avgNetReturn": round(avg_net, 6),
        "costRate": round(round_trip_cost_rate(), 6),
        "netPositive": avg_net > 0,
    }


def imbalance_metrics(y_true: np.ndarray, y_pred: np.ndarray, class_names=None) -> Dict[str, Any]:
    """Per-class precision/recall/F1 + balanced accuracy + confusion matrix."""
    names = list(class_names or ("DOWN", "SIDEWAYS", "UP"))
    y_true = np.asarray(y_true).astype(int)
    y_pred = np.asarray(y_pred).astype(int)
    n_classes = len(names)
    confusion = np.zeros((n_classes, n_classes), dtype=int)
    for t, p in zip(y_true, y_pred):
        if 0 <= t < n_classes and 0 <= p < n_classes:
            confusion[t, p] += 1

    per_class: Dict[str, Any] = {}
    recalls = []
    for i, name in enumerate(names):
        tp = int(confusion[i, i])
        fp = int(confusion[:, i].sum() - tp)
        fn = int(confusion[i, :].sum() - tp)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall)
            else 0.0
        )
        recalls.append(recall)
        per_class[name] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": int(confusion[i, :].sum()),
        }

    balanced = float(np.mean(recalls)) if recalls else 0.0
    overall = float((y_true == y_pred).mean()) if len(y_true) else 0.0
    return {
        "overallAccuracy": round(overall, 4),
        "balancedAccuracy": round(balanced, 4),
        "perClass": per_class,
        "confusionMatrix": confusion.tolist(),
    }


def assert_imbalance_promote_ok(metrics: Dict[str, Any], *, context: str = "promote") -> None:
    """Block SIDEWAYS-dominated models that look fine on raw accuracy."""
    min_balanced = _env_float("ML_PROMOTE_MIN_BALANCED_ACCURACY", 0.34)
    min_minority_recall = _env_float("ML_PROMOTE_MIN_MINORITY_RECALL", 0.15)
    balanced = float(metrics.get("balancedAccuracy") or 0.0)
    if balanced < min_balanced:
        raise ValueError(
            f"Imbalance gate failed in {context}: balancedAccuracy={balanced:.3f} "
            f"< min={min_balanced}"
        )
    per = metrics.get("perClass") or {}
    for name in ("DOWN", "UP"):
        recall = float((per.get(name) or {}).get("recall") or 0.0)
        if recall < min_minority_recall:
            raise ValueError(
                f"Imbalance gate failed in {context}: {name} recall={recall:.3f} "
                f"< min={min_minority_recall}"
            )


def assert_cost_aware_promote_ok(summary: Dict[str, Any], *, context: str = "promote") -> None:
    """Optional net-edge gate (default on)."""
    enforce = os.getenv("ML_PROMOTE_REQUIRE_NET_POSITIVE", "1") not in ("0", "false", "False")
    if not enforce:
        return
    if summary.get("samples", 0) <= 0:
        return
    if not summary.get("netPositive"):
        raise ValueError(
            f"Cost-aware gate failed in {context}: avgNetReturn="
            f"{summary.get('avgNetReturn')} (gross={summary.get('avgGrossReturn')})"
        )
