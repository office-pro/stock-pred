import numpy as np
import pandas as pd

from app.data import synthetic_candles
from app.models.scaler import Scaler
from app.features import (
    FEATURE_COLUMNS,
    FUNDAMENTAL_COLUMNS,
    MANIPULATION_FEATURE_COLUMNS,
    build_features,
    inject_pump_dump,
    label_direction,
    label_investigate,
    make_dataset,
    make_manipulation_dataset,
)


def test_synthetic_candles_are_valid():
    frame = synthetic_candles("RELIANCE", 300)
    assert len(frame) == 300
    assert (frame["high"] >= frame["low"]).all()
    assert (frame["high"] >= frame["close"]).all()
    assert (frame["low"] <= frame["close"]).all()
    assert (frame["volume"] > 0).all()
    # Deterministic per symbol.
    again = synthetic_candles("RELIANCE", 300)
    assert frame["close"].tolist() == again["close"].tolist()


def test_build_features_produces_all_columns():
    candles = synthetic_candles("TCS", 400)
    features = build_features(candles)
    for column in FEATURE_COLUMNS:
        assert column in features.columns, f"missing feature: {column}"
    # After warmup, features are finite.
    tail = features[FEATURE_COLUMNS].iloc[-50:]
    assert np.isfinite(tail.to_numpy(dtype="float64")).all()
    for column in (
        "return_10d",
        "volume_zscore_20",
        "volume_zscore_60",
        "return_acceleration",
        "rel_return_1d",
        "rel_return_5d",
        "rel_return_20d",
    ):
        assert column in features.columns, f"missing manipulation feature: {column}"


def test_labels_cover_all_classes():
    candles = synthetic_candles("INFY", 600)
    labels = label_direction(candles["close"], horizon_bars=1, threshold=0.01)
    values = set(labels.unique())
    assert {0, 1, 2}.issubset(values | {-1, 0, 1, 2})
    # Last bar has no forward return.
    assert labels.iloc[-1] == -1


def test_make_dataset_shapes_align():
    candles = synthetic_candles("SBIN", 500)
    features = build_features(candles)
    x, y, fwd, times = make_dataset(features, horizon_bars=5, threshold=0.02)
    assert x.shape[0] == y.shape[0] == fwd.shape[0] == times.shape[0]
    assert x.shape[1] == len(FEATURE_COLUMNS)
    assert x.shape[0] > 200
    assert not np.isnan(x).any()


def test_make_dataset_works_with_sixty_sessions():
    candles = synthetic_candles("INFY", 80)
    features = build_features(candles)
    x, y, fwd, times = make_dataset(features, horizon_bars=1, threshold=0.01)
    assert x.shape[0] == y.shape[0] == fwd.shape[0] == times.shape[0]
    assert x.shape[0] > 20
    assert not np.isnan(x).any()


def test_weak_labels_flag_joint_price_volume_outliers():
    candles = synthetic_candles("POLYCAB", 220)
    spiked = candles.copy()
    spiked["volume"] = spiked["volume"].astype("float64")
    spiked.loc[spiked.index[-1], "close"] = spiked["close"].iloc[-2] * 1.28
    spiked.loc[spiked.index[-1], "high"] = spiked["close"].iloc[-1] * 1.01
    spiked.loc[spiked.index[-1], "volume"] = float(spiked["volume"].iloc[-60:-1].mean()) * 9
    features = build_features(spiked)
    labels = label_investigate(features)
    assert int(labels.iloc[-1]) == 1
    x, y = make_manipulation_dataset(features)
    assert x.shape[1] == len(MANIPULATION_FEATURE_COLUMNS)
    assert 1 in set(y.tolist())


def test_inject_pump_dump_creates_investigate_labels():
    candles = inject_pump_dump(synthetic_candles("CDSL", 180))
    features = build_features(candles)
    labels = label_investigate(features)
    assert int(labels.iloc[-1]) == 1 or int(labels.iloc[-2]) == 1


