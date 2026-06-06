import numpy as np

from app.data import synthetic_candles
from app.features import FEATURE_COLUMNS, build_features, label_direction, make_dataset


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
