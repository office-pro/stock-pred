"""Ingest news headlines, score them, store PIT daily aggregates.

Usage:
    python -m app.ingest_news --universe nifty50
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

import httpx

from .config import settings
from .data import load_universe
from .incremental import daily_table_has_today
from .nlp import score_headline
from .universes import add_full_arg, add_universe_arg, normalize_universe


def remote_news_universe(universe: str) -> str:
    """Google/Yahoo RSS cannot serve 4,500 tickers; `all` uses Nifty 500."""
    basket = normalize_universe(universe)
    if basket == "all":
        print(
            "[news] universe all: skipping per-ticker RSS on 4500 names (timeouts) - using nifty500",
            flush=True,
        )
        return "nifty500"
    return basket

try:
    import xml.etree.ElementTree as ET
except ImportError:  # pragma: no cover
    ET = None  # type: ignore


def _text(el, tag: str) -> str:
    node = el.find(tag)
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def _parse_rss(xml: str, source: str) -> list[dict]:
    if not xml or ET is None:
        return []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    rows = []
    for item in root.findall(".//item"):
        title = _text(item, "title")
        link = _text(item, "link") or _text(item, "guid")
        pub = _text(item, "pubDate")
        if not title or not link:
            continue
        try:
            published = datetime.strptime(pub[:25], "%a, %d %b %Y %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            published = datetime.now(timezone.utc)
        rows.append(
            {
                "source": source,
                "url": link,
                "title": title,
                "publishedAt": published.isoformat(),
            }
        )
    return rows


def _get(url: str) -> str:
    try:
        response = httpx.get(url, timeout=12.0, headers={"User-Agent": "StockPredNews/1.0"})
        if response.is_error:
            return ""
        return response.text
    except Exception:
        return ""


def fetch_headlines(symbol: str) -> list[dict]:
    query = httpx.QueryParams({"q": f"{symbol} NSE stock", "hl": "en-IN", "gl": "IN", "ceid": "IN:en"})
    google = _parse_rss(
        _get(f"https://news.google.com/rss/search?{query}"),
        "google-news",
    )
    yahoo = _parse_rss(
        _get(f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}.NS&region=US&lang=en-US"),
        "yahoo-news",
    )
    gdelt_rows = []
    try:
        response = httpx.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": f"{symbol} sourcelang:eng",
                "mode": "ArtList",
                "maxrecords": 30,
                "format": "json",
                "timespan": "3months",
            },
            timeout=15.0,
        )
        if not response.is_error:
            for article in response.json().get("articles", []):
                url = article.get("url")
                title = article.get("title")
                seen = str(article.get("seendate") or "")
                if not url or not title:
                    continue
                published = datetime.now(timezone.utc)
                if len(seen) >= 8:
                    published = datetime(
                        int(seen[0:4]),
                        int(seen[4:6]),
                        int(seen[6:8]),
                        tzinfo=timezone.utc,
                    )
                gdelt_rows.append(
                    {
                        "source": "gdelt",
                        "url": url,
                        "title": title,
                        "publishedAt": published.isoformat(),
                    }
                )
    except Exception:
        pass
    seen = set()
    out = []
    for row in [*google, *yahoo, *gdelt_rows]:
        key = row["url"].split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        scored = score_headline(row["title"])
        row.update(scored)
        out.append(row)
    return out


def ingest_symbol(symbol: str, full: bool = False) -> tuple[int, bool]:
    params = {"full": "1"} if full else {}
    try:
        response = httpx.post(
            f"{settings.market_data_url}/stocks/{symbol}/alt-data/news/ingest",
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
    basket = remote_news_universe(universe)
    symbols = load_universe(basket)
    print(f"[universe] {basket}: {len(symbols)} constituents", flush=True)
    if not full and daily_table_has_today("news_daily_features"):
        print("[news] cached (today's session already ingested)", flush=True)
        print(f"[news] done ok={len(symbols)} failed=0 rows=0 cached={len(symbols)}", flush=True)
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
                print(f"[news] {index + 1}/{len(symbols)} {symbol}: cached", flush=True)
            else:
                print(f"[news] {index + 1}/{len(symbols)} {symbol}: {count} daily rows", flush=True)
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(f"[news] {symbol} skipped: {error}", flush=True)
    print(f"[news] done ok={ok} failed={failed} rows={rows} cached={cached}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest news fundamentals-style")
    add_universe_arg(parser)
    add_full_arg(parser)
    args = parser.parse_args()
    run(args.universe, full=args.full)


if __name__ == "__main__":
    main()
