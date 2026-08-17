"""Feature engineering (spec):
OHLCV + indicators (RSI, MACD, VWAP, ATR, EMA20/50/200)
+ market features (Nifty trend, Midcap trend, India VIX, sector strength)
+ sentiment features (news, earnings - pluggable; neutral stub by default).
"""
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "return_1d",
    "return_5d",
    "return_20d",
    "rsi",
    "macd_norm",
    "macd_hist_norm",
    "atr_pct",
    "ema20_dist",
    "ema50_dist",
    "ema200_dist",
    "vwap_dist",
    "bb_width",
    "volume_ratio",
    "high_low_range",
    "close_position",
    "nifty_trend",
    "midcap_trend",
    "vix_level",
    "vix_change",
    "sector_strength",
    "news_sentiment",
    "earnings_sentiment",
]

# Separate from direction models. Used by the unusual-activity (investigate) head.
MANIPULATION_FEATURE_COLUMNS = [
    "return_1d",
    "return_5d",
    "return_10d",
    "return_20d",
    "gap",
    "high_low_range",
    "close_position",
    "vol_7",
    "vol_14",
    "vol_30",
    "drawdown_20",
    "return_acceleration",
    "volume_ratio",
    "volume_zscore_20",
    "volume_zscore_60",
    "volume_acceleration",
    "rel_return_1d",
    "rel_return_5d",
    "rel_return_20d",
    "signed_return_volume_z",
    "atr_pct",
    "vix_level",
    "vix_change",
]


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.fillna(100.0).where(avg_loss.notna(), np.nan)


def macd(series: pd.Series) -> Tuple[pd.Series, pd.Series, pd.Series]:
    fast = ema(series, 12)
    slow = ema(series, 26)
    line = fast - slow
    signal = line.ewm(span=9, adjust=False, min_periods=9).mean()
    return line, signal, line - signal


