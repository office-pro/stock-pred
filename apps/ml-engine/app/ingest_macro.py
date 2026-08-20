"""Ingest Yahoo/FRED macro into point-in-time daily features.

Usage:
    python -m app.ingest_macro
"""
from __future__ import annotations

import argparse

import httpx

from .config import settings
from .incremental import macro_is_fresh
from .universes import add_full_arg


def run(full: bool = False) -> None:
    if not full and macro_is_fresh():
        print("[macro] cached", flush=True)
        return
    params = {"full": "1"} if full else {}
    response = httpx.post(
        f"{settings.market_data_url}/alt-data/ingest/macro",
        params=params,
        timeout=180.0,
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.is_error:
        detail = payload or response.text[:240]
        hint = ""
        text = str(detail).lower()
        if "does not exist" in text or response.status_code == 500:
            hint = " If tables are missing, run `npm run prisma:migrate` then retry."
        raise SystemExit(f"[macro] HTTP {response.status_code}: {detail}.{hint}")
    if payload.get("cached"):
        print("[macro] cached", flush=True)
        return
    print(
        f"[macro] done observations={payload.get('observations', 0)} daily={payload.get('daily', 0)}",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest macro series")
    parser.add_argument("--universe", default="all", help="ignored; macro is global")
    add_full_arg(parser)
    args = parser.parse_args()
    run(full=args.full)


if __name__ == "__main__":
    main()
