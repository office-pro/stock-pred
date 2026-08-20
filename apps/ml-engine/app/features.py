"""Feature engineering (spec):
OHLCV + indicators (RSI, MACD, VWAP, ATR, EMA20/50/200)
+ market features (Nifty trend, Midcap trend, India VIX, sector strength)
+ point-in-time news / social / macro panels (availableAt <= bar)
+ point-in-time fundamental ratios (Yahoo statements; availableAt <= bar).
"""
from typing import Callable, Dict, Optional, Sequence, Tuple

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
    "news_missing",
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
    "news_sentiment",
    "earnings_sentiment",
    "fund_missing",
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
    "pe",
    "pb",
    "pe_vs_sector",
    "log_ttm_revenue",
    "social_missing",
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
    "macro_missing",
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
    "macro_fx_it",
    "macro_rate_bank",
    "macro_oil_energy",
    "macro_rate_auto",
]

FUNDAMENTAL_COLUMNS = [
    "fund_missing",
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
    "pe",
    "pb",
    "pe_vs_sector",
    "log_ttm_revenue",
]

NEWS_VALUE_COLUMNS = [
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
]

SOCIAL_VALUE_COLUMNS = [
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

MACRO_VALUE_COLUMNS = [
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

_IT_SECTORS = {
    "technology",
    "communication services",
    "information technology",
    "communication",
}
_BANK_SECTORS = {"financial services", "financials", "banking"}
_ENERGY_SECTORS = {"energy", "oil & gas", "oil and gas"}
_AUTO_SECTORS = {"consumer cyclical", "consumer discretionary", "automobiles", "auto"}

_FUND_ASOF_COLUMNS = [
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
    "log_ttm_revenue",
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
    "social_attention_spike",
    "social_coordination",
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


def _clip_series(series: pd.Series, lo: float, hi: float) -> pd.Series:
    return series.astype("float64").clip(lo, hi)


def _sector_name(value: object) -> str:
    return str(value or "").strip().lower()


def _clip_alt_column(column: str, values: pd.Series) -> pd.Series:
    if column.endswith("_missing"):
        return values.clip(0.0, 1.0)
    if "sent" in column or column.endswith("_sentiment") or "ratio" in column:
        return _clip_series(values, -1.0, 1.0)
    if "coordination" in column:
        return _clip_series(values, 0.0, 1.0)
    if "count" in column or "mentions" in column or "authors" in column or "high_impact" in column:
        return _clip_series(values, 0.0, 10_000.0)
    if "spike" in column or "growth" in column:
        return _clip_series(values, -50.0, 50.0)
    if column in {"usdinr", "brent", "us10y", "india_cpi", "repo_rate"}:
        return _clip_series(values, -1.0, 1_000.0)
    return _clip_series(values, -20.0, 20.0)


def join_asof_panel(
    out: pd.DataFrame,
    panel: Optional[pd.DataFrame],
    columns: Sequence[str],
    missing_flag: str,
    symbol: Optional[str] = None,
    by_symbol: bool = True,
    clip_column: Optional[Callable[[str, pd.Series], pd.Series]] = None,
) -> pd.DataFrame:
    """Latest snapshot with available_at <= bar time. Missing -> 0 + flag=1.

    Returns the aligned merge (may be empty). Does not copy today's values onto history.
    """
    clipper = clip_column or _clip_alt_column
    for column in columns:
        out[column] = 0.0
    out[missing_flag] = 1.0
    empty = pd.DataFrame()
    if panel is None or panel.empty or "time" not in out.columns:
        return empty
    if by_symbol:
        if not symbol or "symbol" not in panel.columns:
            return empty
        snaps = panel.loc[panel["symbol"].astype(str).str.upper() == str(symbol).upper()].copy()
    else:
        snaps = panel.copy()
    if snaps.empty or "available_at" not in snaps.columns:
        return empty
    snaps = snaps.dropna(subset=["available_at"]).copy()
    snaps["available_at"] = pd.to_datetime(snaps["available_at"], utc=True, errors="coerce")
    snaps = snaps.dropna(subset=["available_at"]).sort_values("available_at")
    if snaps.empty:
        return empty
    left = pd.DataFrame(
        {
            "orig": out.index,
            "time": pd.to_datetime(out["time"], unit="ms", utc=True, errors="coerce"),
        }
    ).sort_values("time")
    merged = pd.merge_asof(
        left,
        snaps,
        left_on="time",
        right_on="available_at",
        direction="backward",
        allow_exact_matches=True,
    )
    merged = merged.set_index("orig").reindex(out.index)
    has = merged["available_at"].notna()
    if not bool(has.any()):
        return merged
    out[missing_flag] = (~has).astype("float64")
    for column in columns:
        if column not in merged.columns:
            continue
        values = pd.to_numeric(merged[column], errors="coerce")
        values = values.where(has, np.nan)
        out[column] = clipper(column, values).fillna(0.0).to_numpy()
    return merged


def join_news(out: pd.DataFrame, symbol: Optional[str], panel: Optional[pd.DataFrame]) -> None:
    join_asof_panel(out, panel, NEWS_VALUE_COLUMNS, "news_missing", symbol, True)
    out["news_sentiment"] = out.get("news_sent_7d", 0.0)


def join_social(out: pd.DataFrame, symbol: Optional[str], panel: Optional[pd.DataFrame]) -> None:
    join_asof_panel(out, panel, SOCIAL_VALUE_COLUMNS, "social_missing", symbol, True)


def join_macro(out: pd.DataFrame, panel: Optional[pd.DataFrame], sectors: Optional[pd.Series]) -> None:
    join_asof_panel(out, panel, MACRO_VALUE_COLUMNS, "macro_missing", None, False)
    names = (
        sectors.reindex(out.index).map(_sector_name)
        if sectors is not None
        else pd.Series("", index=out.index)
    )
    it_mask = names.isin(_IT_SECTORS)
    bank_mask = names.isin(_BANK_SECTORS)
    energy_mask = names.isin(_ENERGY_SECTORS)
    auto_mask = names.isin(_AUTO_SECTORS)
    out["macro_fx_it"] = np.where(it_mask, out["usdinr_chg_20d"], 0.0)
    out["macro_rate_bank"] = np.where(bank_mask, out["repo_chg_90d"], 0.0)
    out["macro_oil_energy"] = np.where(energy_mask, out["brent_chg_20d"], 0.0)
    out["macro_rate_auto"] = np.where(auto_mask, out["repo_chg_90d"], 0.0)


def _clip_fund_column(column: str, values: pd.Series) -> pd.Series:
    if column.endswith("_yoy") or column.endswith("_growth"):
        return _clip_series(values, -2.0, 5.0)
    if column.endswith("_margin") or column in {"roe", "roa", "roce"}:
        return _clip_series(values, -1.0, 2.0)
    if column in {"debt_equity", "current_ratio", "cash_ratio", "ocf_pat"}:
        return _clip_series(values, -5.0, 50.0)
    return values


def join_fundamentals(
    out: pd.DataFrame,
    close: pd.Series,
    symbol: Optional[str],
    panel: Optional[pd.DataFrame],
) -> None:
    """Latest snapshot with availableAt <= bar time. Missing -> 0 + fund_missing=1."""
    out["pe"] = 0.0
    out["pb"] = 0.0
    out["pe_vs_sector"] = 0.0
    merged = join_asof_panel(
        out, panel, _FUND_ASOF_COLUMNS, "fund_missing", symbol, True, _clip_fund_column
    )
    if merged.empty or "available_at" not in merged.columns:
        return
    has = merged["available_at"].notna()
    if not bool(has.any()):
        return
    eps = pd.to_numeric(merged.get("trailing_eps"), errors="coerce")
    book = pd.to_numeric(merged.get("book_value"), errors="coerce")
    prices = close.reindex(out.index).astype("float64")
    pe = np.where(has & (eps > 0), prices / eps, np.nan)
    pb = np.where(has & (book > 0), prices / book, np.nan)
    out["pe"] = np.clip(np.nan_to_num(pe, nan=0.0), 0.0, 200.0)
    out["pb"] = np.clip(np.nan_to_num(pb, nan=0.0), 0.0, 50.0)
    sector_pe = pd.to_numeric(merged.get("sector_median_pe"), errors="coerce")
    pe_vs = np.where((out["pe"] > 0) & (sector_pe > 0), out["pe"] / sector_pe - 1.0, 0.0)
    out["pe_vs_sector"] = np.clip(np.nan_to_num(pe_vs, nan=0.0), -5.0, 5.0)
    if "sector" in merged.columns:
        out["_sector"] = merged["sector"]


def build_features(
    candles: pd.DataFrame,
    market: Optional[Dict[str, pd.DataFrame]] = None,
    sector_strength: float = 0.0,
    symbol: Optional[str] = None,
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

    out["sector_strength"] = sector_strength

    ticker = symbol or (str(frame["symbol"].iloc[-1]) if "symbol" in frame.columns else None)
    panel = market.get("fund_panel") if isinstance(market, dict) else None
    news_panel = market.get("news_panel") if isinstance(market, dict) else None
    social_panel = market.get("social_panel") if isinstance(market, dict) else None
    macro_panel = market.get("macro_panel") if isinstance(market, dict) else None
    extra_names = [
        *FUNDAMENTAL_COLUMNS,
        *NEWS_VALUE_COLUMNS,
        "news_missing",
        "news_sentiment",
        *SOCIAL_VALUE_COLUMNS,
        "social_missing",
        *MACRO_VALUE_COLUMNS,
        "macro_missing",
        "macro_fx_it",
        "macro_rate_bank",
        "macro_oil_energy",
        "macro_rate_auto",
        "_sector",
    ]
    missing_names = [name for name in extra_names if name not in out.columns]
    if missing_names:
        out = pd.concat(
            [out, pd.DataFrame(0.0, index=out.index, columns=missing_names)],
            axis=1,
        )
    join_fundamentals(out, close, ticker, panel if isinstance(panel, pd.DataFrame) else None)
    join_news(out, ticker, news_panel if isinstance(news_panel, pd.DataFrame) else None)
    join_social(out, ticker, social_panel if isinstance(social_panel, pd.DataFrame) else None)
    sectors = out["_sector"] if "_sector" in out.columns else None
    join_macro(out, macro_panel if isinstance(macro_panel, pd.DataFrame) else None, sectors)
    if "_sector" in out.columns:
        out.drop(columns=["_sector"], inplace=True)

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
    """Drop warmup/uncomputable rows; return (X, y, forward_returns, times_ms)."""
    labels = label_direction(features["close"], horizon_bars, threshold)
    fwd = forward_returns(features["close"], horizon_bars)
    data = features[FEATURE_COLUMNS].copy()
    data = data.fillna(0.0)
    mask = data.notna().all(axis=1) & (labels >= 0)
    times = (
        features.loc[mask, "time"].to_numpy(dtype="int64")
        if "time" in features.columns
        else np.zeros(int(mask.sum()), dtype="int64")
    )
    return (
        data[mask].to_numpy(dtype="float32"),
        labels[mask].to_numpy(dtype="int64"),
        fwd[mask].to_numpy(dtype="float32"),
        times,
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
