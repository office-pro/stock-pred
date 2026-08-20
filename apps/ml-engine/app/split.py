"""Chronological train/holdout masks. Never shuffle time series."""
from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

DAY_MS = 86_400_000
DEFAULT_HOLDOUT_DAYS = 365
MIN_HOLDOUT_ROWS = 80
MIN_TRAIN_ROWS = 200


def cutoff_ms(times: np.ndarray, holdout_days: int) -> int:
    if holdout_days <= 0 or times.size == 0:
        return 0
    return int(np.max(times) - holdout_days * DAY_MS)


def train_holdout_masks(times: np.ndarray, holdout_days: int) -> Tuple[np.ndarray, np.ndarray]:
    """Train = strictly before cutoff; holdout = cutoff onward."""
    n = int(times.size)
    if holdout_days <= 0 or n == 0:
        return np.ones(n, dtype=bool), np.zeros(n, dtype=bool)
    cut = cutoff_ms(times, holdout_days)
    train = times < cut
    holdout = times >= cut
    if int(train.sum()) < MIN_TRAIN_ROWS or int(holdout.sum()) < MIN_HOLDOUT_ROWS:
        return np.ones(n, dtype=bool), np.zeros(n, dtype=bool)
    return train, holdout


def expanding_year_folds(
    times: np.ndarray, min_train_days: int = 504
) -> List[Dict[str, object]]:
    """Expanding annual folds: train all bars before 1 Jan of the test year."""
    if times.size == 0:
        return []
    stamps = pd.to_datetime(times.astype("int64"), unit="ms", utc=True)
    years = sorted({int(year) for year in stamps.year})
    folds: List[Dict[str, object]] = []
    min_train_ms = min_train_days * DAY_MS
    for year in years:
        test_start = int(pd.Timestamp(year=year, month=1, day=1, tz="UTC").timestamp() * 1000)
        test_end = int(pd.Timestamp(year=year + 1, month=1, day=1, tz="UTC").timestamp() * 1000)
        train = times < test_start
        test = (times >= test_start) & (times < test_end)
        if int(train.sum()) < MIN_TRAIN_ROWS or int(test.sum()) < MIN_HOLDOUT_ROWS:
            continue
        span = int(np.max(times[train]) - np.min(times[train])) if int(train.sum()) else 0
        if span < min_train_ms:
            continue
        folds.append(
            {
                "year": year,
                "train": train,
                "test": test,
                "trainRows": int(train.sum()),
                "testRows": int(test.sum()),
            }
        )
    return folds