def atr(frame: pd.DataFrame, period: int = 14) -> pd.Series:
    prev_close = frame["close"].shift(1)
    tr = pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - prev_close).abs(),
            (frame["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def rolling_vwap(frame: pd.DataFrame, period: int = 20) -> pd.Series:
    typical = (frame["high"] + frame["low"] + frame["close"]) / 3
    pv = (typical * frame["volume"]).rolling(period).sum()
    vol = frame["volume"].rolling(period).sum()
    return pv / vol.replace(0.0, np.nan)


def trend_feature(index_frame: Optional[pd.DataFrame], window: int = 5) -> pd.Series:
    if index_frame is None or index_frame.empty:
        return pd.Series(dtype=float)
    return index_frame["close"].pct_change(window)


def build_features(
    candles: pd.DataFrame,
    market: Optional[Dict[str, pd.DataFrame]] = None,
    sector_strength: float = 0.0,
    news_sentiment: float = 0.0,
    earnings_sentiment: float = 0.0,
) -> pd.DataFrame:
    """Returns a frame indexed like `candles` with FEATURE_COLUMNS + close/time."""
    frame = candles.reset_index(drop=True).copy()
    close = frame["close"]

    out = pd.DataFrame(index=frame.index)
    out["time"] = frame["time"]
    out["close"] = close
    out["return_1d"] = close.pct_change(1)
    out["return_5d"] = close.pct_change(5)
    out["return_10d"] = close.pct_change(10)
    out["return_20d"] = close.pct_change(20)
    out["rsi"] = rsi(close) / 100.0

    macd_line, _signal, hist = macd(close)
    out["macd_norm"] = macd_line / close
    out["macd_hist_norm"] = hist / close

    out["atr_pct"] = atr(frame) / close
    for period, name in [(20, "ema20_dist"), (50, "ema50_dist"), (200, "ema200_dist")]:
        out[name] = close / ema(close, period) - 1.0
    out["vwap_dist"] = close / rolling_vwap(frame) - 1.0

    middle = close.rolling(20).mean()
    deviation = close.rolling(20).std(ddof=0)
    out["bb_width"] = (4 * deviation) / middle

    out["volume_ratio"] = frame["volume"] / frame["volume"].rolling(20).mean()
    vol_mean_20 = frame["volume"].rolling(20).mean()
    vol_std_20 = frame["volume"].rolling(20).std(ddof=0).replace(0.0, np.nan)
    vol_mean_60 = frame["volume"].rolling(60).mean()
    vol_std_60 = frame["volume"].rolling(60).std(ddof=0).replace(0.0, np.nan)
    out["volume_zscore_20"] = (frame["volume"] - vol_mean_20) / vol_std_20
    out["volume_zscore_60"] = (frame["volume"] - vol_mean_60) / vol_std_60
    out["volume_acceleration"] = out["volume_ratio"].diff()
    out["high_low_range"] = (frame["high"] - frame["low"]) / close
    span = (frame["high"] - frame["low"]).replace(0.0, np.nan)
    out["close_position"] = (close - frame["low"]) / span
    out["gap"] = frame["open"] / close.shift(1) - 1.0
    out["vol_7"] = out["return_1d"].rolling(7).std(ddof=0)
    out["vol_14"] = out["return_1d"].rolling(14).std(ddof=0)
    out["vol_30"] = out["return_1d"].rolling(30).std(ddof=0)
    out["drawdown_20"] = close / close.rolling(20).max() - 1.0
    out["return_acceleration"] = out["return_1d"].diff()

    # ---- market features (aligned by row position on matching daily series)
    market = market or {}

    def aligned(key: str, transform) -> pd.Series:
        index_frame = market.get(key)
        if index_frame is None or index_frame.empty:
            return pd.Series(0.0, index=out.index)
        series = transform(index_frame).reset_index(drop=True)
        # Align tails: both series end "today".
        n = min(len(series), len(out))
        values = pd.Series(0.0, index=out.index)
        values.iloc[-n:] = series.iloc[-n:].to_numpy()
        return values

    out["nifty_trend"] = aligned("nifty", lambda f: f["close"].pct_change(5))
    out["midcap_trend"] = aligned("midcap", lambda f: f["close"].pct_change(5))
    out["vix_level"] = aligned("vix", lambda f: f["close"] / 20.0)
    out["vix_change"] = aligned("vix", lambda f: f["close"].pct_change(5))
    nifty_1d = aligned("nifty", lambda f: f["close"].pct_change(1))
    nifty_5d = aligned("nifty", lambda f: f["close"].pct_change(5))
    nifty_20d = aligned("nifty", lambda f: f["close"].pct_change(20))
    out["rel_return_1d"] = out["return_1d"] - nifty_1d
    out["rel_return_5d"] = out["return_5d"] - nifty_5d
    out["rel_return_20d"] = out["return_20d"] - nifty_20d
    out["signed_return_volume_z"] = out["return_1d"] * out["volume_zscore_20"]

    # ---- sentiment / sector (pluggable providers; neutral stubs by default)
    out["sector_strength"] = sector_strength
    out["news_sentiment"] = news_sentiment
    out["earnings_sentiment"] = earnings_sentiment

    return out


def label_direction(close: pd.Series, horizon_bars: int, threshold: float) -> pd.Series:
    """0=DOWN, 1=SIDEWAYS, 2=UP based on the forward return over the horizon."""
    forward = close.shift(-horizon_bars) / close - 1.0
    label = pd.Series(1, index=close.index, dtype="int64")
    label[forward > threshold] = 2
    label[forward < -threshold] = 0
    label[forward.isna()] = -1  # not labelable (end of series)
    return label


def forward_returns(close: pd.Series, horizon_bars: int) -> pd.Series:
    return close.shift(-horizon_bars) / close - 1.0


def make_dataset(features: pd.DataFrame, horizon_bars: int, threshold: float):
    """Drop warmup/uncomputable rows; return (X, y, forward_returns)."""
    labels = label_direction(features["close"], horizon_bars, threshold)
    fwd = forward_returns(features["close"], horizon_bars)
    data = features[FEATURE_COLUMNS].copy()
    data = data.fillna(0.0)
    mask = data.notna().all(axis=1) & (labels >= 0)
    return (
        data[mask].to_numpy(dtype="float32"),
        labels[mask].to_numpy(dtype="int64"),
        fwd[mask].to_numpy(dtype="float32"),
    )


def label_investigate(features: pd.DataFrame) -> pd.Series:
    """Weak labels for unusual-activity training. Not court/SEBI findings.

    1 = joint residual outlier (worth investigating), 0 = typical day, -1 = unlabeled.
    """
    ret_z = _rolling_z(features["return_1d"], 60)
    vol_z = features["volume_zscore_60"]
    rel = features["rel_return_1d"]
    positive = (ret_z.abs() >= 2.25) & (vol_z.abs() >= 1.75) & (rel.abs() >= 0.015)
    negative = (ret_z.abs() < 0.8) & (vol_z.abs() < 0.8)
    label = pd.Series(-1, index=features.index, dtype="int64")
    label[negative] = 0
    label[positive] = 1
    return label


def _rolling_z(series: pd.Series, window: int) -> pd.Series:
    mean = series.rolling(window).mean()
    deviation = series.rolling(window).std(ddof=0).replace(0.0, np.nan)
    return (series - mean) / deviation


def make_manipulation_dataset(features: pd.DataFrame):
    """Labeled last-bar style rows for the investigate head."""
    labels = label_investigate(features)
    data = features[MANIPULATION_FEATURE_COLUMNS].copy().fillna(0.0)
    mask = data.notna().all(axis=1) & (labels >= 0)
    return (
        data[mask].to_numpy(dtype="float32"),
        labels[mask].to_numpy(dtype="int64"),
    )


def inject_pump_dump(candles: pd.DataFrame) -> pd.DataFrame:
    """Overlay a synthetic pump-then-dump tail on a real/synthetic series."""
    out = candles.reset_index(drop=True).copy()
    out["volume"] = out["volume"].astype("float64")
    if len(out) < 12:
        return out
    base = float(out["close"].iloc[-7])
    multipliers = (1.05, 1.12, 1.20, 1.28, 1.10, 0.88)
    vol_mult = (3.0, 5.0, 8.0, 10.0, 12.0, 15.0)
    prev = base
    for offset, (mult, vmult) in enumerate(zip(multipliers, vol_mult)):
        idx = len(out) - 6 + offset
        close = base * mult
        out.loc[idx, "open"] = prev
        out.loc[idx, "close"] = close
        out.loc[idx, "high"] = max(prev, close) * 1.02
        out.loc[idx, "low"] = min(prev, close) * 0.98
        out.loc[idx, "volume"] = max(float(out.loc[idx, "volume"]), 1.0) * vmult
        prev = close
    return out
