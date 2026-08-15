"""Candle loading: market-data-service REST with a synthetic offline fallback."""
import math
from typing import Dict, List, Optional

import httpx
import pandas as pd

from .config import FALLBACK_SYMBOLS, settings

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
    frame = fetch_candles(symbol, limit, is_index)
    if frame is not None and len(frame) >= min(limit, 260):
        return frame
    if allow_synthetic:
        return synthetic_candles(symbol, limit)
    raise RuntimeError(
        f"No real market data available for {symbol} "
        "(market-data-service offline and no cache); refusing synthetic substitution"
    )


def load_universe() -> List[str]:
    """Load universe from market-data-service, database, or fallback.

    Priority:
    1. Market-data-service /stocks endpoint (if >=150 stocks)
    2. Database direct query (to get all seeded stocks)
    3. Fallback hardcoded list (20 stocks)
    """
    # Try market-data-service first (stocks already loaded in memory)
    try:
        response = httpx.get(f"{settings.market_data_url}/stocks?limit=5000", timeout=10.0)
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and "data" in data:
            symbols = [row["symbol"] for row in data["data"]]
        else:
            symbols = [row["symbol"] for row in data] if data else []

        if len(symbols) >= 150:
            print(f"Loaded {len(symbols)} stocks from market-data-service")
            return symbols
        elif len(symbols) > 0:
            print(f"Found only {len(symbols)} stocks from market-data-service, trying database...")
    except Exception as e:
        print(f"Market-data-service unavailable: {e}, trying database...")

    # Try database as fallback (has all seeded stocks)
    try:
        import asyncpg
        import asyncio

        async def fetch_from_db() -> List[str]:
            conn = await asyncpg.connect(settings.asyncpg_dsn)
            rows = await conn.fetch("SELECT symbol FROM stock")
            await conn.close()
            return [row["symbol"] for row in rows]

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        symbols = loop.run_until_complete(fetch_from_db())
        loop.close()

        if len(symbols) >= 150:
            print(f"Loaded {len(symbols)} stocks from database")
            return symbols
        elif len(symbols) > 0:
            print(f"Found only {len(symbols)} stocks from database, falling back to hardcoded list...")
    except Exception as e:
        print(f"Database query failed: {e}, using fallback...")

    # Last resort: hardcoded fallback (20 stocks)
    print(f"Using {len(FALLBACK_SYMBOLS)} fallback stocks")
    return list(FALLBACK_SYMBOLS)


def load_market_context(limit: int) -> Dict[str, pd.DataFrame]:
    """Index series used for market features (Nifty/Midcap trend, India VIX).

    A missing index series degrades to an empty frame (the feature builder
    fills neutral zeros) - never to synthetic index data.
    """
    context: Dict[str, pd.DataFrame] = {}
    for key, symbol in INDEX_SYMBOLS.items():
        frame = fetch_candles(symbol, limit, is_index=True)
        context[key] = frame if frame is not None else pd.DataFrame()
    return context
