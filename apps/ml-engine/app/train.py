"""Training pipeline: pooled dataset across the universe, one model set per horizon.

Usage:
    python -m app.train [--days 1500] [--universe nifty50] [--synthetic] [--symbols RELIANCE,TCS,...]
"""
import argparse
import json
import os
from typing import Dict, List

import numpy as np

from .config import CLASSES, CORE_HORIZONS, HORIZONS, settings
from .data import load_candles, load_market_context, load_universe, synthetic_candles
from .universes import add_universe_arg, normalize_universe
from .features import FEATURE_COLUMNS, build_features, make_dataset
from .models.boosted import LgbmModel, XgbModel
from .models.scaler import Scaler
from .models.sequence import LstmModel, TransformerModel, make_sequences


def collect_dataset(
    symbols: List[str], days: int, synthetic: bool, horizon_bars: int, threshold: float
):
    market = load_market_context(days) if not synthetic else None
    xs, ys, fwds = [], [], []
    skipped = []
    for i, symbol in enumerate(symbols):
        try:
            candles = (
                synthetic_candles(symbol, days) if synthetic else load_candles(symbol, days)
            )
        except RuntimeError as error:
            # Real-data-only policy: a symbol with no real data is skipped,
            # never silently replaced with synthetic candles.
            print(f"[train] skipping {symbol}: {error}", flush=True)
            skipped.append(symbol)
            continue
        features = build_features(candles, market)
        x, y, fwd = make_dataset(features, horizon_bars, threshold)
        if len(x) > 0:
            xs.append(x)
            ys.append(y)
            fwds.append(fwd)
        if (i + 1) % 25 == 0 or i + 1 == len(symbols):
            print(
                f"[train] features {i + 1}/{len(symbols)} "
                f"(kept {len(xs)}, skipped {len(skipped)})",
                flush=True,
            )
    if skipped:
        print(f"[train] WARNING: {len(skipped)} symbols skipped (no real data): {skipped}")
    if not xs:
        raise RuntimeError(
            "No training data could be built - is the market-data-service running? "
            "(use --synthetic only for offline experiments)"
        )
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(fwds)


def class_move_stats(y: np.ndarray, fwd: np.ndarray) -> Dict[str, float]:
    """Median |forward return| per class - powers expectedMove."""
    stats: Dict[str, float] = {}
    for index, name in enumerate(CLASSES):
        moves = np.abs(fwd[y == index])
        stats[name] = float(np.median(moves)) if len(moves) > 0 else 0.0
    return stats


def train_horizon(horizon: str, symbols: List[str], days: int, synthetic: bool) -> None:
    config = HORIZONS[horizon]
    print(f"[train] horizon={horizon} bars={config['bars']} threshold={config['threshold']}", flush=True)
    x, y, fwd = collect_dataset(symbols, days, synthetic, config["bars"], config["threshold"])
    print(f"[train] dataset: {x.shape[0]} samples x {x.shape[1]} features")
    distribution = {CLASSES[i]: int((y == i).sum()) for i in range(3)}
    print(f"[train] class distribution: {distribution}")

    scaler = Scaler().fit(x)
    x_scaled = scaler.transform(x)

    out_dir = os.path.join(settings.models_dir, horizon)
    os.makedirs(out_dir, exist_ok=True)

    xgb = XgbModel()
    xgb.train(x_scaled, y)
    xgb.save(os.path.join(out_dir, "xgboost.json"))
    print("[train] xgboost saved")

    lgbm = LgbmModel()
    lgbm.train(x_scaled, y)
    lgbm.save(os.path.join(out_dir, "lightgbm.txt"))
    print("[train] lightgbm saved")

    n_features = x.shape[1]
    lstm = LstmModel(n_features)
    lstm.train(x_scaled, y)
    lstm.save(os.path.join(out_dir, "lstm.pt"))
    print("[train] lstm saved")

    transformer = TransformerModel(n_features)
    transformer.train(x_scaled, y)
    transformer.save(os.path.join(out_dir, "transformer.pt"))
    print("[train] transformer saved")

    scaler.save(os.path.join(out_dir, "scaler.json"))
    metadata = {
        "horizon": horizon,
        "features": FEATURE_COLUMNS,
        "classes": CLASSES,
        "class_moves": class_move_stats(y, fwd),
        "samples": int(x.shape[0]),
        "class_distribution": distribution,
        "model_version": settings.model_version,
        "synthetic": synthetic,
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    print(f"[train] {horizon} artifacts written to {out_dir}")

    # Quick sanity check: the saved sequence models must produce a window prediction.
    _x_seq, _ = make_sequences(x_scaled, y)
    if len(_x_seq) > 0:
        proba = lstm.predict_proba_last(x_scaled)
        assert proba.shape == (1, 3), "lstm output shape mismatch"


def main() -> None:
    parser = argparse.ArgumentParser(description="Train StockPred ML models")
    parser.add_argument("--days", type=int, default=1500, help="history depth in days")
    parser.add_argument("--synthetic", action="store_true", help="force synthetic data (offline)")
    parser.add_argument("--symbols", type=str, default="", help="comma-separated symbol override")
    parser.add_argument("--all-horizons", action="store_true", help="also train 10D and 20D models")
    add_universe_arg(parser)
    args = parser.parse_args()
    basket = normalize_universe(args.universe)

    symbols = (
        [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        if args.symbols
        else load_universe(basket)
    )
    print(
        f"[train] universe: {len(symbols)} symbols ({basket}), "
        f"{args.days} days, synthetic={args.synthetic}",
        flush=True,
    )
    horizons = list(HORIZONS) if args.all_horizons else list(CORE_HORIZONS)
    for horizon in horizons:
        train_horizon(horizon, symbols, args.days, args.synthetic)
    print("[train] done. Predictions are probabilistic - this is not investment advice.")


if __name__ == "__main__":
    main()
