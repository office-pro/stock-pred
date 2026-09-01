"""Explicit M2 promotion: walk-forward stability + calibration → ACTIVE.

Usage:
    python -m app.promote --horizon NEXT_DAY [--model-id <uuid>]

Does not authorize trades. ML promotion criteria only.
"""
from __future__ import annotations

import argparse
import json
import os
from typing import Any, Dict, Optional

from .calibration import load_calibrator
from .config import CORE_HORIZONS, settings
from .eval_metrics import assert_cost_aware_promote_ok, assert_imbalance_promote_ok
from .promote_gates import assert_walkforward_promotable, summarize_walkforward_stability
from .registry import get_model, latest_candidate, promote_model


class PromoteError(ValueError):
    """Raised when promotion gates fail."""


def _load_walkforward(horizon: str) -> Dict[str, Any]:
    path = os.path.join(settings.models_dir, "walkforward.json")
    if not os.path.exists(path):
        raise PromoteError(
            f"Missing walkforward.json at {path}. Run python -m app.walkforward first."
        )
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    horizons = payload.get("horizons") or {}
    report = horizons.get(horizon)
    if not report:
        raise PromoteError(f"No walk-forward report for horizon={horizon}")
    return summarize_walkforward_stability(report)


def _load_dataset_quality(artifact_dir: Optional[str]) -> Optional[Dict[str, Any]]:
    candidates = []
    if artifact_dir:
        candidates.append(os.path.join(artifact_dir, "dataset-quality.json"))
    candidates.append(os.path.join(settings.models_dir, "dataset-quality.json"))
    for path in candidates:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
    return None


def promote_horizon(horizon: str, model_id: Optional[str] = None) -> Dict[str, Any]:
    """Validate gates and promote a candidate model to active."""
    entry = get_model(model_id) if model_id else latest_candidate(horizon)
    if entry is None:
        raise PromoteError(f"No candidate model for horizon={horizon}")
    if entry.get("horizon") != horizon:
        raise PromoteError(
            f"modelId={entry.get('modelId')} horizon={entry.get('horizon')} != {horizon}"
        )
    if entry.get("active"):
        raise PromoteError(f"modelId={entry.get('modelId')} is already active")

    wf = _load_walkforward(horizon)
    assert_walkforward_promotable(wf, context=f"promote:{horizon}")

    artifact_dir = entry.get("artifactDir")
    if not artifact_dir:
        raise PromoteError(
            f"Candidate modelId={entry.get('modelId')} has no artifactDir; refusing promotion."
        )
    cal_path = os.path.join(str(artifact_dir), "calibration.json")
    calibrator = load_calibrator(cal_path)
    if calibrator is None:
        # Fall back to walkforward-attached calibration path
        cal_meta = (wf.get("calibration") or {})
        alt = cal_meta.get("path")
        if alt:
            calibrator = load_calibrator(str(alt))
    if calibrator is None:
        raise PromoteError(
            f"Missing calibration.json for {horizon}. Run walk-forward to fit OOS calibrator."
        )

    dq = _load_dataset_quality(str(artifact_dir) if artifact_dir else None)
    if dq is not None and not dq.get("passed", True):
        raise PromoteError(f"dataset-quality did not pass: {dq.get('hardFailures')}")

    # M3 promote evidence (ML-only — not Risk / Portfolio / Gate).
    imbalance = wf.get("imbalance")
    if imbalance:
        try:
            assert_imbalance_promote_ok(imbalance, context=f"promote:{horizon}")
        except ValueError as error:
            raise PromoteError(str(error)) from error
    cost_aware = wf.get("costAware")
    if cost_aware:
        try:
            assert_cost_aware_promote_ok(cost_aware, context=f"promote:{horizon}")
        except ValueError as error:
            raise PromoteError(str(error)) from error

    promoted = promote_model(
        str(entry["modelId"]),
        walkforward={
            "overallHitRate": wf.get("overallHitRate"),
            "stability": wf.get("stability"),
            "foldCount": (wf.get("stability") or {}).get("foldCount"),
            "m3": wf.get("m3"),
            "imbalance": imbalance,
            "costAware": cost_aware,
        },
        calibration=calibrator,
        dataset_quality=dq,
    )
    from .predict import clear_model_cache

    clear_model_cache()
    print(
        f"[promote] horizon={horizon} modelId={promoted['modelId']} "
        f"status=active meanHit={(wf.get('stability') or {}).get('meanHitRate')}",
        flush=True,
    )
    return promoted


def main() -> None:
    parser = argparse.ArgumentParser(description="Promote ML candidate after M2 gates")
    parser.add_argument("--horizon", type=str, default="", help="single horizon to promote")
    parser.add_argument("--model-id", type=str, default="", help="optional candidate modelId")
    parser.add_argument(
        "--all-core",
        action="store_true",
        help="promote all CORE_HORIZONS that have candidates + passing gates",
    )
    args = parser.parse_args()
    if args.all_core:
        for horizon in CORE_HORIZONS:
            try:
                promote_horizon(horizon)
            except Exception as error:  # noqa: BLE001
                print(f"[promote] skip {horizon}: {error}", flush=True)
        return
    if not args.horizon:
        raise SystemExit("--horizon is required (or pass --all-core)")
    promote_horizon(args.horizon.upper(), args.model_id or None)


if __name__ == "__main__":
    main()
