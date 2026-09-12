"""Point-in-time (PIT) enforcement — hard fail on future leakage.

Every panel / feature join must satisfy:
  available_at <= feature_timestamp

Training must not silently absorb future information.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

import numpy as np
import pandas as pd

# Canonical PIT field names (snake_case in Python; camelCase on wire).
PIT_FIELDS = (
    "symbol",
    "feature_timestamp",
    "source_timestamp",
    "available_at",
    "effective_from",
    "effective_to",
)


class PitLeakageError(ValueError):
    """Raised when available_at is after the feature/as-of timestamp."""


@dataclass(frozen=True)
class PitViolation:
    symbol: Optional[str]
    feature_timestamp: object
    available_at: object
    detail: str


def _to_utc_ns(values) -> np.ndarray:
    ts = pd.to_datetime(values, utc=True, errors="coerce")
    # pandas DatetimeArray → int64 ns; NaT becomes iNaT
    return ts.view("int64") if hasattr(ts, "view") else np.asarray(ts.astype("int64"))


def find_pit_violations(
    feature_timestamp,
    available_at,
    symbols: Optional[Sequence[Optional[str]]] = None,
) -> List[PitViolation]:
    """Return rows where available_at > feature_timestamp (strict leakage)."""
    feat = _to_utc_ns(feature_timestamp)
    avail = _to_utc_ns(available_at)
    if len(feat) != len(avail):
        raise ValueError(
            f"PIT length mismatch: feature_timestamp={len(feat)} available_at={len(avail)}"
        )
    # Valid comparable pairs only (ignore NaT on either side).
    nat = np.iinfo(np.int64).min
    comparable = (feat != nat) & (avail != nat)
    leaked = comparable & (avail > feat)
    violations: List[PitViolation] = []
    idxs = np.flatnonzero(leaked)
    for index in idxs[:50]:  # cap detail volume
        sym = None
        if symbols is not None and index < len(symbols):
            sym = symbols[index]
        violations.append(
            PitViolation(
                symbol=None if sym is None else str(sym),
                feature_timestamp=pd.Timestamp(feat[index], unit="ns", tz="UTC"),
                available_at=pd.Timestamp(avail[index], unit="ns", tz="UTC"),
                detail="available_at > feature_timestamp",
            )
        )
    if len(idxs) > 50:
        violations.append(
            PitViolation(
                symbol=None,
                feature_timestamp=None,
                available_at=None,
                detail=f"... and {len(idxs) - 50} more PIT violations",
            )
        )
    return violations


def assert_no_pit_leakage(
    feature_timestamp,
    available_at,
    symbols: Optional[Sequence[Optional[str]]] = None,
    *,
    context: str = "dataset",
) -> None:
    """Hard-fail training/serving if any future information is present."""
    violations = find_pit_violations(feature_timestamp, available_at, symbols)
    if not violations:
        return
    sample = violations[0]
    raise PitLeakageError(
        f"PIT leakage in {context}: {len(violations)} violation(s). "
        f"Example symbol={sample.symbol} feature_timestamp={sample.feature_timestamp} "
        f"available_at={sample.available_at}. "
        f"Rule: available_at must be <= feature_timestamp."
    )


def assert_panel_schema(panel: pd.DataFrame, *, context: str = "panel") -> None:
    """Require available_at (and time/source timestamps when present)."""
    if panel is None or panel.empty:
        return
    if "available_at" not in panel.columns:
        raise PitLeakageError(
            f"PIT schema violation in {context}: missing required column 'available_at'"
        )


def assert_joined_panel_pit(
    bar_times_ms: Iterable,
    merged: pd.DataFrame,
    *,
    context: str = "asof_join",
) -> None:
    """After merge_asof, assert no joined available_at is after the bar time."""
    if merged is None or merged.empty or "available_at" not in merged.columns:
        return
    has = merged["available_at"].notna()
    if not bool(has.any()):
        return
    bars = pd.to_datetime(list(bar_times_ms), unit="ms", utc=True, errors="coerce")
    # Align to merged index length
    if len(bars) != len(merged):
        bars = pd.to_datetime(merged.get("time", bars), utc=True, errors="coerce")
    assert_no_pit_leakage(
        bars[has.to_numpy()],
        merged.loc[has, "available_at"],
        context=context,
    )
