"""Candle loading: Postgres first, then market-data REST, then optional synthetic."""
import asyncio
import math
from functools import lru_cache
from typing import Dict, List, Optional

import httpx
import numpy as np
import pandas as pd

from .config import FALLBACK_SYMBOLS, settings
from .universes import basket_symbols, describe_filter, normalize_universe

DAY_MS = 86_400_000

INDEX_SYMBOLS = {
    "nifty": "NIFTY_50",
    "midcap": "NIFTY_MIDCAP_100",
    "vix": "INDIA_VIX",
}


def _mulberry32(seed: int):
    state = seed & 0xFFFFFFFF

    def rng() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rng


def _seed_from_symbol(symbol: str) -> int:
    h = 2166136261
    for ch in symbol:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def synthetic_candles(symbol: str, days: int, base_price: float = 1000.0) -> pd.DataFrame:
    """Deterministic GBM series mirroring the Node simulated provider's scheme."""
    rng = _mulberry32(_seed_from_symbol(symbol))

    def gaussian() -> float:
        u, v = 0.0, 0.0
        while u == 0.0:
            u = rng()
        while v == 0.0:
            v = rng()
        return math.sqrt(-2.0 * math.log(u)) * math.cos(2.0 * math.pi * v)

    daily_drift = 0.0004
    daily_vol = 0.016
    rows = []
    price = base_price
    end = pd.Timestamp.utcnow().normalize()
    for i in range(days - 1, -1, -1):
        shock = gaussian() * daily_vol * (1 + 0.25 * math.sin((days - i) / 40))
        open_ = price
        close = price * math.exp(daily_drift + shock)
        wick = abs(gaussian()) * daily_vol * 0.7
        rows.append(
            {
                "time": int((end - pd.Timedelta(days=i)).timestamp() * 1000),
                "open": open_,
                "high": max(open_, close) * (1 + wick),
                "low": min(open_, close) * (1 - wick),
                "close": close,
                "volume": int(500_000 * (0.6 + rng())),
            }
        )
        price = close
    frame = pd.DataFrame(rows)
    # Anchor the latest close on the reference price (mirrors the Node provider).
    scale = base_price / frame["close"].iloc[-1]
    for column in ("open", "high", "low", "close"):
        frame[column] = (frame[column] * scale).round(2)
    return frame


_pg_loop: Optional[asyncio.AbstractEventLoop] = None
_pg_pool = None


def _pg_fetch(query: str, *args):
    """Reuse one asyncpg pool so universe scans are not 4,500 TCP handshakes."""
    global _pg_loop, _pg_pool
    import asyncpg

    if _pg_loop is None:
        _pg_loop = asyncio.new_event_loop()

    async def _run():
        global _pg_pool
        if _pg_pool is None:
            _pg_pool = await asyncpg.create_pool(settings.asyncpg_dsn, min_size=1, max_size=4)
        async with _pg_pool.acquire() as conn:
            return await conn.fetch(query, *args)

    return _pg_loop.run_until_complete(_run())


