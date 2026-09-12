"""Richer path labels: forward return, MFE, MAE (M3).

Uses adjusted close series. Classification labels remain the primary train target;
regression targets feed secondary heads and Trade Intelligence (not Gate).
"""
from __future__ import annotations

from typing import Dict, Tuple

import numpy as np
import pandas as pd


def forward_return(close: pd.Series, horizon_bars: int) -> pd.Series:
    return close.shift(-horizon_bars) / close - 1.0


def max_favorable_excursion(high: pd.Series, close: pd.Series, horizon_bars: int) -> pd.Series:
    """Best favorable move over the next ``horizon_bars`` (long-biased MFE)."""
    future_max = high[::-1].rolling(horizon_bars, min_periods=1).max()[::-1].shift(-1)
    # Align window to (t+1 .. t+h): use rolling on shifted highs
    vals = []
    arr_h = high.to_numpy(dtype=float)
    arr_c = close.to_numpy(dtype=float)
    n = len(arr_c)
    out = np.full(n, np.nan, dtype=float)
    for i in range(n):
        j = i + horizon_bars
        if j >= n:
            break
        window = arr_h[i + 1 : j + 1]
        if window.size == 0 or not np.isfinite(arr_c[i]) or arr_c[i] == 0:
            continue
        out[i] = float(np.nanmax(window) / arr_c[i] - 1.0)
    return pd.Series(out, index=close.index)


def max_adverse_excursion(low: pd.Series, close: pd.Series, horizon_bars: int) -> pd.Series:
    """Worst adverse move over the next ``horizon_bars`` (long-biased MAE, typically <= 0)."""
    arr_l = low.to_numpy(dtype=float)
    arr_c = close.to_numpy(dtype=float)
    n = len(arr_c)
    out = np.full(n, np.nan, dtype=float)
    for i in range(n):
        j = i + horizon_bars
        if j >= n:
            break
        window = arr_l[i + 1 : j + 1]
        if window.size == 0 or not np.isfinite(arr_c[i]) or arr_c[i] == 0:
            continue
        out[i] = float(np.nanmin(window) / arr_c[i] - 1.0)
    return pd.Series(out, index=close.index)


def path_label_frame(
    candles: pd.DataFrame,
    horizon_bars: int,
) -> pd.DataFrame:
    """Build forwardReturn / MFE / MAE columns from OHLC (adjusted)."""
    close = candles["close"]
    high = candles["high"] if "high" in candles.columns else close
    low = candles["low"] if "low" in candles.columns else close
    return pd.DataFrame(
        {
            "forwardReturn": forward_return(close, horizon_bars),
            "maxFavorableExcursion": max_favorable_excursion(high, close, horizon_bars),
            "maxAdverseExcursion": max_adverse_excursion(low, close, horizon_bars),
        },
        index=candles.index,
    )


def assert_mfe_mae_consistency(fwd: np.ndarray, mfe: np.ndarray, mae: np.ndarray) -> None:
    """Sanity: MFE >= forwardReturn >= MAE when all finite (long path)."""
    mask = np.isfinite(fwd) & np.isfinite(mfe) & np.isfinite(mae)
    if not mask.any():
        return
    if not np.all(mfe[mask] + 1e-9 >= fwd[mask]):
        raise AssertionError("MFE must be >= forwardReturn")
    if not np.all(fwd[mask] + 1e-9 >= mae[mask]):
        raise AssertionError("forwardReturn must be >= MAE")
