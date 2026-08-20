"""Ingest Reddit (live) + optional Google Trends into PIT social features.

Usage:
    python -m app.ingest_social --universe nifty50
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

import httpx

from .alt_aggregate import aggregate_social_daily
from .config import settings
from .data import load_universe
from .incremental import daily_table_has_today
from .nlp import score_headline
from .universes import add_full_arg, add_universe_arg, normalize_universe


def _reddit_posts(symbol: str) -> list[dict]:
    posts: list[dict] = []
    for sub in ("IndiaInvestments", "IndianStreetBets", "stocks"):
        try:
            response = httpx.get(
                f"https://www.reddit.com/r/{sub}/search.json",
                params={"q": symbol, "restrict_sr": "1", "sort": "new", "limit": 25, "t": "month"},
                headers={"User-Agent": "StockPredSocial/1.0"},
                timeout=12.0,
            )
            if response.is_error:
                continue
            for child in response.json().get("data", {}).get("children", []):
                data = child.get("data") or {}
                title = data.get("title") or ""
                if not title:
                    continue
                text = f"{title} {data.get('selftext') or ''}".strip()
                created = datetime.fromtimestamp(float(data.get("created_utc") or 0), tz=timezone.utc)
                scored = score_headline(text)
                posts.append(
                    {
                        "symbol": symbol,
                        "author": data.get("author") or "unknown",
                        "text": text,
                        "available_at": created,
                        "sentiment": scored["sentiment"],
                    }
                )
        except Exception:
            continue
    return posts


def _trends(symbol: str) -> dict[str, float]:
    try:
        from pytrends.request import TrendReq  # type: ignore
    except Exception:
        return {}
    try:
        trend = TrendReq(hl="en-IN", tz=330)
        trend.build_payload([symbol], timeframe="today 3-m")
        frame = trend.interest_over_time()
        if frame is None or frame.empty or symbol not in frame.columns:
            return {}
        series = frame[symbol].astype(float)
        latest = float(series.iloc[-7:].mean()) if len(series) else 0.0
        prev = float(series.iloc[-14:-7].mean()) if len(series) > 14 else latest
        return {"trends": latest, "trends_prev": prev}
    except Exception:
        return {}


def ingest_symbol(symbol: str, full: bool = False) -> tuple[int, bool]:
    params = {"full": "1"} if full else {}
    try:
        response = httpx.post(
            f"{settings.market_data_url}/stocks/{symbol}/alt-data/social/ingest",
            params=params,
            timeout=45.0,
        )
    except httpx.TimeoutException as error:
        raise RuntimeError("timed out") from error
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if not response.is_error and payload.get("cached"):
        return 0, True
    if response.is_error or payload.get("skipped"):
        raise RuntimeError(str(payload.get("reason") or payload.get("message") or f"HTTP {response.status_code}"))
    return int(payload.get("snapshots") or 0), False


def run(universe: str, full: bool = False) -> None:
    basket = normalize_universe(universe)
    if basket == "all":
        print(
            "[social] universe all: Reddit search times out on 4500 names - using nifty500",
            flush=True,
        )
        basket = "nifty500"
    symbols = load_universe(basket)
    print(f"[universe] {basket}: {len(symbols)} constituents", flush=True)
    if not full and daily_table_has_today("social_daily_features"):
        print("[social] cached (today's session already ingested)", flush=True)
        print(f"[social] done ok={len(symbols)} failed=0 rows=0 cached={len(symbols)}", flush=True)
        return
    ok = 0
    failed = 0
    rows = 0
    cached = 0
    for index, symbol in enumerate(symbols):
        try:
            count, was_cached = ingest_symbol(symbol, full=full)
            rows += count
            ok += 1
            if was_cached:
                cached += 1
                print(f"[social] {index + 1}/{len(symbols)} {symbol}: cached", flush=True)
            else:
                print(f"[social] {index + 1}/{len(symbols)} {symbol}: {count} daily rows", flush=True)
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(f"[social] {symbol} skipped: {error}", flush=True)
    print(f"[social] done ok={ok} failed={failed} rows={rows} cached={cached}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest social attention features")
    add_universe_arg(parser)
    add_full_arg(parser)
    args = parser.parse_args()
    run(args.universe, full=args.full)


if __name__ == "__main__":
    main()