def fetch_candles_db(symbol: str, limit: int) -> Optional[pd.DataFrame]:
    """Daily bars from Postgres `candles`. None when the table is empty or unreachable."""
    try:
        rows = _pg_fetch(
            """
            SELECT time, open, high, low, close, volume
            FROM candles
            WHERE symbol = $1 AND timeframe = '1d'
            ORDER BY time DESC
            LIMIT $2
            """,
            symbol,
            int(limit),
        )
    except Exception:
        return None
    if not rows:
        return None
    frame = pd.DataFrame(
        [
            {
                "time": int(row["time"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
            }
            for row in reversed(list(rows))
        ]
    )
    return frame


def fetch_candles(symbol: str, limit: int, is_index: bool = False) -> Optional[pd.DataFrame]:
    """Daily candles over REST; None on failure (caller decides the fallback)."""
    path = f"/indices/{symbol}/candles" if is_index else f"/stocks/{symbol}/candles"
    try:
        response = httpx.get(
            f"{settings.market_data_url}{path}",
            params={"timeframe": "1d", "limit": limit},
            timeout=15.0,
        )
        response.raise_for_status()
        data = response.json()
        if not data:
            return None
        frame = pd.DataFrame(data)[["time", "open", "high", "low", "close", "volume"]]
        return frame
    except Exception:
        return None


def load_candles(
    symbol: str, limit: int, is_index: bool = False, allow_synthetic: bool = False
) -> pd.DataFrame:
    """Real candles from the market-data service (which itself serves live
    Yahoo data or its database cache of real candles when offline).

    Synthetic data is NEVER substituted silently: it requires the explicit
    ``allow_synthetic`` opt-in (the --synthetic training flag). Without it,
    a missing feed raises so predictions are only ever made on real data.
    """
    frame = fetch_candles_db(symbol, limit)
    if frame is not None and len(frame) >= 40:
        return frame
    frame = fetch_candles(symbol, limit, is_index)
    if frame is not None and len(frame) >= 40:
        return frame
    if allow_synthetic:
        return synthetic_candles(symbol, limit)
    raise RuntimeError(
        f"No real market data available for {symbol} "
        "(market-data-service offline and no cache); refusing synthetic substitution"
    )


def load_listed_symbols() -> List[str]:
    """Load symbols from market-data (paged), then database, then fallback.

    No minimum-size cutoff: a partial list is better than silently dropping
    to 20 hardcoded names while thousands are still loading.
    """
    try:
        symbols: List[str] = []
        page = 1
        while page <= 20:
            response = httpx.get(
                f"{settings.market_data_url}/stocks",
                params={"page": page, "limit": 1000},
                timeout=15.0,
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict) and "data" in payload:
                rows = payload["data"]
                has_more = bool(payload.get("hasMore"))
            else:
                rows = payload if isinstance(payload, list) else []
                has_more = False
            symbols.extend(row["symbol"] for row in rows if row.get("symbol"))
            if not has_more or not rows:
                break
            page += 1
        if symbols:
            print(f"Listed book: {len(symbols)} symbols from market-data-service", flush=True)
            return symbols
        print("Market-data-service returned no stocks, trying database...")
    except Exception as e:
        print(f"Market-data-service unavailable: {e}, trying database...")

    try:
        import asyncio

        import asyncpg

        async def fetch_from_db() -> List[str]:
            conn = await asyncpg.connect(settings.asyncpg_dsn)
            rows = await conn.fetch(
                "SELECT symbol FROM stocks WHERE listed = true ORDER BY symbol"
            )
            await conn.close()
            return [row["symbol"] for row in rows]

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        symbols = loop.run_until_complete(fetch_from_db())
        loop.close()
        if symbols:
            print(f"Listed book: {len(symbols)} symbols from database", flush=True)
            return symbols
    except Exception as e:
        print(f"Database query failed: {e}, using fallback...")

    print(f"Using {len(FALLBACK_SYMBOLS)} fallback stocks")
    return list(dict.fromkeys(FALLBACK_SYMBOLS))


def load_universe(universe: str = "all") -> List[str]:
    """Listed symbols, optionally an index basket.

    Named baskets (nifty50/100/500/smallcap) use the constituent list directly
    so a Nifty 50 predict does not wait on paging ~4,500 full quotes.
    """
    name = normalize_universe(universe)
    if name != "all":
        kept = basket_symbols(name)
        print(
            f"[universe] {name}: {len(kept)} constituents (skipped full listed-book scan)",
            flush=True,
        )
        return kept
    listed = load_listed_symbols()
    print(describe_filter(len(listed), listed, name), flush=True)
    return listed


@lru_cache(maxsize=8)
def load_market_context(limit: int) -> Dict[str, pd.DataFrame]:
    """Index series used for market features (Nifty/Midcap trend, India VIX).

    Cached per history depth so a 50-name batch does not refetch Nifty/VIX
    on every symbol.
    """
    context: Dict[str, pd.DataFrame] = {}
    for key, symbol in INDEX_SYMBOLS.items():
        frame = fetch_candles(symbol, limit, is_index=True)
        context[key] = frame if frame is not None else pd.DataFrame()
    return context


FUNDAMENTAL_PANEL_COLUMNS = [
    "symbol",
    "available_at",
    "sector",
    "rev_yoy",
    "pat_yoy",
    "eps_yoy",
    "op_margin",
    "net_margin",
    "gross_margin",
    "ebitda_margin",
    "roe",
    "roa",
    "roce",
    "debt_equity",
    "current_ratio",
    "cash_ratio",
    "ocf_pat",
    "fcf_growth",
    "fcf_margin",
    "trailing_eps",
    "book_value",
    "sector_median_pe",
    "promoter_holding",
    "institution_holding",
    "log_ttm_revenue",
]


def _empty_fund_panel() -> pd.DataFrame:
    return pd.DataFrame(columns=FUNDAMENTAL_PANEL_COLUMNS)


def _normalize_fund_panel(frame: pd.DataFrame) -> pd.DataFrame:
    if frame is None or frame.empty:
        return _empty_fund_panel()
    out = frame.copy()
    if "available_at" in out.columns:
        out["available_at"] = pd.to_datetime(out["available_at"], utc=True, errors="coerce")
    if "symbol" in out.columns:
        out["symbol"] = out["symbol"].astype(str).str.upper()
    for column in FUNDAMENTAL_PANEL_COLUMNS:
        if column not in out.columns:
            out[column] = np.nan if column not in ("symbol", "available_at", "sector") else None
    return out[FUNDAMENTAL_PANEL_COLUMNS]


def _fund_panel_from_db() -> Optional[pd.DataFrame]:
    try:
        import asyncio

        import asyncpg

        async def fetch_rows():
            conn = await asyncpg.connect(settings.asyncpg_dsn)
            rows = await conn.fetch(
                """
                SELECT symbol, available_at, sector,
                       rev_yoy, pat_yoy, eps_yoy, op_margin, net_margin, gross_margin,
                       ebitda_margin, roe, roa, roce, debt_equity, current_ratio, cash_ratio,
                       ocf_pat, fcf_growth, fcf_margin, trailing_eps, book_value,
                       sector_median_pe, promoter_holding, institution_holding, revenue
                FROM fundamental_snapshots
                ORDER BY symbol, available_at
                """
            )
            await conn.close()
            return rows

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        rows = loop.run_until_complete(fetch_rows())
        loop.close()
        if not rows:
            return _empty_fund_panel()
        frame = pd.DataFrame([dict(row) for row in rows])
        if "revenue" in frame.columns:
            revenue = pd.to_numeric(frame["revenue"], errors="coerce")
            frame["log_ttm_revenue"] = np.where(revenue > 0, np.log(revenue), np.nan)
            frame = frame.drop(columns=["revenue"])
        return _normalize_fund_panel(frame)
    except Exception:
        return None


def _fund_panel_from_rest() -> Optional[pd.DataFrame]:
    try:
        response = httpx.get(f"{settings.market_data_url}/fundamentals/panel", timeout=30.0)
        response.raise_for_status()
        payload = response.json()
        rows = payload if isinstance(payload, list) else payload.get("data", [])
        if not rows:
            return _empty_fund_panel()
        return _normalize_fund_panel(pd.DataFrame(rows))
    except Exception:
        return None


@lru_cache(maxsize=1)
def load_fundamentals_panel() -> pd.DataFrame:
    """All statement snapshots for point-in-time joins. Empty if none ingested."""
    frame = _fund_panel_from_db()
    if frame is None:
        frame = _fund_panel_from_rest()
    if frame is None:
        frame = _empty_fund_panel()
    names = int(frame["symbol"].nunique()) if not frame.empty else 0
    print(f"[fundamentals] panel: {len(frame)} snapshots across {names} symbols", flush=True)
    return frame


def attach_fundamentals(market: Optional[Dict[str, pd.DataFrame]]) -> Dict[str, pd.DataFrame]:
    context = dict(market or {})
    if "fund_panel" not in context:
        context["fund_panel"] = load_fundamentals_panel()
    return context


NEWS_PANEL_COLUMNS = [
    "symbol",
    "available_at",
    * [
        "news_count_1d",
        "news_count_7d",
        "news_count_30d",
        "news_sent_1d",
        "news_sent_7d",
        "news_sent_30d",
        "news_sent_std_7d",
        "news_sent_change_7d",
        "news_sent_trend_30d",
        "news_pos_7d",
        "news_neg_7d",
        "news_high_impact_7d",
        "news_event_momentum_7d",
        "earnings_sentiment",
    ],
]

SOCIAL_PANEL_COLUMNS = [
    "symbol",
    "available_at",
    "social_mentions_1d",
    "social_mentions_7d",
    "social_mention_growth",
    "social_attention_spike",
    "social_unique_authors_1d",
    "social_sent_1d",
    "social_sent_change",
    "social_bull_ratio_7d",
    "social_bear_ratio_7d",
    "social_coordination",
    "trends_score_7d",
    "trends_change_7d",
]

MACRO_PANEL_COLUMNS = [
    "available_at",
    "usdinr",
    "usdinr_chg_20d",
    "usdinr_chg_60d",
    "brent",
    "brent_chg_20d",
    "gold_chg_20d",
    "us10y",
    "us10y_chg_20d",
    "spx_chg_20d",
    "nasdaq_chg_20d",
    "dxy_chg_20d",
    "india_cpi",
    "india_cpi_chg",
    "repo_rate",
    "repo_chg_90d",
    "fii_flow_20d",
    "dii_flow_20d",
]


def _empty_panel(columns: list) -> pd.DataFrame:
    return pd.DataFrame(columns=columns)


def _normalize_dated_panel(frame: pd.DataFrame, columns: list, has_symbol: bool) -> pd.DataFrame:
    if frame is None or frame.empty:
        return _empty_panel(columns)
    out = frame.copy()
    if "available_at" in out.columns:
        out["available_at"] = pd.to_datetime(out["available_at"], utc=True, errors="coerce")
    if has_symbol and "symbol" in out.columns:
        out["symbol"] = out["symbol"].astype(str).str.upper()
    for column in columns:
        if column not in out.columns:
            out[column] = None if column in ("symbol", "available_at") else np.nan
    return out[columns]


def _panel_from_db(sql: str) -> Optional[pd.DataFrame]:
    try:
        import asyncio

        import asyncpg

        async def fetch_rows():
            conn = await asyncpg.connect(settings.asyncpg_dsn)
            rows = await conn.fetch(sql)
            await conn.close()
            return rows

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        rows = loop.run_until_complete(fetch_rows())
        loop.close()
        if not rows:
            return pd.DataFrame()
        return pd.DataFrame([dict(row) for row in rows])
    except Exception:
        return None


def _panel_from_rest(path: str) -> Optional[pd.DataFrame]:
    try:
        response = httpx.get(f"{settings.market_data_url}{path}", timeout=30.0)
        response.raise_for_status()
        payload = response.json()
        rows = payload if isinstance(payload, list) else payload.get("data", [])
        if not rows:
            return pd.DataFrame()
        return pd.DataFrame(rows)
    except Exception:
        return None


@lru_cache(maxsize=1)
def load_news_panel() -> pd.DataFrame:
    frame = _panel_from_db(
        """
        SELECT symbol, available_at,
               news_count_1d, news_count_7d, news_count_30d,
               news_sent_1d, news_sent_7d, news_sent_30d,
               news_sent_std_7d, news_sent_change_7d, news_sent_trend_30d,
               news_pos_7d, news_neg_7d, news_high_impact_7d, news_event_momentum_7d,
               earnings_sentiment
        FROM news_daily_features
        ORDER BY symbol, available_at
        """
    )
    if frame is None:
        frame = _panel_from_rest("/alt-data/panel/news")
    if frame is None:
        frame = _empty_panel(NEWS_PANEL_COLUMNS)
    out = _normalize_dated_panel(frame, NEWS_PANEL_COLUMNS, True)
    names = int(out["symbol"].nunique()) if not out.empty else 0
    print(f"[news] panel: {len(out)} rows across {names} symbols", flush=True)
    return out


@lru_cache(maxsize=1)
def load_social_panel() -> pd.DataFrame:
    frame = _panel_from_db(
        """
        SELECT symbol, available_at,
               social_mentions_1d, social_mentions_7d, social_mention_growth,
               social_attention_spike, social_unique_authors_1d, social_sent_1d,
               social_sent_change, social_bull_ratio_7d, social_bear_ratio_7d,
               social_coordination, trends_score_7d, trends_change_7d
        FROM social_daily_features
        ORDER BY symbol, available_at
        """
    )
    if frame is None:
        frame = _panel_from_rest("/alt-data/panel/social")
    if frame is None:
        frame = _empty_panel(SOCIAL_PANEL_COLUMNS)
    out = _normalize_dated_panel(frame, SOCIAL_PANEL_COLUMNS, True)
    names = int(out["symbol"].nunique()) if not out.empty else 0
    print(f"[social] panel: {len(out)} rows across {names} symbols", flush=True)
    return out


@lru_cache(maxsize=1)
def load_macro_panel() -> pd.DataFrame:
    frame = _panel_from_db(
        """
        SELECT available_at, usdinr, usdinr_chg_20d, usdinr_chg_60d,
               brent, brent_chg_20d, gold_chg_20d, us10y, us10y_chg_20d,
               spx_chg_20d, nasdaq_chg_20d, dxy_chg_20d,
               india_cpi, india_cpi_chg, repo_rate, repo_chg_90d,
               fii_flow_20d, dii_flow_20d
        FROM macro_daily_features
        ORDER BY available_at
        """
    )
    if frame is None:
        frame = _panel_from_rest("/alt-data/panel/macro")
    if frame is None:
        frame = _empty_panel(MACRO_PANEL_COLUMNS)
    out = _normalize_dated_panel(frame, MACRO_PANEL_COLUMNS, False)
    print(f"[macro] panel: {len(out)} daily rows", flush=True)
    return out


def attach_alt_data(market: Optional[Dict[str, pd.DataFrame]]) -> Dict[str, pd.DataFrame]:
    context = attach_fundamentals(market)
    if "news_panel" not in context:
        context["news_panel"] = load_news_panel()
    if "social_panel" not in context:
        context["social_panel"] = load_social_panel()
    if "macro_panel" not in context:
        context["macro_panel"] = load_macro_panel()
    return context
