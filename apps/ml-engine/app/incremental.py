"""Bulk freshness checks so incremental run_all does not HTTP-loop 4,500 names."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Sequence, Set

from .config import CORE_HORIZONS, settings
from .data import _pg_fetch
from .feature_cache import feature_cache_populated

IST = timezone(timedelta(hours=5, minutes=30))


def ist_session_utc_day(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local = current.astimezone(IST)
    return datetime(local.year, local.month, local.day, tzinfo=timezone.utc)


def _as_list(symbols: Iterable[str]) -> List[str]:
    return [str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()]


def _fresh_set(query: str, *args) -> Set[str]:
    try:
        rows = _pg_fetch(query, *args)
    except Exception:
        return set()
    return {str(row["symbol"]).upper() for row in rows if row.get("symbol")}


def fresh_fundamentals(symbols: Sequence[str]) -> Set[str]:
    names = _as_list(symbols)
    if not names:
        return set()
    return _fresh_set(
        """
        SELECT DISTINCT symbol
        FROM fundamental_snapshots
        WHERE symbol = ANY($1::text[])
          AND available_at >= NOW() - INTERVAL '7 days'
        """,
        names,
    )


def fresh_daily(table: str, symbols: Sequence[str], day: datetime | None = None) -> Set[str]:
    names = _as_list(symbols)
    if not names:
        return set()
    session = (day or ist_session_utc_day()).date()
    if table not in ("news_daily_features", "social_daily_features"):
        raise ValueError(table)
    return _fresh_set(
        f"""
        SELECT DISTINCT symbol
        FROM {table}
        WHERE symbol = ANY($1::text[])
          AND as_of_date::date = $2::date
        """,
        names,
        session,
    )


def daily_table_has_today(table: str, day: datetime | None = None) -> bool:
    if table not in ("news_daily_features", "social_daily_features", "macro_daily_features"):
        raise ValueError(table)
    session = (day or ist_session_utc_day()).date()
    try:
        rows = _pg_fetch(
            f"""
            SELECT 1 AS ok
            FROM {table}
            WHERE as_of_date::date = $1::date
            LIMIT 1
            """,
            session,
        )
    except Exception:
        return False
    return bool(rows)


def macro_is_fresh(day: datetime | None = None) -> bool:
    return daily_table_has_today("macro_daily_features", day)


def stale_symbols(symbols: Sequence[str], fresh: Set[str]) -> List[str]:
    return [symbol for symbol in _as_list(symbols) if symbol not in fresh]


def latest_candle_times(symbols: Sequence[str]) -> Dict[str, int]:
    names = _as_list(symbols)
    if not names:
        return {}
    try:
        rows = _pg_fetch(
            """
            SELECT symbol, MAX(time) AS last_time
            FROM candles
            WHERE timeframe = '1d' AND symbol = ANY($1::text[])
            GROUP BY symbol
            """,
            names,
        )
    except Exception:
        return {}
    out: Dict[str, int] = {}
    for row in rows:
        if row.get("last_time") is None:
            continue
        out[str(row["symbol"]).upper()] = int(row["last_time"])
    return out


def cache_last_times(symbols: Sequence[str] | None = None) -> Dict[str, int]:
    wanted = set(_as_list(symbols)) if symbols is not None else None
    from .feature_cache import cache_dir, load_last_times_manifest, _write_last_times_manifest

    times = load_last_times_manifest()
    if not times:
        directory = cache_dir()
        if os.path.isdir(directory):
            import pandas as pd

            rebuilt: Dict[str, int] = {}
            for name in os.listdir(directory):
                if not name.endswith(".parquet"):
                    continue
                symbol = name[: -len(".parquet")].upper()
                try:
                    series = pd.read_parquet(os.path.join(directory, name), columns=["time"])["time"]
                    if len(series):
                        rebuilt[symbol] = int(series.max())
                except Exception:
                    continue
            if rebuilt:
                _write_last_times_manifest(rebuilt)
                times = rebuilt
    if wanted is None:
        return times
    return {symbol: times[symbol] for symbol in wanted if symbol in times}


def has_new_feature_bars(symbols: Sequence[str]) -> bool:
    names = _as_list(symbols)
    if not names or not feature_cache_populated():
        return True
    candles = latest_candle_times(names)
    cached = cache_last_times(names)
    for symbol in names:
        last_candle = candles.get(symbol)
        if last_candle is None:
            continue
        last_cache = cached.get(symbol)
        if last_cache is None or last_candle > last_cache:
            return True
    return False


def live_models_ready() -> bool:
    return all(
        os.path.exists(os.path.join(settings.models_dir, horizon, "metadata.json"))
        for horizon in CORE_HORIZONS
    )


def predictions_ready() -> bool:
    path = os.path.join(settings.models_dir, "latest-predictions.json")
    return os.path.isfile(path) and os.path.getsize(path) > 2


def ingest_is_fresh(symbols: Sequence[str]) -> bool:
    names = _as_list(symbols)
    if not names:
        return False
    if not macro_is_fresh():
        return False
    fresh_f = fresh_fundamentals(names)
    if len(fresh_f) < max(1, int(0.8 * len(names))):
        return False
    if not daily_table_has_today("news_daily_features"):
        return False
    if not daily_table_has_today("social_daily_features"):
        return False
    return True


def pipeline_is_fresh(symbols: Sequence[str]) -> bool:
    """True when ingest, feature cache, live models, and predictions need no work."""
    names = _as_list(symbols)
    if not names:
        return False
    if not ingest_is_fresh(names):
        return False
    if not live_models_ready() or not predictions_ready():
        return False
    if has_new_feature_bars(names):
        return False
    return True
