"""Secondary regression heads for forwardReturn / MFE / MAE (M3)."""
from __future__ import annotations

import json
import os
from typing import Dict, Optional

import numpy as np


class ReturnRegressor:
    """Thin XGBRegressor wrapper for a single continuous target."""

    def __init__(self, target_name: str):
        self.target_name = target_name
        self.model = None

    def train(self, x: np.ndarray, y: np.ndarray) -> None:
        from xgboost import XGBRegressor

        self.model = XGBRegressor(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="reg:squarederror",
            tree_method="hist",
            random_state=42,
        )
        self.model.fit(x, y)

    def predict(self, x: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise RuntimeError(f"{self.target_name} regressor not loaded")
        return np.asarray(self.model.predict(x), dtype=float)

    def save(self, path: str) -> None:
        if self.model is None:
            raise RuntimeError("nothing to save")
        self.model.save_model(path)

    def load(self, path: str) -> "ReturnRegressor":
        from xgboost import XGBRegressor

        self.model = XGBRegressor()
        self.model.load_model(path)
        return self


def train_path_regressors(
    x: np.ndarray, path_targets: Dict[str, np.ndarray]
) -> Dict[str, ReturnRegressor]:
    models: Dict[str, ReturnRegressor] = {}
    for name, target in path_targets.items():
        y = np.asarray(target, dtype=float)
        mask = np.isfinite(y)
        if mask.sum() < 50:
            continue
        reg = ReturnRegressor(name)
        reg.train(x[mask], y[mask])
        models[name] = reg
    return models


def save_path_regressors(models: Dict[str, ReturnRegressor], out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for name, model in models.items():
        filename = f"regressor_{name}.json"
        model.save(os.path.join(out_dir, filename))
        index.append({"target": name, "file": filename})
    with open(os.path.join(out_dir, "regressors.json"), "w", encoding="utf-8") as handle:
        json.dump({"targets": index}, handle, indent=2)


def load_path_regressors(out_dir: str) -> Dict[str, ReturnRegressor]:
    meta_path = os.path.join(out_dir, "regressors.json")
    if not os.path.exists(meta_path):
        return {}
    with open(meta_path, "r", encoding="utf-8") as handle:
        meta = json.load(handle)
    models: Dict[str, ReturnRegressor] = {}
    for row in meta.get("targets") or []:
        name = str(row.get("target"))
        filename = str(row.get("file"))
        path = os.path.join(out_dir, filename)
        if not os.path.exists(path):
            continue
        models[name] = ReturnRegressor(name).load(path)
    return models


def predict_path_targets(
    models: Dict[str, ReturnRegressor], x_row: np.ndarray
) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {
        "expectedReturn": None,
        "expectedMfe": None,
        "expectedMae": None,
    }
    mapping = {
        "forwardReturn": "expectedReturn",
        "maxFavorableExcursion": "expectedMfe",
        "maxAdverseExcursion": "expectedMae",
    }
    for target, field in mapping.items():
        model = models.get(target)
        if model is None:
            continue
        value = float(model.predict(x_row.reshape(1, -1))[0])
        out[field] = round(value, 6)
    return out
