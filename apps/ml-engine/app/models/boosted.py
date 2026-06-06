"""Gradient-boosted models: XGBoost (primary) and LightGBM (secondary).
Heavy imports stay inside methods so light tooling can import this module.
"""
import numpy as np


class XgbModel:
    name = "xgboost"

    def __init__(self):
        self.model = None

    def train(self, x: np.ndarray, y: np.ndarray) -> None:
        from xgboost import XGBClassifier

        self.model = XGBClassifier(
            n_estimators=250,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="multi:softprob",
            num_class=3,
            eval_metric="mlogloss",
            tree_method="hist",
            random_state=42,
        )
        self.model.fit(x, y)

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("xgboost model not loaded")
        return self.model.predict_proba(x)

    def save(self, path: str) -> None:
        self.model.save_model(path)

    def load(self, path: str) -> "XgbModel":
        from xgboost import XGBClassifier

        self.model = XGBClassifier()
        self.model.load_model(path)
        return self


class LgbmModel:
    name = "lightgbm"

    def __init__(self):
        self.model = None

    def train(self, x: np.ndarray, y: np.ndarray) -> None:
        from lightgbm import LGBMClassifier

        self.model = LGBMClassifier(
            n_estimators=300,
            num_leaves=31,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="multiclass",
            num_class=3,
            random_state=42,
            verbosity=-1,
        )
        self.model.fit(x, y)

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("lightgbm model not loaded")
        return self.model.predict_proba(x)

    def save(self, path: str) -> None:
        self.model.booster_.save_model(path)

    def load(self, path: str) -> "LgbmModel":
        import lightgbm as lgb

        booster = lgb.Booster(model_file=path)

        class _BoosterAdapter:
            def __init__(self, inner):
                self._inner = inner

            def predict_proba(self, x: np.ndarray) -> np.ndarray:
                return self._inner.predict(x)

        self.model = _BoosterAdapter(booster)
        return self
