"""Serving-time feature and outcome drift assessment.

Drift is advisory metadata for Trade Intelligence. It never authorizes trades.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from .config import HORIZONS, settings

_report_lock = threading.Lock()


def _env_float(name: str, default: float) -> float:
    return float(os.getenv(name, str(default)))


def _env_int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


def _load_json(path: str) -> Any:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _feature_drift(artifact_dir: str, feature_row: np.ndarray) -> Tuple[Dict[str, Any], List[str]]:
    path = os.path.join(artifact_dir, "feature-baseline.json")
    baseline = _load_json(path)
    if not isinstance(baseline, dict):
        return (
            {"status": "insufficient_data", "meanPsi": None, "maxAbsZ": None},
            ["feature baseline is missing"],
        )

    means = np.asarray(baseline.get("mean"), dtype=float)
    stds = np.asarray(baseline.get("std"), dtype=float)
    row = np.asarray(feature_row, dtype=float)
    if row.ndim == 2:
        row = row[-1]
    row = row.reshape(-1)
    if means.shape != row.shape or stds.shape != row.shape:
        return (
            {
                "status": "incompatible",
                "meanPsi": None,
                "maxAbsZ": None,
                "expectedFeatures": int(means.size),
                "actualFeatures": int(row.size),
            },
            ["feature row does not match the registered baseline"],
        )

    safe_stds = np.where(np.isfinite(stds) & (stds > 0), stds, 1.0)
    z = np.nan_to_num((row - means) / safe_stds, nan=0.0, posinf=1e6, neginf=-1e6)
    abs_z = np.abs(z)
    # A smooth point-in-time PSI proxy under the baseline's standardized
    # distribution. It is zero at baseline and grows with distributional shift.
    psi_by_feature = np.log(np.cosh(np.clip(z, -50.0, 50.0)))
    mean_psi = float(np.mean(psi_by_feature)) if psi_by_feature.size else 0.0
    max_abs_z = float(np.max(abs_z)) if abs_z.size else 0.0
    warn = _env_float("ML_DRIFT_PSI_WARN", 0.1)
    incompatible = _env_float("ML_DRIFT_PSI_INCOMPATIBLE", 0.25)
    z_warn = _env_float("ML_DRIFT_Z_WARN", 3.0)
    if mean_psi >= incompatible or max_abs_z >= z_warn * 2.0:
        status = "incompatible"
    elif mean_psi >= warn or max_abs_z >= z_warn:
        status = "warn"
    else:
        status = "ok"

    names = list(baseline.get("featureNames") or [])
    worst = np.argsort(abs_z)[-5:][::-1] if abs_z.size else []
    top = [
        {
            "feature": str(names[index]) if index < len(names) else str(index),
            "zScore": round(float(z[index]), 6),
            "psi": round(float(psi_by_feature[index]), 6),
        }
        for index in worst
    ]
    reasons = [] if status == "ok" else [
        f"feature drift {status}: meanPsi={mean_psi:.4f}, maxAbsZ={max_abs_z:.4f}"
    ]
    return (
        {
            "status": status,
            "meanPsi": round(mean_psi, 6),
            "maxAbsZ": round(max_abs_z, 6),
            "topFeatures": top,
        },
        reasons,
    )


def _probability_row(row: Dict[str, Any]) -> Optional[np.ndarray]:
    raw = row.get("calibratedProbabilities") or row.get("probabilities")
    if not isinstance(raw, dict):
        return None
    try:
        values = np.asarray([raw["DOWN"], raw["SIDEWAYS"], raw["UP"]], dtype=float)
    except (KeyError, TypeError, ValueError):
        return None
    if np.max(values) > 1.0:
        values = values / 100.0
    total = float(values.sum())
    if total <= 0 or not np.all(np.isfinite(values)):
        return None
    return values / total


def _actual_class(row: Dict[str, Any], horizon: str) -> Optional[int]:
    actual = row.get("actualDirection")
    if actual in ("DOWN", "SIDEWAYS", "UP"):
        return ("DOWN", "SIDEWAYS", "UP").index(str(actual))
    value = row.get("actualReturn")
    if value is None:
        return None
    threshold = float((HORIZONS.get(horizon) or {}).get("threshold") or 0.0)
    realized = float(value)
    return 2 if realized > threshold else 0 if realized < -threshold else 1


def _calibration_drift(horizon: str, artifact_dir: str) -> Tuple[Dict[str, Any], int, List[str]]:
    payload = _load_json(os.path.join(settings.models_dir, "outcomes.json"))
    rows = payload if isinstance(payload, list) else []
    matching = [row for row in rows if isinstance(row, dict) and row.get("horizon") == horizon]
    sample_size = len(matching)
    minimum = _env_int("ML_DRIFT_MIN_OUTCOMES", 50)
    if sample_size < minimum:
        return (
            {"status": "insufficient_data", "brier": None},
            sample_size,
            [f"only {sample_size} outcomes; {minimum} required"],
        )

    aligned = [
        (label, probabilities)
        for row in matching
        if (label := _actual_class(row, horizon)) is not None
        and (probabilities := _probability_row(row)) is not None
    ]
    if len(aligned) < minimum:
        return (
            {"status": "insufficient_data", "brier": None},
            sample_size,
            [f"only {len(aligned)} outcomes contain aligned probabilities; {minimum} required"],
        )

    labels = np.asarray([item[0] for item in aligned], dtype=int)
    probabilities = np.asarray([item[1] for item in aligned], dtype=float)
    one_hot = np.eye(3)[labels]
    brier = float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1)))

    calibrator = _load_json(os.path.join(artifact_dir, "calibration.json"))
    metrics = calibrator.get("metrics") if isinstance(calibrator, dict) else {}
    baseline_brier = metrics.get("brierCalibrated") if isinstance(metrics, dict) else None
    status = "ok"
    reasons: List[str] = []
    if baseline_brier is not None:
        delta = brier - float(baseline_brier)
        if delta >= _env_float("ML_DRIFT_PSI_INCOMPATIBLE", 0.25):
            status = "incompatible"
        elif delta >= _env_float("ML_DRIFT_PSI_WARN", 0.1):
            status = "warn"
        if status != "ok":
            reasons.append(f"calibration drift {status}: Brier delta={delta:.4f}")
    return (
        {
            "status": status,
            "brier": round(brier, 6),
            "baselineBrier": None if baseline_brier is None else float(baseline_brier),
            "samplesWithProbabilities": len(aligned),
        },
        sample_size,
        reasons,
    )


def assess_drift(horizon: str, artifact_dir: str, feature_row: np.ndarray) -> Dict[str, Any]:
    """Assess and persist serving drift without making authorization decisions."""
    feature, feature_reasons = _feature_drift(artifact_dir, feature_row)
    calibration, sample_size, calibration_reasons = _calibration_drift(horizon, artifact_dir)
    statuses = {feature["status"], calibration["status"]}
    if "incompatible" in statuses:
        status = "incompatible"
    elif "warn" in statuses:
        status = "warn"
    elif "insufficient_data" in statuses:
        status = "insufficient_data"
    else:
        status = "ok"
    report = {
        "status": status,
        "featureDrift": feature,
        "calibrationDrift": calibration,
        "outcomeSampleSize": sample_size,
        "reasons": feature_reasons + calibration_reasons,
    }
    directory = os.path.join(settings.models_dir, "drift")
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{horizon}.json")
    tmp = f"{path}.tmp"
    with _report_lock:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
        os.replace(tmp, path)
    return report