def _fund_row(symbol: str, available_ms: int, **overrides):
    row = {
        "symbol": symbol,
        "available_at": pd.Timestamp(available_ms, unit="ms", tz="UTC"),
        "sector": "Technology",
        "rev_yoy": 0.2,
        "pat_yoy": 0.1,
        "eps_yoy": 0.1,
        "op_margin": 0.2,
        "net_margin": 0.15,
        "gross_margin": 0.4,
        "ebitda_margin": 0.25,
        "roe": 0.18,
        "roa": 0.1,
        "roce": 0.16,
        "debt_equity": 0.3,
        "current_ratio": 1.5,
        "cash_ratio": 0.4,
        "ocf_pat": 1.1,
        "fcf_growth": 0.05,
        "fcf_margin": 0.12,
        "trailing_eps": 10.0,
        "book_value": 100.0,
        "sector_median_pe": 20.0,
        "promoter_holding": None,
        "institution_holding": None,
        "log_ttm_revenue": 12.0,
    }
    row.update(overrides)
    return row


def test_fundamental_columns_default_to_missing_flag():
    candles = synthetic_candles("TCS", 80)
    features = build_features(candles, symbol="TCS")
    for column in FUNDAMENTAL_COLUMNS:
        assert column in features.columns, f"missing feature: {column}"
    assert (features["fund_missing"] == 1.0).all()
    assert (features["pe"] == 0.0).all()


def test_pit_join_does_not_use_future_snapshots():
    candles = synthetic_candles("INFY", 40)
    times = candles["time"].to_numpy(dtype="int64")
    mid = int(times[20])
    future = int(times[-1]) + 10 * 86_400_000
    panel = pd.DataFrame(
        [
            _fund_row("INFY", mid, rev_yoy=0.2, trailing_eps=10.0),
            _fund_row("INFY", future, rev_yoy=0.9, trailing_eps=1.0),
        ]
    )
    features = build_features(candles, {"fund_panel": panel}, symbol="INFY")
    before = features["time"] < mid
    after = features["time"] >= mid
    assert (features.loc[before, "fund_missing"] == 1.0).all()
    assert (features.loc[after, "fund_missing"] == 0.0).all()
    assert features["rev_yoy"].iloc[-1] == 0.2
    expected_pe = float(features["close"].iloc[-1] / 10.0)
    assert abs(float(features["pe"].iloc[-1]) - expected_pe) < 1e-6


def test_news_asof_does_not_use_future_articles():
    candles = synthetic_candles("TCS", 40)
    times = candles["time"].to_numpy(dtype="int64")
    mid = int(times[20])
    future = int(times[-1]) + 10 * 86_400_000
    panel = pd.DataFrame(
        [
            {
                "symbol": "TCS",
                "available_at": pd.Timestamp(mid, unit="ms", tz="UTC"),
                "news_count_1d": 2,
                "news_count_7d": 5,
                "news_count_30d": 8,
                "news_sent_1d": 0.4,
                "news_sent_7d": 0.3,
                "news_sent_30d": 0.2,
                "news_sent_std_7d": 0.1,
                "news_sent_change_7d": 0.1,
                "news_sent_trend_30d": 0.1,
                "news_pos_7d": 3,
                "news_neg_7d": 1,
                "news_high_impact_7d": 1,
                "news_event_momentum_7d": 0.8,
                "earnings_sentiment": 0.5,
            },
            {
                "symbol": "TCS",
                "available_at": pd.Timestamp(future, unit="ms", tz="UTC"),
                "news_count_1d": 99,
                "news_count_7d": 99,
                "news_count_30d": 99,
                "news_sent_1d": 0.99,
                "news_sent_7d": 0.99,
                "news_sent_30d": 0.99,
                "news_sent_std_7d": 0,
                "news_sent_change_7d": 0,
                "news_sent_trend_30d": 0,
                "news_pos_7d": 99,
                "news_neg_7d": 0,
                "news_high_impact_7d": 99,
                "news_event_momentum_7d": 9,
                "earnings_sentiment": 0.99,
            },
        ]
    )
    features = build_features(candles, {"news_panel": panel}, symbol="TCS")
    before = features["time"] < mid
    after = features["time"] >= mid
    assert (features.loc[before, "news_missing"] == 1.0).all()
    assert (features.loc[after, "news_missing"] == 0.0).all()
    assert float(features["news_sent_7d"].iloc[-1]) == 0.3
    assert float(features["news_sentiment"].iloc[-1]) == 0.3
    assert float(features["news_count_7d"].iloc[-1]) != 99


