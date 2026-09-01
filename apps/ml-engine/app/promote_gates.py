"""Walk-forward stability gates for M2 model promotion.

ML promotion criteria only — not Risk / Portfolio / Policy / Gate thresholds.
Hit rates from tabular_summary are percentages (0–100).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Sequence

import numpy as np


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return float(raw)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return int(raw)


# Locked M2 defaults (percent scale to match tabular_summary.overallHitRate).
DEFAULT_MIN_FOLDS = 3
DEFAULT_MIN_MEAN_HIT = 40.0
DEFAULT_MIN_WORST_FOLD = 30.0
DEFAULT_MAX_HIT_STD = 12.0


def promote_thresholds() -> Dict[str, float]:
    return {
        "minFolds": float(_env_int("ML_PROMOTE_MIN_FOLDS", DEFAULT_MIN_FOLDS)),
        "minMeanHitRate": _env_float("ML_PROMOTE_MIN_MEAN_HIT", DEFAULT_MIN_MEAN_HIT),
        "minWorstFoldHitRate": _env_float("ML_PROMOTE_MIN_WORST_FOLD", DEFAULT_MIN_WORST_FOLD),
        "maxHitRateStd": _env_float("ML_PROMOTE_MAX_HIT_STD", DEFAULT_MAX_HIT_STD),
    }


def fold_hit_rates(folds: Sequence[Dict[str, Any]]) -> List[float]:
    rates: List[float] = []
    for fold in folds:
        value = fold.get("overallHitRate")
        if value is None:
            value = fold.get("overallHitRate")
        if value is None:
            continue
        rates.append(float(value))
    return rates


def summarize_walkforward_stability(horizon_report: Dict[str, Any]) -> Dict[str, Any]:
    """Attach mean / std / worst-fold / fold series to a walk-forward horizon report."""
    folds = list(horizon_report.get("folds") or [])
    rates = fold_hit_rates(folds)
    thresholds = promote_thresholds()
    if not rates:
        summary = {
            "foldCount": 0,
            "foldHitRates": [],
            "meanHitRate": None,
            "hitRateStd": None,
            "worstFoldHitRate": None,
            "thresholds": thresholds,
            "passed": False,
            "failures": ["no_scored_folds"],
        }
        return {**horizon_report, "stability": summary}

    mean = float(np.mean(rates))
    std = float(np.std(rates, ddof=0))
    worst = float(np.min(rates))
    failures: List[str] = []
    if len(rates) < int(thresholds["minFolds"]):
        failures.append(f"foldCount={len(rates)} < minFolds={int(thresholds['minFolds'])}")
    if mean < thresholds["minMeanHitRate"]:
        failures.append(f"meanHitRate={mean:.2f} < min={thresholds['minMeanHitRate']}")
    if worst < thresholds["minWorstFoldHitRate"]:
        failures.append(f"worstFoldHitRate={worst:.2f} < min={thresholds['minWorstFoldHitRate']}")
    if std > thresholds["maxHitRateStd"]:
        failures.append(f"hitRateStd={std:.2f} > max={thresholds['maxHitRateStd']}")

    summary = {
        "foldCount": len(rates),
        "foldHitRates": [round(r, 2) for r in rates],
        "meanHitRate": round(mean, 2),
        "hitRateStd": round(std, 2),
        "worstFoldHitRate": round(worst, 2),
        "thresholds": thresholds,
        "passed": len(failures) == 0,
        "failures": failures,
    }
    return {
        **horizon_report,
        "overallHitRate": round(mean, 2),
        "stability": summary,
    }


def assert_walkforward_promotable(horizon_report: Dict[str, Any], *, context: str = "promote") -> None:
    stability = horizon_report.get("stability")
    if not stability:
        horizon_report = summarize_walkforward_stability(horizon_report)
        stability = horizon_report["stability"]
    if stability.get("passed"):
        return
    failures = stability.get("failures") or ["walkforward_gate_failed"]
    raise ValueError(f"Walk-forward promote gate failed in {context}: {'; '.join(failures)}")
