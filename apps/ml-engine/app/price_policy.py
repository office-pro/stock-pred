"""Canonical price-adjustment policy (M3).

ML features, labels, backtests, and outcome compares must use ADJUSTED prices.
Raw OHLC may be retained for diagnostics only.

Hard rule: do not silently label on raw when adjusted is missing.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd

from .config import settings

PRICE_POLICY_VERSION = "price-policy.v1"
CANONICAL_MODE = "ADJUSTED"
ALLOWED_MODES = ("ADJUSTED", "RAW")


class PricePolicyError(ValueError):
    """Raised when price-adjustment policy is violated."""


def policy_stamp(
    *,
    mode: str = CANONICAL_MODE,
    source: str = "provider_or_corp_actions",
) -> Dict[str, str]:
    if mode not in ALLOWED_MODES:
        raise PricePolicyError(f"Unknown priceAdjustmentMode={mode}")
    return {
        "priceAdjustmentMode": mode,
        "pricePolicyVersion": PRICE_POLICY_VERSION,
        "adjustmentSource": source,
    }


def assert_canonical_mode(mode: Optional[str], *, context: str) -> None:
    if mode != CANONICAL_MODE:
        raise PricePolicyError(
            f"Price policy mismatch in {context}: got {mode!r}, "
            f"required {CANONICAL_MODE!r} ({PRICE_POLICY_VERSION})"
        )


def assert_same_mode(left: Optional[str], right: Optional[str], *, context: str) -> None:
    if left != right:
        raise PricePolicyError(
            f"Price policy mismatch in {context}: {left!r} vs {right!r}"
        )


def _corp_actions_path() -> str:
    return os.path.join(settings.models_dir, "corp-actions.json")


def load_corp_actions() -> Dict[str, list]:
    path = _corp_actions_path()
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def _split_factor_as_of(events: list, as_of_day: str) -> float:
    """Cumulative split factor to bring historical prices to today's basis."""
    factor = 1.0
    for event in events or []:
        day = str(event.get("exDate") or event.get("date") or "")[:10]
        if not day or day <= as_of_day:
            # Event already effective for this bar — included in price already
            # for forward adjustment we multiply bars *before* ex-date.
            continue
        ratio = float(event.get("splitFactor") or event.get("factor") or 1.0)
        if ratio > 0:
            factor *= ratio
    return factor


def ensure_adjusted_candles(
    candles: pd.DataFrame,
    *,
    symbol: str,
    synthetic: bool = False,
) -> pd.DataFrame:
    """Return frame with close_raw + close (adjusted) and policy columns.

    Preference order:
    1. Provider ``adj_close`` / ``adjClose`` column
    2. Corp-action split factors from corp-actions.json
    3. Synthetic identity (adjusted == raw) with explicit source stamp
    4. Otherwise leave close_adjusted as NaN (caller must drop unlabeled rows)
    """
    if candles is None or candles.empty:
        return candles
    out = candles.copy()
    if "close" not in out.columns:
        raise PricePolicyError("candles missing close column")

    out["close_raw"] = pd.to_numeric(out["close"], errors="coerce")
    adj = None
    source = "missing"

    for candidate in ("adj_close", "adjClose", "adjusted_close", "close_adjusted"):
        if candidate in out.columns:
            adj = pd.to_numeric(out[candidate], errors="coerce")
            source = "provider"
            break

    if adj is None:
        events = load_corp_actions().get(symbol.upper()) or load_corp_actions().get(symbol)
        if events and "time" in out.columns:
            days = pd.to_datetime(out["time"], unit="ms", utc=True, errors="coerce")
            factors = []
            for day in days:
                if pd.isna(day):
                    factors.append(np.nan)
                else:
                    factors.append(_split_factor_as_of(events, day.strftime("%Y-%m-%d")))
            adj = out["close_raw"] / np.asarray(factors, dtype=float)
            # When factor is 1 everywhere this is identity via corp-actions table.
            source = "corp_actions"
        elif synthetic:
            adj = out["close_raw"]
            source = "synthetic_identity"
        elif os.getenv("ML_PRICE_ALLOW_CLOSE_AS_ADJUSTED", "1") not in (
            "0",
            "false",
            "False",
        ):
            # Yahoo daily close is typically split-adjusted but unmarked in-repo.
            # Explicit stamp — DQ may hard-fail when verified adj is required.
            adj = out["close_raw"]
            source = "close_as_adjusted_unverified"
        else:
            adj = pd.Series(np.nan, index=out.index)
            source = "missing"

    out["close_adjusted"] = adj
    # Canonical close used by features/labels = adjusted when present.
    out["close"] = out["close_adjusted"]
    # Scale OHLC consistently when we have a finite adj/raw ratio.
    ratio = out["close_adjusted"] / out["close_raw"].replace(0, np.nan)
    for col in ("open", "high", "low"):
        if col in out.columns:
            raw_col = f"{col}_raw"
            out[raw_col] = pd.to_numeric(out[col], errors="coerce")
            out[col] = out[raw_col] * ratio

    stamp = policy_stamp(mode=CANONICAL_MODE, source=source)
    for key, value in stamp.items():
        out[key] = value
    return out


def drop_rows_missing_adjusted(features: pd.DataFrame) -> pd.DataFrame:
    if features is None or features.empty:
        return features
    if "close_adjusted" in features.columns:
        return features[features["close_adjusted"].notna()].copy()
    if "close" in features.columns:
        return features[features["close"].notna()].copy()
    return features


def read_mode_from_frame(frame: Optional[pd.DataFrame]) -> Optional[str]:
    if frame is None or frame.empty:
        return None
    if "priceAdjustmentMode" in frame.columns:
        values = frame["priceAdjustmentMode"].dropna().unique()
        if len(values) == 1:
            return str(values[0])
        if len(values) > 1:
            raise PricePolicyError(f"Mixed priceAdjustmentMode in frame: {list(values)}")
    return None


def require_canonical_candles(frame: Optional[pd.DataFrame], *, context: str) -> str:
    """Hard-fail unless ``frame`` is stamped with the canonical ADJUSTED mode."""
    mode = read_mode_from_frame(frame)
    assert_canonical_mode(mode, context=context)
    return str(mode)


def model_price_mode(metadata: Optional[Dict[str, Any]]) -> Optional[str]:
    """Extract priceAdjustmentMode from train metadata (top-level or pricePolicy)."""
    if not metadata:
        return None
    mode = metadata.get("priceAdjustmentMode")
    if mode:
        return str(mode)
    nested = metadata.get("pricePolicy")
    if isinstance(nested, dict) and nested.get("mode"):
        return str(nested["mode"])
    return None


def assert_outcome_modes(
    prediction_mode: Optional[str],
    outcome_mode: Optional[str],
    *,
    context: str = "outcome",
) -> None:
    """Outcome compares require prediction and outcome bars to share ADJUSTED mode."""
    assert_canonical_mode(prediction_mode, context=f"{context}:prediction")
    assert_canonical_mode(outcome_mode, context=f"{context}:outcome")
    assert_same_mode(prediction_mode, outcome_mode, context=context)