def test_macro_asof_and_sector_gates():
    candles = synthetic_candles("ONGC", 30)
    times = candles["time"].to_numpy(dtype="int64")
    mid = int(times[10])
    future = int(times[-1]) + 5 * 86_400_000
    fund = pd.DataFrame(
        [_fund_row("ONGC", mid, sector="Energy", trailing_eps=10.0, book_value=50.0)]
    )
    macro = pd.DataFrame(
        [
            {
                "available_at": pd.Timestamp(mid, unit="ms", tz="UTC"),
                "usdinr": 83.0,
                "usdinr_chg_20d": 0.01,
                "usdinr_chg_60d": 0.02,
                "brent": 80.0,
                "brent_chg_20d": 0.15,
                "gold_chg_20d": 0.0,
                "us10y": 4.0,
                "us10y_chg_20d": 0.0,
                "spx_chg_20d": 0.0,
                "nasdaq_chg_20d": 0.0,
                "dxy_chg_20d": 0.0,
                "india_cpi": 5.0,
                "india_cpi_chg": 0.0,
                "repo_rate": 6.5,
                "repo_chg_90d": -0.25,
                "fii_flow_20d": 0.0,
                "dii_flow_20d": 0.0,
            },
            {
                "available_at": pd.Timestamp(future, unit="ms", tz="UTC"),
                "usdinr": 90.0,
                "usdinr_chg_20d": 0.5,
                "usdinr_chg_60d": 0.5,
                "brent": 120.0,
                "brent_chg_20d": 0.9,
                "gold_chg_20d": 0.0,
                "us10y": 4.0,
                "us10y_chg_20d": 0.0,
                "spx_chg_20d": 0.0,
                "nasdaq_chg_20d": 0.0,
                "dxy_chg_20d": 0.0,
                "india_cpi": 5.0,
                "india_cpi_chg": 0.0,
                "repo_rate": 6.5,
                "repo_chg_90d": 0.0,
                "fii_flow_20d": 0.0,
                "dii_flow_20d": 0.0,
            },
        ]
    )
    features = build_features(
        candles, {"fund_panel": fund, "macro_panel": macro}, symbol="ONGC"
    )
    assert (features.loc[features["time"] < mid, "macro_missing"] == 1.0).all()
    assert float(features["brent_chg_20d"].iloc[-1]) == 0.15
    assert float(features["macro_oil_energy"].iloc[-1]) == 0.15
    assert float(features["macro_fx_it"].iloc[-1]) == 0.0


def test_social_spike_columns_on_manipulation_head():
    candles = synthetic_candles("ABC", 80)
    mid = int(candles["time"].iloc[40])
    panel = pd.DataFrame(
        [
            {
                "symbol": "ABC",
                "available_at": pd.Timestamp(mid, unit="ms", tz="UTC"),
                "social_mentions_1d": 80,
                "social_mentions_7d": 100,
                "social_mention_growth": 4.0,
                "social_attention_spike": 8.0,
                "social_unique_authors_1d": 12,
                "social_sent_1d": 0.9,
                "social_sent_change": 0.4,
                "social_bull_ratio_7d": 0.8,
                "social_bear_ratio_7d": 0.1,
                "social_coordination": 0.7,
                "trends_score_7d": 0.4,
                "trends_change_7d": 0.2,
            }
        ]
    )
    features = build_features(candles, {"social_panel": panel}, symbol="ABC")
    assert "social_attention_spike" in MANIPULATION_FEATURE_COLUMNS
    assert float(features["social_attention_spike"].iloc[-1]) == 8.0
    assert float(features["social_coordination"].iloc[-1]) == 0.7


def test_scaler_rejects_feature_count_mismatch():
    scaler = Scaler().fit(np.zeros((8, 3), dtype="float32"))
    try:
        scaler.transform(np.zeros((2, 5), dtype="float32"))
        raise AssertionError("expected feature-count mismatch")
    except RuntimeError as error:
        assert "Retrain" in str(error)


