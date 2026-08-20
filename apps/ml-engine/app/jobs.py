"""Background ML jobs with live logs and parsed progress for the ML Lab UI.

One job at a time. Maps to the dedicated npm script for the selected universe:
  run_all            -> incremental ingest + train + predict (full pipeline on --full or empty cache)
  ingest_fundamentals -> npm run ingest:fundamentals -- --universe nifty50 | …
  ingest_fundamentals -> npm run ingest:fundamentals -- --universe nifty50 | …
  ingest_alt_data    -> python -m app.ingest_alt --universe nifty50 | …
  ingest_macro       -> python -m app.ingest_macro
  ingest_news        -> python -m app.ingest_news --universe nifty50 | …
  ingest_social      -> python -m app.ingest_social --universe nifty50 | …
  train_all          -> npm run train:ml:nifty50 | … (trees + 365d holdout)
  walk_forward       -> npm run walkforward:nifty50 | …
  ml_backtest        -> npm run backtest:ml:nifty50 | …
  predict_all        -> npm run predict:nifty50 | … | predict:all
  train_manipulation -> npm run train:ml:manipulation:nifty50 | …
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
    "run_all": {
        "title": "Run all",
        "npm": "python -m app.run_all",
        "blurb": "Incremental ingest (skip if fresh) → train from the feature cache → predict. Walk-forward, costed backtest, and unusual-activity run on first cache fill or with python -m app.run_all --full.",
        "args": ["-m", "app.run_all"],
        "horizons": 6,
    },
    "ingest_fundamentals": {
        "title": "Ingest fundamentals",
        "npm": "npm run ingest:fundamentals -- --universe all",
        "blurb": "Yahoo statements into point-in-time snapshots. Run this before train if you want FA columns in the same trees.",
        "args": ["-m", "app.ingest_fundamentals"],
        "horizons": 1,
    },
    "ingest_alt_data": {
        "title": "Ingest alternative data",
        "npm": "python -m app.ingest_alt",
        "blurb": "Macro, news, and social for this universe — Yahoo/FRED, RSS+GDELT, Reddit/Trends — then retrain so the same trees pick up the new columns.",
        "args": ["-m", "app.ingest_alt"],
        "horizons": 3,
    },
    "ingest_macro": {
        "title": "Ingest macro",
        "npm": "python -m app.ingest_macro",
        "blurb": "Yahoo FX/commodities/indices plus FRED CPI/policy rate, stored with release-dated available_at.",
        "args": ["-m", "app.ingest_macro"],
        "horizons": 1,
    },
    "ingest_news": {
        "title": "Ingest news",
        "npm": "python -m app.ingest_news",
        "blurb": "RSS + GDELT headlines scored at ingest (FinBERT if USE_FINBERT=1). Daily 1d/7d/30d windows, PIT join.",
        "args": ["-m", "app.ingest_news"],
        "horizons": 1,
    },
    "ingest_social": {
        "title": "Ingest social",
        "npm": "python -m app.ingest_social",
        "blurb": "Reddit mentions plus optional Google Trends. Attention spike and coordination feed the same trees and the unusual-activity head.",
        "args": ["-m", "app.ingest_social"],
        "horizons": 1,
    },
    "train_all": {
        "title": "Train direction models",
        "npm": "npm run train:ml:all",
        "blurb": "XGBoost + LightGBM on a time-series holdout (last 365 days). Ingest fundamentals first if those columns should be in the same trees.",
        "args": ["-m", "app.train", "--days", "1500", "--trees-only", "--holdout-days", "365"],
        "horizons": 2,
    },
    "walk_forward": {
        "title": "Walk-forward validate",
        "npm": "npm run walkforward:ml",
        "blurb": "Retrain trees on expanding yearly folds. Honest hit-rate. Does not replace live models.",
        "args": ["-m", "app.walkforward", "--days", "1500"],
        "horizons": 2,
    },
    "ml_backtest": {
        "title": "ML costed backtest",
        "npm": "npm run backtest:ml",
        "blurb": "Replay Buy chips with NSE delivery STT/brokerage/stamp and 5 bps slippage. Needs trained models.",
        "args": ["-m", "app.ml_backtest", "--days", "1500"],
        "horizons": 1,
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
MLBT_RE = re.compile(r"\[ml-backtest\] (\d+)/(\d+)")
FOLD_RE = re.compile(r"\[walkforward\] fold (\d+)/(\d+)")
FUND_RE = re.compile(r"\[fundamentals\] (\d+)/(\d+)")
NEWS_RE = re.compile(r"\[news\] (\d+)/(\d+)")
SOCIAL_RE = re.compile(r"\[social\] (\d+)/(\d+)")
RUNALL_RE = re.compile(r"\[(?:run-all|alt-data)\] step (\d+)/(\d+)")
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
    if kind == "run_all":
        return f"python -m app.run_all --universe {basket}"
    if kind == "ingest_fundamentals":
        return f"npm run ingest:fundamentals -- --universe {basket}"
    if kind == "ingest_alt_data":
        return f"python -m app.ingest_alt --universe {basket}"
    if kind == "ingest_macro":
        return "python -m app.ingest_macro"
    if kind == "ingest_news":
        return f"python -m app.ingest_news --universe {basket}"
    if kind == "ingest_social":
        return f"python -m app.ingest_social --universe {basket}"
    if kind == "train_all":
        return "npm run train:ml:all" if basket == "all" else f"npm run train:ml:{basket}"
    if kind == "predict_all":
        return "npm run predict:all" if basket == "all" else f"npm run predict:{basket}"
    if kind == "walk_forward":
        return "npm run walkforward:ml" if basket == "all" else f"npm run walkforward:{basket}"
    if kind == "ml_backtest":
        return "npm run backtest:ml" if basket == "all" else f"npm run backtest:ml:{basket}"
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

    runall = RUNALL_RE.search(line)
    if runall:
        current, total = int(runall.group(1)), int(runall.group(2))
        job["current"] = current
        job["total"] = total
        job["percent"] = int(min(99, max(3, ((current - 1) / total) * 98))) if total else 3
        job["stage"] = f"Step {current}/{total}"
        return

    fund = FUND_RE.search(line) or NEWS_RE.search(line) or SOCIAL_RE.search(line)
    if fund:
        current, total = int(fund.group(1)), int(fund.group(2))
        job["current"] = current
        job["total"] = total
        job["percent"] = int(min(99, max(3, (current / total) * 98))) if total else 3
        job["stage"] = f"Ingest {current}/{total}"
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

    fold = FOLD_RE.search(line)
    if fold:
        current, total = int(fold.group(1)), int(fold.group(2))
        job["current"] = current
        job["total"] = total
        job["percent"] = int(min(99, max(3, (current / total) * 98))) if total else 3
        job["stage"] = f"Fold {current}/{total}"
        return

    batch = BATCH_RE.search(line) or CACHED_RE.search(line) or MLBT_RE.search(line)
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
    elif "holdout hitrate" in lowered:
        job["percent"] = min(90, max(int(job.get("percent") or 0), 70))
        job["stage"] = "Holdout scored"
    elif "walkforward.json" in lowered or "ml-backtest.json" in lowered:
        job["percent"] = 99
        job["stage"] = "Report written"
    elif _is_job_complete_line(kind, lowered):
        job["percent"] = 100
        job["stage"] = "Complete"


def _is_job_complete_line(kind: str, lowered: str) -> bool:
    """Inner ingest `[macro] done` must not complete run_all / ingest_alt_data early."""
    if kind == "run_all":
        return lowered.startswith("[run-all] done")
    if kind == "ingest_alt_data":
        return lowered.startswith("[alt-data] done")
    if kind == "ingest_fundamentals":
        return lowered.startswith("[fundamentals] done")
    if kind == "ingest_macro":
        return lowered.startswith("[macro] done")
    if kind == "ingest_news":
        return lowered.startswith("[news] done")
    if kind == "ingest_social":
        return lowered.startswith("[social] done")
    if kind == "train_all":
        return lowered.startswith("[train] done")
    if kind == "train_manipulation":
        return lowered.startswith("[train-manipulation] done")
    if kind == "walk_forward":
        return lowered.startswith("[walkforward] done")
    if kind == "ml_backtest":
        return lowered.startswith("[ml-backtest] done")
    if kind == "predict_all":
        return "[batch] wrote" in lowered
    return lowered.startswith("[run-all] done")


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
        if kind == "ml_backtest" and not direction_models_ready():
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
