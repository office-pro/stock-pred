"""ML lifecycle orchestration — existing M1–M4 capabilities as a staged DAG.

Modes:
  full     INGEST → TRAIN_CANDIDATE → DATA_QUALITY → WALK_FORWARD → CALIBRATION
           → PROMOTE → PREDICT → DRIFT_SCORE → REPORT
  refresh  INGEST → PREDICT → DRIFT_SCORE → REPORT  (requires ACTIVE; no retrain)

Promotion stays gate-controlled. Predict after a blocked promote is SKIPPED.
Does not execute trades or change Risk / Portfolio / Policy / Gate.

Usage:
  python -m app.lifecycle --mode full --universe nifty50
  python -m app.lifecycle --mode refresh --universe all
  python -m app.lifecycle --mode full --resume
  python -m app.lifecycle --mode full --from-stage TRAIN_CANDIDATE
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .config import CORE_HORIZONS, DISCLAIMER, settings
from .promote import PromoteError, promote_horizon
from .registry import get_active

FULL_STAGES: Tuple[str, ...] = (
    "INGEST",
    "TRAIN_CANDIDATE",
    "DATA_QUALITY",
    "WALK_FORWARD",
    "CALIBRATION",
    "PROMOTE",
    "PREDICT",
    "DRIFT_SCORE",
    "REPORT",
)

REFRESH_STAGES: Tuple[str, ...] = (
    "INGEST",
    "PREDICT",
    "DRIFT_SCORE",
    "REPORT",
)


def _runs_dir() -> str:
    path = os.path.join(settings.models_dir, "lifecycle-runs")
    os.makedirs(path, exist_ok=True)
    return path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log(message: str) -> None:
    # Windows cp1252 consoles reject arrows/dashes — keep ASCII for the Jobs live console.
    text = f"[lifecycle] {message}"
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        print(text.encode(encoding, errors="replace").decode(encoding, errors="replace"), flush=True)


def _empty_stages(names: Sequence[str]) -> List[Dict[str, Any]]:
    return [
        {
            "id": name,
            "status": "PENDING",
            "startedAt": None,
            "finishedAt": None,
            "detail": None,
            "exitCode": None,
        }
        for name in names
    ]


def new_run(mode: str, universe: str) -> Dict[str, Any]:
    stage_ids = FULL_STAGES if mode == "full" else REFRESH_STAGES
    return {
        "runId": str(uuid.uuid4()),
        "mode": mode,
        "universe": universe,
        "status": "RUNNING",
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
        "finishedAt": None,
        "resumeFrom": None,
        "stages": _empty_stages(stage_ids),
        "note": (
            "Lifecycle orchestration reuses existing M1–M4 jobs. "
            "Promotion is gate-controlled. Does not authorize trades."
        ),
        "disclaimer": DISCLAIMER,
    }


def save_run(run: Dict[str, Any]) -> None:
    run["updatedAt"] = _now_iso()
    runs = _runs_dir()
    path = os.path.join(runs, f"{run['runId']}.json")
    latest = os.path.join(runs, "latest.json")
    for target in (path, latest):
        tmp = f"{target}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(run, handle, indent=2)
        os.replace(tmp, target)


def load_latest() -> Optional[Dict[str, Any]]:
    path = os.path.join(_runs_dir(), "latest.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else None


def load_run(run_id: str) -> Optional[Dict[str, Any]]:
    path = os.path.join(_runs_dir(), f"{run_id}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else None


def public_run(run: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = run if run is not None else load_latest()
    if not payload:
        return {
            "run": None,
            "note": (
                "No lifecycle run yet. Start ml_lifecycle_full or ml_lifecycle_refresh "
                "from ML Lab Jobs."
            ),
            "disclaimer": DISCLAIMER,
        }
    return {"run": payload, "disclaimer": DISCLAIMER}


def _stage(run: Dict[str, Any], stage_id: str) -> Dict[str, Any]:
    for row in run["stages"]:
        if row["id"] == stage_id:
            return row
    raise KeyError(stage_id)


def _set_stage(
    run: Dict[str, Any],
    stage_id: str,
    status: str,
    detail: Optional[str] = None,
    exit_code: Optional[int] = None,
) -> None:
    row = _stage(run, stage_id)
    if status == "RUNNING" and not row.get("startedAt"):
        row["startedAt"] = _now_iso()
    if status in {"PASSED", "FAILED", "SKIPPED", "BLOCKED"}:
        row["finishedAt"] = _now_iso()
    row["status"] = status
    if detail is not None:
        row["detail"] = detail
    if exit_code is not None:
        row["exitCode"] = exit_code
    save_run(run)
    _log(f"stage {stage_id} -> {status}" + (f" ({detail})" if detail else ""))


def _run_python(args: List[str], universe: str, *, with_universe: bool = True) -> int:
    command = [sys.executable, *args]
    if with_universe and "--universe" not in args:
        command.extend(["--universe", universe])
    _log(" ".join(command))
    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    # Inherit stdout/stderr so nested train/ingest lines stream into the Jobs console pipe.
    completed = subprocess.run(  # noqa: S603
        command,
        check=False,
        env=env,
        stdout=None,
        stderr=None,
    )
    return int(completed.returncode)


def _active_horizons() -> List[str]:
    return [horizon for horizon in CORE_HORIZONS if get_active(horizon) is not None]


def _read_json(name: str) -> Dict[str, Any]:
    path = os.path.join(settings.models_dir, name)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def stage_ingest(run: Dict[str, Any], universe: str) -> None:
    _set_stage(run, "INGEST", "RUNNING", "fundamentals + macro + news + social")
    steps = [
        ["-m", "app.ingest_fundamentals"],
        ["-m", "app.ingest_macro"],
        ["-m", "app.ingest_news"],
        ["-m", "app.ingest_social"],
    ]
    for argv in steps:
        use_universe = "ingest_macro" not in argv[1]
        code = _run_python(argv, universe, with_universe=use_universe)
        if code != 0:
            _set_stage(run, "INGEST", "FAILED", f"failed: {' '.join(argv)}", code)
            raise RuntimeError(f"INGEST failed at {' '.join(argv)} exit={code}")
    _set_stage(run, "INGEST", "PASSED", "all ingest jobs exited 0")


def stage_train(run: Dict[str, Any], universe: str) -> None:
    _set_stage(run, "TRAIN_CANDIDATE", "RUNNING", "train -> CANDIDATE only")
    code = _run_python(
        ["-m", "app.train", "--days", "1500", "--trees-only", "--holdout-days", "365"],
        universe,
    )
    if code != 0:
        _set_stage(run, "TRAIN_CANDIDATE", "FAILED", "train failed", code)
        raise RuntimeError(f"TRAIN_CANDIDATE failed exit={code}")
    _set_stage(run, "TRAIN_CANDIDATE", "PASSED", "candidates registered (not ACTIVE)")


def stage_data_quality(run: Dict[str, Any]) -> None:
    _set_stage(run, "DATA_QUALITY", "RUNNING", "read dataset-quality.json")
    report = _read_json("dataset-quality.json")
    if not report:
        _set_stage(run, "DATA_QUALITY", "FAILED", "dataset-quality.json missing after train")
        raise RuntimeError("DATA_QUALITY missing artifact")
    if report.get("passed") is False:
        failures = report.get("hardFailures") or report.get("failures") or ["failed"]
        _set_stage(run, "DATA_QUALITY", "FAILED", f"DQ failed: {failures}")
        raise RuntimeError("DATA_QUALITY gates failed")
    _set_stage(run, "DATA_QUALITY", "PASSED", "dataset quality passed")


def stage_walk_forward(run: Dict[str, Any], universe: str) -> None:
    _set_stage(run, "WALK_FORWARD", "RUNNING", "walk-forward + OOS calibration fit")
    code = _run_python(["-m", "app.walkforward", "--days", "1500"], universe)
    if code != 0:
        _set_stage(run, "WALK_FORWARD", "FAILED", "walkforward failed", code)
        raise RuntimeError(f"WALK_FORWARD failed exit={code}")
    if not _read_json("walkforward.json"):
        _set_stage(run, "WALK_FORWARD", "FAILED", "walkforward.json missing")
        raise RuntimeError("WALK_FORWARD missing artifact")
    _set_stage(run, "WALK_FORWARD", "PASSED", "walkforward.json written")


def stage_calibration(run: Dict[str, Any]) -> None:
    _set_stage(run, "CALIBRATION", "RUNNING", "verify calibration artifacts from walk-forward")
    wf = _read_json("walkforward.json")
    horizons = wf.get("horizons") if isinstance(wf.get("horizons"), dict) else {}
    if not horizons and not os.path.exists(os.path.join(settings.models_dir, "calibration.json")):
        _set_stage(run, "CALIBRATION", "FAILED", "no calibration evidence after walk-forward")
        raise RuntimeError("CALIBRATION missing")
    _set_stage(run, "CALIBRATION", "PASSED", "calibration evidence present")


def stage_promote(run: Dict[str, Any]) -> bool:
    """Attempt promote per core horizon. Returns True if ≥1 ACTIVE after attempt."""
    _set_stage(run, "PROMOTE", "RUNNING", "server-side gates only")
    results: List[str] = []
    any_active = False
    any_blocked = False
    for horizon in CORE_HORIZONS:
        try:
            promoted = promote_horizon(horizon)
            model_id = promoted.get("modelId") if isinstance(promoted, dict) else None
            results.append(f"{horizon}:ACTIVE")
            any_active = True
            _log(f"promoted {horizon} modelId={model_id}")
        except PromoteError as error:
            any_blocked = True
            results.append(f"{horizon}:BLOCKED ({error})")
            _log(f"promote blocked {horizon}: {error}")
        except Exception as error:  # noqa: BLE001
            any_blocked = True
            results.append(f"{horizon}:FAILED ({error})")
            _log(f"promote error {horizon}: {error}")
    # Count already-active as success for downstream predict
    if _active_horizons():
        any_active = True
    detail = "; ".join(results)
    if any_active:
        _set_stage(run, "PROMOTE", "PASSED", detail)
        return True
    if any_blocked:
        _set_stage(run, "PROMOTE", "BLOCKED", detail)
        return False
    _set_stage(run, "PROMOTE", "BLOCKED", detail or "no candidate promoted")
    return False


def stage_predict(run: Dict[str, Any], universe: str, *, require_active: bool) -> None:
    if require_active and not _active_horizons():
        _set_stage(
            run,
            "PREDICT",
            "SKIPPED",
            "no ACTIVE models - CANDIDATE remains; refusing ACTIVE-only serve",
        )
        return
    _set_stage(run, "PREDICT", "RUNNING", "batch predict")
    code = _run_python(["-m", "app.batch", "--all"], universe)
    if code != 0:
        _set_stage(run, "PREDICT", "FAILED", "predict failed", code)
        raise RuntimeError(f"PREDICT failed exit={code}")
    _set_stage(run, "PREDICT", "PASSED", "predictions published")


def stage_drift_score(run: Dict[str, Any], universe: str) -> None:
    if _stage(run, "PREDICT")["status"] == "SKIPPED":
        _set_stage(run, "DRIFT_SCORE", "SKIPPED", "predict skipped")
        return
    _set_stage(run, "DRIFT_SCORE", "RUNNING", "score accuracy ledger")
    code = _run_python(["-m", "app.score"], universe, with_universe=False)
    if code != 0:
        _set_stage(
            run,
            "DRIFT_SCORE",
            "PASSED",
            f"score exited {code} (drift stamps still applied at predict time)",
            code,
        )
        return
    _set_stage(run, "DRIFT_SCORE", "PASSED", "accuracy.json refreshed")


def stage_report(run: Dict[str, Any]) -> None:
    _set_stage(run, "REPORT", "RUNNING", "summarize for ML Lab")
    present = {
        "datasetQuality": bool(_read_json("dataset-quality.json")),
        "walkForward": bool(_read_json("walkforward.json")),
        "accuracy": os.path.exists(os.path.join(settings.models_dir, "accuracy.json")),
        "activeHorizons": _active_horizons(),
    }
    _set_stage(run, "REPORT", "PASSED", json.dumps(present))


def _skip_pending_after(run: Dict[str, Any], after_id: str, reason: str) -> None:
    seen = False
    for row in run["stages"]:
        if row["id"] == after_id:
            seen = True
            continue
        if seen and row["status"] == "PENDING" and row["id"] != "REPORT":
            _set_stage(run, row["id"], "SKIPPED", reason)


def _start_index(run: Dict[str, Any], from_stage: Optional[str]) -> int:
    names = [row["id"] for row in run["stages"]]
    if from_stage:
        if from_stage not in names:
            raise ValueError(f"Unknown stage {from_stage}; choose from {names}")
        return names.index(from_stage)
    for index, row in enumerate(run["stages"]):
        if row["status"] in {"FAILED", "BLOCKED", "PENDING"}:
            return index
    return 0


def execute_run(run: Dict[str, Any], *, from_stage: Optional[str] = None) -> Dict[str, Any]:
    universe = str(run["universe"])
    mode = str(run["mode"])
    start = _start_index(run, from_stage)
    for index, row in enumerate(run["stages"]):
        if index >= start:
            row["status"] = "PENDING"
            row["startedAt"] = None
            row["finishedAt"] = None
            row["detail"] = None
            row["exitCode"] = None
    run["status"] = "RUNNING"
    run["resumeFrom"] = from_stage
    save_run(run)

    stage_ids = [row["id"] for row in run["stages"]]
    total = len(stage_ids)

    try:
        for index, stage_id in enumerate(stage_ids):
            if index < start:
                continue
            _log(f"stage {index + 1}/{total} {stage_id}")
            print(f"[lifecycle] stage {index + 1}/{total}", flush=True)

            if stage_id == "INGEST":
                stage_ingest(run, universe)
            elif stage_id == "TRAIN_CANDIDATE":
                stage_train(run, universe)
            elif stage_id == "DATA_QUALITY":
                stage_data_quality(run)
            elif stage_id == "WALK_FORWARD":
                stage_walk_forward(run, universe)
            elif stage_id == "CALIBRATION":
                stage_calibration(run)
            elif stage_id == "PROMOTE":
                if not stage_promote(run):
                    _skip_pending_after(
                        run,
                        "PROMOTE",
                        "promotion blocked - CANDIDATE remains; ACTIVE predict skipped",
                    )
            elif stage_id == "PREDICT":
                # Always serve ACTIVE only - full or refresh.
                stage_predict(run, universe, require_active=True)
                if mode == "refresh" and _stage(run, "PREDICT")["status"] == "SKIPPED":
                    _set_stage(
                        run,
                        "PREDICT",
                        "FAILED",
                        "refresh requires ACTIVE models - promote a candidate first",
                    )
                    raise RuntimeError("PREDICT refresh requires ACTIVE")
            elif stage_id == "DRIFT_SCORE":
                stage_drift_score(run, universe)
            elif stage_id == "REPORT":
                stage_report(run)
            else:
                _set_stage(run, stage_id, "FAILED", f"unknown stage {stage_id}")
                raise RuntimeError(f"unknown stage {stage_id}")

        statuses = {row["status"] for row in run["stages"]}
        if "FAILED" in statuses:
            run["status"] = "FAILED"
        elif "BLOCKED" in statuses:
            run["status"] = "BLOCKED"
        elif statuses <= {"PASSED", "SKIPPED"}:
            run["status"] = "PASSED"
        else:
            run["status"] = "FAILED"
    except Exception as error:  # noqa: BLE001
        run["status"] = "FAILED"
        _log(f"run failed: {error}")
        save_run(run)
        raise
    finally:
        run["finishedAt"] = _now_iso()
        save_run(run)
        _log(f"run {run['runId']} status={run['status']}")

    return run


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="ML lifecycle orchestration (M1–M4)")
    parser.add_argument("--mode", choices=("full", "refresh"), default="full")
    parser.add_argument("--universe", default="all")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--from-stage", default=None)
    parser.add_argument("--run-id", default=None)
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.resume or args.run_id:
        run = load_run(args.run_id) if args.run_id else load_latest()
        if not run:
            _log("no prior run to resume - starting new")
            run = new_run(args.mode, args.universe)
        else:
            run["mode"] = args.mode
            run["universe"] = args.universe
    else:
        run = new_run(args.mode, args.universe)

    save_run(run)
    _log(f"runId={run['runId']} mode={run['mode']} universe={run['universe']}")
    try:
        execute_run(run, from_stage=args.from_stage)
    except Exception:  # noqa: BLE001
        return 1
    return 0 if run.get("status") in {"PASSED", "BLOCKED"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
