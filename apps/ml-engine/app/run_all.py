"""Run the ML Lab pipeline for one universe.

Default is incremental: skip-if-fresh ingest → train (feature cache + refit) → predict.
`--full` rebuilds ingest, wipes the feature cache, and also runs walk-forward,
costed backtest, and unusual-activity. A first run with an empty cache behaves like `--full`.

Usage:
    python -m app.run_all --universe nifty50
    python -m app.run_all --universe all --full
"""
from __future__ import annotations

import argparse
import signal
import subprocess
import sys
from typing import List, Optional, Tuple

from .data import load_universe
from .feature_cache import feature_cache_populated, wipe_feature_cache
from .incremental import (
    has_new_feature_bars,
    ingest_is_fresh,
    live_models_ready,
    pipeline_is_fresh,
    predictions_ready,
)
from .universes import add_full_arg, add_universe_arg, normalize_universe

INGEST_TRAIN_PREDICT: List[Tuple[str, List[str]]] = [
    ("ingest_fundamentals", ["-m", "app.ingest_fundamentals"]),
    ("ingest_macro", ["-m", "app.ingest_macro"]),
    ("ingest_news", ["-m", "app.ingest_news"]),
    ("ingest_social", ["-m", "app.ingest_social"]),
    ("train_all", ["-m", "app.train", "--days", "1500", "--trees-only", "--holdout-days", "365"]),
    ("predict_all", ["-m", "app.batch", "--all"]),
]

VALIDATE_STEPS: List[Tuple[str, List[str]]] = [
    ("walk_forward", ["-m", "app.walkforward", "--days", "1500"]),
    ("ml_backtest", ["-m", "app.ml_backtest", "--days", "1500"]),
    ("train_manipulation", ["-m", "app.train_manipulation"]),
]

_child: Optional[subprocess.Popen] = None


def _stop(_signum=None, _frame=None) -> None:
    if _child is not None:
        _child.terminate()
    raise SystemExit(1)


def _steps(full: bool) -> List[Tuple[str, List[str]]]:
    if full:
        return [*INGEST_TRAIN_PREDICT, *VALIDATE_STEPS]
    return list(INGEST_TRAIN_PREDICT)


def main() -> None:
    global _child
    parser = argparse.ArgumentParser(description="Run all ML Lab jobs for one universe")
    add_universe_arg(parser)
    add_full_arg(parser)
    args = parser.parse_args()
    basket = normalize_universe(args.universe)
    first_run = not feature_cache_populated()
    if args.full:
        wipe_feature_cache()
        print("[run-all] --full: wiped feature cache", flush=True)
        full = True
    elif first_run:
        print("[run-all] no feature cache yet — running full pipeline once", flush=True)
        full = True
    else:
        full = False
        symbols = load_universe(basket)
        if pipeline_is_fresh(symbols):
            print(
                f"[run-all] cached: {len(symbols)} symbols, ingest/features/models/predictions current",
                flush=True,
            )
            print("[run-all] done", flush=True)
            return
        print(f"[run-all] universe={basket} mode=incremental", flush=True)
        steps: List[Tuple[str, List[str]]] = []
        if not ingest_is_fresh(symbols):
            steps.extend(INGEST_TRAIN_PREDICT[:4])
        if not live_models_ready() or has_new_feature_bars(symbols):
            steps.append(INGEST_TRAIN_PREDICT[4])
        if not predictions_ready() or has_new_feature_bars(symbols):
            steps.append(INGEST_TRAIN_PREDICT[5])
        if not steps:
            print("[run-all] cached: nothing to do", flush=True)
            print("[run-all] done", flush=True)
            return
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, _stop)
        total = len(steps)
        print(f"[run-all] universe={basket} mode=incremental steps={total}", flush=True)
        for index, (kind, argv) in enumerate(steps, start=1):
            print(f"[run-all] step {index}/{total} {kind}", flush=True)
            command = [sys.executable, *argv, "--universe", basket]
            print(f"[run-all] {' '.join(command)}", flush=True)
            _child = subprocess.Popen(command)  # noqa: S603
            code = _child.wait()
            _child = None
            if code != 0:
                print(f"[run-all] failed at {kind} exit={code}", flush=True)
                raise SystemExit(code)
        print("[run-all] done", flush=True)
        return
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _stop)
    steps = _steps(full)
    mode = "full" if full else "incremental"
    total = len(steps)
    print(f"[run-all] universe={basket} mode={mode} steps={total}", flush=True)
    extra_kinds = {
        "ingest_fundamentals",
        "ingest_macro",
        "ingest_news",
        "ingest_social",
        "train_all",
    }
    for index, (kind, argv) in enumerate(steps, start=1):
        print(f"[run-all] step {index}/{total} {kind}", flush=True)
        extra = ["--full"] if args.full and kind in extra_kinds else []
        command = [sys.executable, *argv, "--universe", basket, *extra]
        print(f"[run-all] {' '.join(command)}", flush=True)
        _child = subprocess.Popen(command)  # noqa: S603
        code = _child.wait()
        _child = None
        if code != 0:
            print(f"[run-all] failed at {kind} exit={code}", flush=True)
            raise SystemExit(code)
    print("[run-all] done", flush=True)


if __name__ == "__main__":
    main()
