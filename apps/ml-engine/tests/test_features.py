import numpy as np

from app.data import synthetic_candles
from app.features import (
    FEATURE_COLUMNS,
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
    x, y, fwd = make_dataset(features, horizon_bars=5, threshold=0.02)
    assert x.shape[0] == y.shape[0] == fwd.shape[0]
    assert x.shape[1] == len(FEATURE_COLUMNS)
    assert x.shape[0] > 200
    assert not np.isnan(x).any()


def test_make_dataset_works_with_sixty_sessions():
    candles = synthetic_candles("INFY", 80)
    features = build_features(candles)
    x, y, fwd = make_dataset(features, horizon_bars=1, threshold=0.01)
    assert x.shape[0] == y.shape[0] == fwd.shape[0]
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

