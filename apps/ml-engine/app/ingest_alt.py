"""Ingest macro, news, and social for one universe (ML Lab alt-data option).

Usage:
    python -m app.ingest_alt --universe nifty50
"""
from __future__ import annotations

import argparse
import signal
import subprocess
import sys
from typing import Optional

from .universes import add_full_arg, add_universe_arg, normalize_universe

STEPS = [
    ("ingest_macro", ["-m", "app.ingest_macro"]),
    ("ingest_news", ["-m", "app.ingest_news"]),
    ("ingest_social", ["-m", "app.ingest_social"]),
]

_child: Optional[subprocess.Popen] = None


def _stop(_signum=None, _frame=None) -> None:
    if _child is not None:
        _child.terminate()
    raise SystemExit(1)


def main() -> None:
    global _child
    parser = argparse.ArgumentParser(description="Ingest alternative data (macro, news, social)")
    add_universe_arg(parser)
    add_full_arg(parser)
    args = parser.parse_args()
    basket = normalize_universe(args.universe)
    extra = ["--full"] if args.full else []
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _stop)
    total = len(STEPS)
    print(f"[alt-data] universe={basket} steps={total}", flush=True)
    for index, (kind, argv) in enumerate(STEPS, start=1):
        print(f"[alt-data] step {index}/{total} {kind}", flush=True)
        command = [sys.executable, *argv, "--universe", basket, *extra]
        print(f"[alt-data] {' '.join(command)}", flush=True)
        _child = subprocess.Popen(command)  # noqa: S603
        code = _child.wait()
        _child = None
        if code != 0:
            print(f"[alt-data] failed at {kind} exit={code}", flush=True)
            raise SystemExit(code)
    print("[alt-data] done", flush=True)


if __name__ == "__main__":
    main()
