"""Minimal standard scaler with JSON persistence (no pickle for portability)."""
import json
import os
from typing import Optional

import numpy as np


class Scaler:
    def __init__(self, mean: Optional[np.ndarray] = None, std: Optional[np.ndarray] = None):
        self.mean = mean
        self.std = std

    def fit(self, x: np.ndarray) -> "Scaler":
        self.mean = x.mean(axis=0)
        std = x.std(axis=0)
        std[std == 0] = 1.0
        self.std = std
        return self

    def transform(self, x: np.ndarray) -> np.ndarray:
        if self.mean is None or self.std is None:
            raise RuntimeError("Scaler is not fitted")
        return ((x - self.mean) / self.std).astype("float32")

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"mean": self.mean.tolist(), "std": self.std.tolist()}, handle)

    @classmethod
    def load(cls, path: str) -> "Scaler":
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return cls(np.array(payload["mean"], dtype="float64"), np.array(payload["std"], dtype="float64"))
