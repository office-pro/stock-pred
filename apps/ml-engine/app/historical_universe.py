"""Point-in-time historical universe membership (M3).

Prevents survivorship bias: a bar on date D may only use symbols that were
members as-of D (not today's survivors).

Snapshots live under ``{models_dir}/universe-snapshots/`` as JSON files:
``{ "asOf": "YYYY-MM-DD", "universe": "nifty50", "symbols": ["TCS", ...] }``
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Set

from .config import settings

SNAPSHOT_DIRNAME = "universe-snapshots"


class HistoricalUniverseError(ValueError):
    """Raised when PIT membership cannot be resolved safely."""


def _snapshots_dir() -> str:
    path = os.path.join(settings.models_dir, SNAPSHOT_DIRNAME)
    os.makedirs(path, exist_ok=True)
    return path


def _parse_as_of(value) -> str:
    if value is None:
        raise HistoricalUniverseError("as_of date is required")
    if isinstance(value, (int, float)):
        # epoch ms or seconds
        ts = float(value)
        if ts > 1e12:
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    text = str(value)
    if "T" in text:
        text = text.split("T", 1)[0]
    return text[:10]


def save_universe_snapshot(
    *,
    universe: str,
    as_of: str,
    symbols: Sequence[str],
) -> str:
    """Persist a membership snapshot for later PIT lookups."""
    as_of_day = _parse_as_of(as_of)
    payload = {
        "asOf": as_of_day,
        "universe": universe,
        "symbols": sorted({str(s).upper() for s in symbols if s}),
        "savedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    directory = os.path.join(_snapshots_dir(), universe)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{as_of_day}.json")
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp, path)
    return path


def list_snapshot_dates(universe: str) -> List[str]:
    directory = os.path.join(_snapshots_dir(), universe)
    if not os.path.isdir(directory):
        return []
    dates = []
    for name in os.listdir(directory):
        if name.endswith(".json"):
            dates.append(name[:-5])
    return sorted(dates)


def _load_snapshot(universe: str, as_of_day: str) -> Optional[Dict[str, object]]:
    path = os.path.join(_snapshots_dir(), universe, f"{as_of_day}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else None


def membership_as_of(
    universe: str,
    as_of,
    *,
    fallback_symbols: Optional[Sequence[str]] = None,
    require_snapshot: bool = False,
) -> Set[str]:
    """Return symbols that were members on ``as_of`` (UTC date).

    Uses the latest snapshot with ``asOf <= as_of``. If none exist:
    - ``require_snapshot=True`` → raise
    - else use ``fallback_symbols`` (typically today's basket) and callers
      must record a DQ warning that PIT history is incomplete.
    """
    as_of_day = _parse_as_of(as_of)
    dates = [d for d in list_snapshot_dates(universe) if d <= as_of_day]
    if dates:
        payload = _load_snapshot(universe, dates[-1])
        if payload:
            return {str(s).upper() for s in (payload.get("symbols") or [])}
    if require_snapshot:
        raise HistoricalUniverseError(
            f"No universe snapshot for {universe} on/before {as_of_day}"
        )
    if fallback_symbols is None:
        return set()
    return {str(s).upper() for s in fallback_symbols if s}


def filter_times_by_membership(
    symbol: str,
    times_ms: Sequence[int],
    *,
    universe: str,
    fallback_symbols: Optional[Sequence[str]] = None,
) -> List[bool]:
    """Boolean mask: True when ``symbol`` was a member on that bar's date."""
    symbol_u = symbol.upper()
    # Cache membership by day for speed.
    cache: Dict[str, Set[str]] = {}
    mask: List[bool] = []
    for ts in times_ms:
        day = _parse_as_of(ts)
        if day not in cache:
            cache[day] = membership_as_of(
                universe, day, fallback_symbols=fallback_symbols, require_snapshot=False
            )
        members = cache[day]
        # If no snapshots exist at all, membership_as_of returns fallback —
        # treat as member only if listed in fallback (today's book).
        mask.append(symbol_u in members if members else False)
    return mask


def pit_violation_count(
    symbol: str,
    times_ms: Sequence[int],
    *,
    universe: str,
    fallback_symbols: Optional[Sequence[str]] = None,
) -> int:
    """Count bars where symbol appears without as-of membership."""
    mask = filter_times_by_membership(
        symbol, times_ms, universe=universe, fallback_symbols=fallback_symbols
    )
    # Violation = row present but not a member. If no snapshots, fallback means
    # today's survivors — still count as potential survivorship risk via warning,
    # not hard violation unless snapshots exist.
    if not list_snapshot_dates(universe):
        return 0
    return sum(1 for ok in mask if not ok)
