"""Ingest Yahoo fundamentals via market-data-service (point-in-time snapshots).

Usage:
    python -m app.ingest_fundamentals --universe nifty50
"""
from __future__ import annotations

import argparse

import httpx

from .config import settings
from .data import load_universe
from .incremental import fresh_fundamentals, stale_symbols
from .universes import add_full_arg, add_universe_arg, normalize_universe


def ingest_symbol(symbol: str, full: bool = False) -> tuple[int, bool]:
    params = {"full": "1"} if full else {}
    response = httpx.post(
        f"{settings.market_data_url}/stocks/{symbol}/fundamentals/ingest",
        params=params,
        timeout=45.0,
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.is_error:
        detail = payload.get("message") or payload.get("reason") or response.text[:240]
        if isinstance(detail, list):
            detail = "; ".join(str(item) for item in detail)
        raise RuntimeError(f"HTTP {response.status_code}: {detail}")
    if payload.get("cached"):
        return 0, True
    if payload.get("skipped"):
        raise RuntimeError(str(payload.get("reason") or "no Yahoo fundamentals"))
    return int(payload.get("snapshots") or 0), False


def refresh_sector_medians() -> None:
    try:
        httpx.post(
            f"{settings.market_data_url}/fundamentals/refresh-sector-medians",
            timeout=60.0,
        ).raise_for_status()
    except Exception as error:  # noqa: BLE001
        print(f"[fundamentals] sector median refresh skipped: {error}", flush=True)


def run(universe: str, full: bool = False) -> None:
    basket = normalize_universe(universe)
    symbols = load_universe(basket)
    print(f"[universe] {basket}: {len(symbols)} constituents", flush=True)
    targets = symbols
    cached = 0
    if not full:
        fresh = fresh_fundamentals(symbols)
        if len(fresh) >= max(1, int(0.8 * len(symbols))):
            print(f"[fundamentals] cached {len(fresh)}/{len(symbols)}", flush=True)
            print(
                f"[fundamentals] done ok={len(symbols)} failed=0 rows=0 cached={len(fresh)}",
                flush=True,
            )
            return
        targets = stale_symbols(symbols, fresh)
    ok = 0
    failed = 0
    snapshots = 0
    for index, symbol in enumerate(targets):
        try:
            count, was_cached = ingest_symbol(symbol, full=full)
            snapshots += count
            ok += 1
            if was_cached:
                cached += 1
                print(
                    f"[fundamentals] {index + 1}/{len(targets)} {symbol}: cached",
                    flush=True,
                )
            else:
                print(
                    f"[fundamentals] {index + 1}/{len(targets)} {symbol}: {count} snapshots",
                    flush=True,
                )
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(f"[fundamentals] {symbol} skipped: {error}", flush=True)
    refresh_sector_medians()
    print(
        f"[fundamentals] done ok={ok} failed={failed} rows={snapshots} cached={cached}",
        flush=True,
    )
    if ok == 0 and cached == 0:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Yahoo fundamentals")
    add_universe_arg(parser)
    add_full_arg(parser)
    args = parser.parse_args()
    run(args.universe, full=args.full)


if __name__ == "__main__":
    main()
