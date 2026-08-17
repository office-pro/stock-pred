"""Background ML jobs with live logs and parsed progress for the ML Lab UI.

One job at a time. Maps to the dedicated npm script for the selected universe:
  train_all          -> npm run train:ml:nifty50 | nifty100 | nifty500 | smallcap | all
  predict_all        -> npm run predict:nifty50 | … | predict:all
  train_manipulation -> npm run train:ml:manipulation:nifty50 | … | train:ml:manipulation
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
import uuid
from typing import Dict, List, Optional

from .config import CORE_HORIZONS, settings
from .universes import (
    UNIVERSE_IDS,
    UNIVERSE_META,
    catalog as universe_catalog,
    normalize_universe,
)

MAX_LINES = 600

JOB_SPECS: Dict[str, Dict[str, object]] = {
    "train_all": {
        "title": "Train direction models",
        "npm": "npm run train:ml:all",
        "blurb": "XGBoost, LightGBM, LSTM and Transformer on ~1500 daily bars for the selected universe.",
        "args": ["-m", "app.train", "--days", "1500"],
        "horizons": 2,
    },
    "predict_all": {
        "title": "Predict stocks",
        "npm": "npm run predict:all",
        "blurb": "Score the selected universe. Requires a finished train:ml:* run first — models are shared.",
        "args": ["-m", "app.batch", "--all"],
        "horizons": 1,
    },
    "train_manipulation": {
        "title": "Train unusual-activity model",
        "npm": "npm run train:ml:manipulation",
        "blurb": "Separate LightGBM/XGBoost investigate head. Not a finding of market abuse.",
        "args": ["-m", "app.train_manipulation"],
        "horizons": 1,
    },
}

FEATURES_RE = re.compile(r"features (\d+)/(\d+)")
BATCH_RE = re.compile(r"\[batch\] (\d+)/(\d+)")
UNIVERSE_RE = re.compile(
    r"(?:\[universe\] \w+: (\d+) (?:listed|constituents)|universe: (\d+) symbols|scoring (\d+) symbols)"
)
HORIZON_RE = re.compile(r"horizon=([A-Z0-9_]+)")
CACHED_RE = re.compile(r"cached (\d+)/(\d+)")

_lock = threading.Lock()
_current: Optional[Dict[str, object]] = None
_process: Optional[subprocess.Popen] = None


def npm_script(kind: str, universe: str = "all") -> str:
    """Dedicated npm script for this job + universe. Never train:ml:all for a Nifty basket."""
    if kind not in JOB_SPECS:
        raise ValueError(f"Unknown job kind: {kind}")
    basket = normalize_universe(universe)
    if kind == "train_all":
        return "npm run train:ml:all" if basket == "all" else f"npm run train:ml:{basket}"
    if kind == "predict_all":
        return "npm run predict:all" if basket == "all" else f"npm run predict:{basket}"
    if kind == "train_manipulation":
        return (
            "npm run train:ml:manipulation"
            if basket == "all"
            else f"npm run train:ml:manipulation:{basket}"
        )
    raise ValueError(f"Unknown job kind: {kind}")


def direction_models_ready() -> bool:
    return all(
        os.path.exists(os.path.join(settings.models_dir, horizon, "metadata.json"))
        for horizon in CORE_HORIZONS
    )


def missing_models_message(universe: str = "all") -> str:
    cmd = npm_script("train_all", universe)
    return (
        f"No trained models in {settings.models_dir}. "
        f"Run `{cmd}` first (direction models are shared across Nifty 50/100/500)."
    )


def catalog() -> List[Dict[str, object]]:
    return [
        {
            "kind": kind,
            "title": str(spec["title"]),
            "npm": npm_script(kind, "all"),
            "npmByUniverse": {uid: npm_script(kind, uid) for uid in UNIVERSE_IDS},
            "blurb": str(spec["blurb"]),
        }
        for kind, spec in JOB_SPECS.items()
    ]


def snapshot() -> Dict[str, object]:
    with _lock:
        job = None if _current is None else dict(_current)
        if job and isinstance(job.get("lines"), list):
            job["lines"] = list(job["lines"])
    return {
        "job": job,
        "available": catalog(),
        "universes": universe_catalog(),
        "modelsTrained": direction_models_ready(),
    }


def apply_progress(job: Dict[str, object], line: str) -> None:
    """Update percent / stage / counters from a log line. Pure enough to unit-test."""
    kind = str(job.get("kind", ""))
    spec = JOB_SPECS.get(kind, {})
    horizon_count = max(int(spec.get("horizons") or 1), 1)

    universe = UNIVERSE_RE.search(line)
    if universe:
        total = int(next(group for group in universe.groups() if group))
        job["total"] = total
        job["stage"] = f"Loaded {total} stocks"
        job["percent"] = max(int(job.get("percent") or 0), 2)
        return

    horizon = HORIZON_RE.search(line)
    if horizon:
        name = horizon.group(1)
        seen = list(job.get("horizonsSeen") or [])
        if name not in seen:
            seen.append(name)
        job["horizonsSeen"] = seen
        job["stage"] = f"Training {name}"
        return

    feat = FEATURES_RE.search(line)
    if feat:
        current, total = int(feat.group(1)), int(feat.group(2))
        job["current"] = current
        job["total"] = total
        done_horizons = max(len(list(job.get("horizonsSeen") or [])) - 1, 0)
        frac = current / total if total else 0.0
        overall = (done_horizons + frac) / horizon_count
        job["percent"] = int(min(92, max(3, overall * 92)))
        job["stage"] = f"Features {current}/{total}"
        return

    batch = BATCH_RE.search(line) or CACHED_RE.search(line)
    if batch:
        current, total = int(batch.group(1)), int(batch.group(2))
        job["current"] = current
        job["total"] = total
        job["percent"] = int(min(99, max(3, (current / total) * 98))) if total else 3
        job["stage"] = f"Scoring {current}/{total}"
        return

    lowered = line.lower()
    if "xgboost saved" in lowered:
        job["percent"] = min(96, max(int(job.get("percent") or 0), 88))
        job["stage"] = "XGBoost saved"
    elif "lightgbm saved" in lowered:
        job["percent"] = min(97, max(int(job.get("percent") or 0), 92))
        job["stage"] = "LightGBM saved"
    elif "lstm saved" in lowered:
        job["percent"] = min(98, max(int(job.get("percent") or 0), 94))
        job["stage"] = "LSTM saved"
    elif "transformer saved" in lowered:
        job["percent"] = min(99, max(int(job.get("percent") or 0), 96))
        job["stage"] = "Transformer saved"
    elif "artifacts written" in lowered:
        job["percent"] = 99
        job["stage"] = "Writing artifacts"
    elif "wrote " in lowered and "predictions" in lowered:
        job["percent"] = 99
        job["stage"] = "Predictions written"
    elif lowered.startswith("[train] done") or lowered.startswith("[train-manipulation] done") or "[batch] wrote" in lowered:
        job["percent"] = 100
        job["stage"] = "Complete"


def start(kind: str, universe: str = "all") -> Dict[str, object]:
    if kind not in JOB_SPECS:
        raise ValueError(f"Unknown job kind: {kind}")
    basket = normalize_universe(universe)
    label = UNIVERSE_META[basket]["label"]
    global _current, _process
    with _lock:
        if _current and _current.get("status") == "running":
            raise RuntimeError("A job is already running")
        spec = JOB_SPECS[kind]
        npm = npm_script(kind, basket)
        if kind == "predict_all" and not direction_models_ready():
            raise ValueError(missing_models_message(basket))
        argv = [*spec["args"], "--universe", basket]
        job: Dict[str, object] = {
            "id": str(uuid.uuid4()),
            "kind": kind,
            "title": f"{spec['title']} · {label}",
            "npm": npm,
            "universe": basket,
            "status": "running",
            "percent": 1,
            "stage": "Starting",
            "detail": npm,
            "current": 0,
            "total": 0,
            "horizonsSeen": [],
            "lines": [f"$ {npm}", f"# python {' '.join(argv)}"],
            "startedAt": int(time.time() * 1000),
            "finishedAt": None,
            "exitCode": None,
            "error": None,
        }
        _current = job
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        _process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            [sys.executable, *argv],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
        threading.Thread(target=_pump, args=(_process, job), daemon=True).start()
        return dict(job)


def cancel() -> Dict[str, object]:
    global _process
    with _lock:
        if _process is None or _current is None or _current.get("status") != "running":
            raise RuntimeError("No running job to cancel")
        proc = _process
        _current["stage"] = "Cancelling"
        _append_unlocked(_current, "^C cancelled from ML Lab")
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
    return snapshot()


def _append_unlocked(job: Dict[str, object], line: str) -> None:
    lines = job.setdefault("lines", [])
    if not isinstance(lines, list):
        return
    lines.append(line)
    if len(lines) > MAX_LINES:
        del lines[: len(lines) - MAX_LINES]


def _pump(proc: subprocess.Popen, job: Dict[str, object]) -> None:
    global _process
    try:
        assert proc.stdout is not None
        for raw in iter(proc.stdout.readline, ""):
            line = raw.rstrip("\n")
            with _lock:
                if job is not _current:
                    break
                _append_unlocked(job, line)
                apply_progress(job, line)
        code = proc.wait()
        with _lock:
            if job is _current:
                job["exitCode"] = code
                job["finishedAt"] = int(time.time() * 1000)
                if code == 0:
                    job["status"] = "succeeded"
                    job["percent"] = 100
                    job["stage"] = "Complete"
                    _append_unlocked(job, f"[ml-lab] finished with exit code {code}")
                else:
                    job["status"] = "cancelled" if job.get("stage") == "Cancelling" else "failed"
                    if job["status"] == "cancelled":
                        job["stage"] = "Cancelled"
                    else:
                        job["stage"] = f"Failed (exit {code})"
                    job["error"] = f"exit {code}"
                    _append_unlocked(job, f"[ml-lab] stopped with exit code {code}")
    except Exception as error:  # noqa: BLE001
        with _lock:
            if job is _current:
                job["status"] = "failed"
                job["error"] = str(error)
                job["stage"] = "Failed"
                job["finishedAt"] = int(time.time() * 1000)
                _append_unlocked(job, f"[ml-lab] error: {error}")
    finally:
        with _lock:
            if _process is proc:
                _process = None
