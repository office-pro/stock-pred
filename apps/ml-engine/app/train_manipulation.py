"""Train a separate investigate-probability model (not UP/DOWN/SIDEWAYS).

Weak labels: joint residual outliers vs each stock's history + optional synthetic
pump-then-dump tails. These are not SEBI/court findings.

Usage:
    python -m app.train_manipulation [--days 1500] [--universe nifty50] [--synthetic]
"""
import argparse
import json
import os
from typing import List, Tuple

import numpy as np

from .config import settings
from .data import load_candles, load_market_context, load_universe, synthetic_candles
from .universes import add_universe_arg, normalize_universe
from .features import (
    MANIPULATION_FEATURE_COLUMNS,
    build_features,
    inject_pump_dump,
    make_manipulation_dataset,
)
from .models.boosted import LgbmBinaryModel, XgbBinaryModel
from .models.scaler import Scaler

MANIPULATION_DIR = "manipulation"


def _balance(x: np.ndarray, y: np.ndarray, rng: np.random.Generator) -> Tuple[np.ndarray, np.ndarray]:
    pos = np.where(y == 1)[0]
    neg = np.where(y == 0)[0]
    if len(pos) == 0 or len(neg) == 0:
        return x, y
    target_neg = min(len(neg), max(len(pos) * 4, 200))
    chosen_neg = rng.choice(neg, size=target_neg, replace=False)
    idx = np.concatenate([pos, chosen_neg])
    rng.shuffle(idx)
    return x[idx], y[idx]


def collect_dataset(symbols: List[str], days: int, synthetic: bool):
    market = load_market_context(days) if not synthetic else None
    xs, ys = [], []
    skipped = []
    rng = np.random.default_rng(42)
    for i, symbol in enumerate(symbols):
        try:
            candles = (
                synthetic_candles(symbol, days) if synthetic else load_candles(symbol, days)
            )
        except RuntimeError as error:
            print(f"[train-manipulation] skipping {symbol}: {error}")
            skipped.append(symbol)
            continue
        if i % 17 == 0:
            candles = inject_pump_dump(candles)
        features = build_features(candles, market)
        x, y = make_manipulation_dataset(features)
        if len(x) > 0:
            xs.append(x)
            ys.append(y)
        if (i + 1) % 25 == 0 or i + 1 == len(symbols):
            print(
                f"[train-manipulation] features {i + 1}/{len(symbols)} "
                f"(kept {len(xs)}, skipped {len(skipped)})",
                flush=True,
            )
    if skipped:
        print(f"[train-manipulation] WARNING: {len(skipped)} symbols skipped")
    if not xs:
        raise RuntimeError(
            "No unusual-activity training rows — is market-data running? "
            "(use --synthetic for offline experiments)"
        )
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    x, y = _balance(x, y, rng)
    return x, y


def train(symbols: List[str], days: int, synthetic: bool) -> None:
    print(f"[train-manipulation] symbols={len(symbols)} days={days} synthetic={synthetic}")
    x, y = collect_dataset(symbols, days, synthetic)
    n_pos = int((y == 1).sum())
    n_neg = int((y == 0).sum())
    print(f"[train-manipulation] samples={len(y)} investigate={n_pos} typical={n_neg}")
    if n_pos < 20:
        print(
            "[train-manipulation] too few positive weak labels; "
            "statistical blend on the live API remains the product"
        )

    scaler = Scaler().fit(x)
    x_scaled = scaler.transform(x)
    out_dir = os.path.join(settings.models_dir, MANIPULATION_DIR)
    os.makedirs(out_dir, exist_ok=True)

    xgb = XgbBinaryModel()
    xgb.train(x_scaled, y)
    xgb.save(os.path.join(out_dir, "xgboost.json"))
    print("[train-manipulation] xgboost saved")

    lgbm = LgbmBinaryModel()
    lgbm.train(x_scaled, y)
    lgbm.save(os.path.join(out_dir, "lightgbm.txt"))
    print("[train-manipulation] lightgbm saved")

    scaler.save(os.path.join(out_dir, "scaler.json"))
    metadata = {
        "task": "investigate",
        "features": MANIPULATION_FEATURE_COLUMNS,
        "classes": ["TYPICAL", "INVESTIGATE"],
        "samples": int(x.shape[0]),
        "positives": n_pos,
        "negatives": n_neg,
        "model_version": "manipulation-boosted-v1",
        "labeling": "weak residual outliers + optional synthetic pump-dump; not legal findings",
        "synthetic": synthetic,
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    print(f"[train-manipulation] artifacts written to {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Train unusual-activity (investigate) models")
    parser.add_argument("--days", type=int, default=1500)
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--symbols", type=str, default="")
    add_universe_arg(parser)
    args = parser.parse_args()
    basket = normalize_universe(args.universe)
    symbols = (
        [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        if args.symbols
        else load_universe(basket)
    )
    print(f"[train-manipulation] universe: {len(symbols)} symbols ({basket})", flush=True)
    train(symbols, args.days, args.synthetic)
    print(
        "[train-manipulation] done. Scores mean unusual vs history, not a finding of market abuse."
    )


if __name__ == "__main__":
    main()
