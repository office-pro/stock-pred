"""Dataset quality report + hard gates (M2).

Runs before training. PIT violations and empty datasets hard-fail.
Missingness / coverage ceilings are env-configurable.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Sequence

import numpy as np

from .config import CLASSES, settings
from .pit import find_pit_violations


class DatasetQualityError(ValueError):
    """Raised when hard dataset-quality gates fail."""


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return float(raw)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_dataset_quality_report(
    *,
    x: np.ndarray,
    y: np.ndarray,
    times: np.ndarray,
    symbols: Optional[Sequence[str]] = None,
    pit_feature_timestamps=None,
    pit_available_at=None,
    pit_symbols: Optional[Sequence[Optional[str]]] = None,
    pit_membership_violations: int = 0,
    price_policy_mode: Optional[str] = None,
    price_policy_version: Optional[str] = None,
    unverified_adjustment: bool = False,
) -> Dict[str, Any]:
    """Assemble a DatasetQualityReport for a training matrix."""
    rows = int(x.shape[0]) if x is not None else 0
    n_features = int(x.shape[1]) if x is not None and x.ndim == 2 and rows else 0
    missing_rate = 0.0
    if rows and n_features:
        missing_rate = float(np.isnan(x).mean()) if np.issubdtype(x.dtype, np.floating) else 0.0

    class_counts = {CLASSES[i]: int((y == i).sum()) for i in range(len(CLASSES))} if rows else {}
    time_min = time_max = None
    if rows and times is not None and len(times):
        time_min = int(np.min(times))
        time_max = int(np.max(times))

    pit_violations = 0
    pit_examples: list = []
    if pit_feature_timestamps is not None and pit_available_at is not None:
        violations = find_pit_violations(
            pit_feature_timestamps, pit_available_at, symbols=pit_symbols
        )
        pit_violations = len(violations)
        pit_examples = [
            {
                "symbol": v.symbol,
                "featureTimestamp": str(v.feature_timestamp),
                "availableAt": str(v.available_at),
                "detail": v.detail,
            }
            for v in violations[:5]
        ]

    max_missing = _env_float("ML_DQ_MAX_MISSING_RATE", 0.05)
    min_rows = int(_env_float("ML_DQ_MIN_ROWS", 1))
    min_symbol_coverage = _env_float("ML_DQ_MIN_SYMBOL_COVERAGE", 0.0)
    symbol_count = len(symbols) if symbols else 0
    requested = int(os.getenv("ML_DQ_REQUESTED_SYMBOLS", "0") or 0)
    coverage = (symbol_count / requested) if requested > 0 else 1.0
    require_verified_adj = os.getenv("ML_DQ_REQUIRE_VERIFIED_ADJ", "0") in (
        "1",
        "true",
        "True",
    )

    hard_failures: list[str] = []
    if rows < min_rows:
        hard_failures.append(f"rows={rows} < min_rows={min_rows}")
    if pit_violations > 0:
        hard_failures.append(f"pit_violations={pit_violations}")
    if pit_membership_violations > 0:
        hard_failures.append(f"pit_membership_violations={pit_membership_violations}")
    if missing_rate > max_missing:
        hard_failures.append(f"missing_rate={missing_rate:.4f} > max={max_missing}")
    if coverage < min_symbol_coverage:
        hard_failures.append(f"symbol_coverage={coverage:.4f} < min={min_symbol_coverage}")
    if price_policy_mode and price_policy_mode != "ADJUSTED":
        hard_failures.append(f"priceAdjustmentMode={price_policy_mode} != ADJUSTED")
    if require_verified_adj and unverified_adjustment:
        hard_failures.append("unverified_price_adjustment")

    warnings: list[str] = []
    if class_counts:
        total = sum(class_counts.values()) or 1
        for name, count in class_counts.items():
            share = count / total
            if share < 0.05:
                warnings.append(f"class {name} share={share:.3f} is thin")
    if unverified_adjustment and not require_verified_adj:
        warnings.append("price adjustment unverified (close_as_adjusted)")
    if pit_membership_violations == 0 and os.getenv("ML_DQ_WARN_NO_UNIVERSE_HISTORY"):
        warnings.append("universe PIT history may be incomplete")

    return {
        "schemaVersion": "dataset-quality.v2",
        "generatedAt": _utc_now(),
        "rows": rows,
        "nFeatures": n_features,
        "symbols": symbol_count,
        "symbolCoverage": round(coverage, 4),
        "timeMin": time_min,
        "timeMax": time_max,
        "missingRate": round(missing_rate, 6),
        "classCounts": class_counts,
        "pitViolations": pit_violations,
        "pitMembershipViolations": int(pit_membership_violations),
        "pitExamples": pit_examples,
        "pricePolicy": {
            "mode": price_policy_mode,
            "version": price_policy_version,
            "unverifiedAdjustment": bool(unverified_adjustment),
        },
        "thresholds": {
            "minRows": min_rows,
            "maxMissingRate": max_missing,
            "minSymbolCoverage": min_symbol_coverage,
            "requireVerifiedAdj": require_verified_adj,
        },
        "hardFailures": hard_failures,
        "warnings": warnings,
        "passed": len(hard_failures) == 0,
    }


def assert_dataset_quality(report: Dict[str, Any], *, context: str = "train") -> None:
    """Hard-fail when DatasetQualityReport did not pass."""
    if report.get("passed"):
        return
    failures = report.get("hardFailures") or ["unknown"]
    raise DatasetQualityError(
        f"Dataset quality hard-fail in {context}: {'; '.join(str(f) for f in failures)}"
    )


def persist_dataset_quality(report: Dict[str, Any], out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "dataset-quality.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    # Also keep a copy under models_dir root for ops visibility.
    root = os.path.join(settings.models_dir, "dataset-quality.json")
    os.makedirs(settings.models_dir, exist_ok=True)
    with open(root, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    return path
