import pandas as pd
import numpy as np

from app.split import DAY_MS, expanding_year_folds, train_holdout_masks


def test_holdout_is_the_latest_window_only():
    start = 1_700_000_000_000
    times = np.array([start + i * DAY_MS for i in range(800)], dtype=np.int64)
    train, holdout = train_holdout_masks(times, 365)
    assert int(train.sum()) + int(holdout.sum()) == 800
    assert times[train].max() < times[holdout].min()
    assert int(holdout.sum()) >= 360
    assert int(train.sum()) >= 400


def test_holdout_disabled_keeps_all_in_train():
    times = np.array([1_700_000_000_000 + i * DAY_MS for i in range(100)], dtype=np.int64)
    train, holdout = train_holdout_masks(times, 0)
    assert train.all()
    assert not holdout.any()


def test_year_folds_are_expanding_and_sorted():
    start = int(pd.Timestamp("2020-01-15", tz="UTC").timestamp() * 1000)
    times = np.array([start + i * DAY_MS for i in range(1500)], dtype=np.int64)
    folds = expanding_year_folds(times, min_train_days=400)
    assert len(folds) >= 2
    years = [fold["year"] for fold in folds]
    assert years == sorted(years)
    for fold in folds:
        assert fold["trainRows"] > 0
        assert fold["testRows"] > 0
        assert times[fold["train"]].max() < times[fold["test"]].min()
