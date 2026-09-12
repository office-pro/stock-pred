"""Training pipeline: pooled dataset across the universe, one model set per horizon.

Usage:
    python -m app.train [--days 1500] [--universe nifty50] [--trees-only] [--holdout-days 365]
"""
import argparse
import json
import os
import uuid
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .config import CLASSES, CORE_HORIZONS, HORIZONS, settings
from .data import attach_alt_data, load_candles, load_market_context, load_universe, synthetic_candles
from .feature_cache import (
    WARMUP_BARS,
    append_features,
    load_symbol_cache,
    save_symbol_cache,
    wipe_feature_cache,
)
from .registry import register_model
from .dataset_quality import (
    assert_dataset_quality,
    build_dataset_quality_report,
    persist_dataset_quality,
)
from .features import FEATURE_COLUMNS, FEATURE_SET_VERSION, build_features, make_dataset
from .models.boosted import LgbmModel, XgbModel
from .models.scaler import Scaler
from .models.sequence import LstmModel, TransformerModel, make_sequences
from .split import DEFAULT_HOLDOUT_DAYS, train_holdout_masks
from .tabular_eval import tabular_summary
from .universes import add_full_arg, add_universe_arg, normalize_universe


def _features_for_symbol(
    symbol: str,
    candles: pd.DataFrame,
    market: Dict[str, object],
    days: int,
    use_cache: bool,
) -> "pd.DataFrame":
    cached = load_symbol_cache(symbol) if use_cache else None
    last_time = int(cached["time"].max()) if cached is not None and len(cached) else None
    if cached is not None and last_time is not None:
        new_mask = candles["time"] > last_time
        new_count = int(new_mask.sum())
        if new_count == 0:
            frame = cached
            if "time" in candles.columns and len(candles):
                frame = frame[frame["time"] >= int(candles["time"].min())]
            print(
                f"[train] cache hit {symbol}: {len(frame)} rows, compute 0 new",
                flush=True,
            )
            return frame
        positions = np.flatnonzero(new_mask.to_numpy())
        first_new = int(positions[0])
        start = max(0, first_new - WARMUP_BARS)
        rebuilt = build_features(candles.iloc[start:], market, symbol=symbol)
        frame = append_features(cached, rebuilt, last_time)
        if "time" in candles.columns and len(candles):
            frame = frame[frame["time"] >= int(candles["time"].min())]
        print(
            f"[train] cache hit {symbol}: {len(cached)} rows, compute {new_count} new",
            flush=True,
        )
        save_symbol_cache(symbol, frame, days)
        return frame
    frame = build_features(candles, market, symbol=symbol)
    print(f"[train] cache miss {symbol}: compute {len(frame)}", flush=True)
    if use_cache:
        save_symbol_cache(symbol, frame, days)
    return frame


def collect_dataset(
    symbols: List[str],
    days: int,
    synthetic: bool,
    horizon_bars: int,
    threshold: float,
    use_cache: bool = True,
    universe: str = "nifty50",
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, Dict[str, np.ndarray]]:
    """Build pooled (X, y, fwd, times, path_targets) with PIT membership + adjusted prices."""
    from .historical_universe import (
        filter_times_by_membership,
        list_snapshot_dates,
        pit_violation_count,
        save_universe_snapshot,
    )
    from .price_policy import PRICE_POLICY_VERSION, assert_canonical_mode, read_mode_from_frame

    market = attach_alt_data(load_market_context(days)) if not synthetic else {}
    xs, ys, fwds, times = [], [], [], []
    path_buckets: Dict[str, List[np.ndarray]] = {
        "forwardReturn": [],
        "maxFavorableExcursion": [],
        "maxAdverseExcursion": [],
    }
    skipped = []
    membership_drops = 0
    pit_membership_violations = 0
    cache_on = use_cache and not synthetic

    # Seed a today snapshot so subsequent as-of lookups have at least one file.
    if not list_snapshot_dates(universe):
        as_of = pd.Timestamp.utcnow().strftime("%Y-%m-%d")
        save_universe_snapshot(universe=universe, as_of=as_of, symbols=symbols)
        print(f"[train] seeded universe snapshot {universe} asOf={as_of}", flush=True)

    for i, symbol in enumerate(symbols):
        try:
            candles = (
                synthetic_candles(symbol, days) if synthetic else load_candles(symbol, days)
            )
        except RuntimeError as error:
            print(f"[train] skipping {symbol}: {error}", flush=True)
            skipped.append(symbol)
            continue
        mode = read_mode_from_frame(candles)
        assert_canonical_mode(mode, context=f"train:{symbol}")
        features = _features_for_symbol(symbol, candles, market, days, cache_on)
        x, y, fwd, clock, paths = make_dataset(features, horizon_bars, threshold)
        if len(x) == 0:
            continue
        member_mask = filter_times_by_membership(
            symbol, clock, universe=universe, fallback_symbols=symbols
        )
        member_mask_arr = np.asarray(member_mask, dtype=bool)
        if not member_mask_arr.all():
            dropped = int((~member_mask_arr).sum())
            membership_drops += dropped
            pit_membership_violations += pit_violation_count(
                symbol, clock, universe=universe, fallback_symbols=symbols
            )
            x = x[member_mask_arr]
            y = y[member_mask_arr]
            fwd = fwd[member_mask_arr]
            clock = clock[member_mask_arr]
            paths = {k: v[member_mask_arr] for k, v in paths.items()}
        if len(x) == 0:
            continue
        xs.append(x)
        ys.append(y)
        fwds.append(fwd)
        times.append(clock)
        for key in path_buckets:
            path_buckets[key].append(paths[key])
        if (i + 1) % 25 == 0 or i + 1 == len(symbols):
            print(
                f"[train] features {i + 1}/{len(symbols)} "
                f"(kept {len(xs)}, skipped {len(skipped)}, "
                f"membershipDrops={membership_drops})",
                flush=True,
            )
    if skipped:
        print(f"[train] WARNING: {len(skipped)} symbols skipped (no real data): {skipped}")
    if not xs:
        raise RuntimeError(
            "No training data could be built - is the market-data-service running? "
            "(use --synthetic only for offline experiments)"
        )
    path_targets = {
        key: np.concatenate(vals) if vals else np.array([], dtype="float32")
        for key, vals in path_buckets.items()
    }
    collect_dataset.last_meta = {  # type: ignore[attr-defined]
        "membershipDrops": membership_drops,
        "pitMembershipViolations": pit_membership_violations,
        "pricePolicyVersion": PRICE_POLICY_VERSION,
        "universe": universe,
    }
    return (
        np.concatenate(xs),
        np.concatenate(ys),
        np.concatenate(fwds),
        np.concatenate(times),
        path_targets,
    )


def class_move_stats(y: np.ndarray, fwd: np.ndarray) -> Dict[str, float]:
    stats: Dict[str, float] = {}
    for index, name in enumerate(CLASSES):
        moves = np.abs(fwd[y == index])
        stats[name] = float(np.median(moves)) if len(moves) > 0 else 0.0
    return stats


def _fit_trees(x_scaled: np.ndarray, y: np.ndarray) -> Tuple[XgbModel, LgbmModel]:
    xgb = XgbModel()
    xgb.train(x_scaled, y)
    lgbm = LgbmModel()
    lgbm.train(x_scaled, y)
    return xgb, lgbm


def _fit_sequences(x_scaled: np.ndarray, y: np.ndarray, n_features: int):
    lstm = LstmModel(n_features)
    lstm.train(x_scaled, y)
    transformer = TransformerModel(n_features)
    transformer.train(x_scaled, y)
    return lstm, transformer


def _write_holdout(horizon: str, summary: Dict[str, object]) -> None:
    path = os.path.join(settings.models_dir, "holdout.json")
    payload: Dict[str, object] = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    payload[horizon] = summary
    os.makedirs(settings.models_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def train_horizon(
    horizon: str,
    symbols: List[str],
    days: int,
    synthetic: bool,
    trees_only: bool,
    holdout_days: int,
    universe: str = "nifty50",
) -> None:
    from .path_labels import assert_mfe_mae_consistency
    from .price_policy import CANONICAL_MODE, PRICE_POLICY_VERSION, policy_stamp
    from .regressors import save_path_regressors, train_path_regressors

    config = HORIZONS[horizon]
    print(f"[train] horizon={horizon} bars={config['bars']} threshold={config['threshold']}", flush=True)
    x, y, fwd, times, path_targets = collect_dataset(
        symbols,
        days,
        synthetic,
        config["bars"],
        config["threshold"],
        universe=universe,
    )
    print(f"[train] dataset: {x.shape[0]} samples x {x.shape[1]} features", flush=True)
    assert_mfe_mae_consistency(
        path_targets["forwardReturn"],
        path_targets["maxFavorableExcursion"],
        path_targets["maxAdverseExcursion"],
    )
    collect_meta = getattr(collect_dataset, "last_meta", {}) or {}
    quality = build_dataset_quality_report(
        x=x,
        y=y,
        times=times,
        symbols=symbols,
        pit_membership_violations=int(collect_meta.get("pitMembershipViolations") or 0),
        price_policy_mode=CANONICAL_MODE,
        price_policy_version=PRICE_POLICY_VERSION,
        unverified_adjustment=not synthetic,
    )
    assert_dataset_quality(quality, context=f"train:{horizon}")

    train_mask, holdout_mask = train_holdout_masks(times, holdout_days)
    if holdout_mask.any():
        print(
            f"[train] time-series split: train={int(train_mask.sum())} "
            f"holdout={int(holdout_mask.sum())} (last {holdout_days} days)",
            flush=True,
        )
        x_fit, y_fit = x[train_mask], y[train_mask]
        path_fit = {k: v[train_mask] for k, v in path_targets.items()}
    else:
        if holdout_days:
            print("[train] holdout window too small - fitting all labeled rows", flush=True)
        x_fit, y_fit = x, y
        path_fit = path_targets

    distribution = {CLASSES[i]: int((y_fit == i).sum()) for i in range(3)}
    print(f"[train] class distribution: {distribution}", flush=True)

    scaler = Scaler().fit(x_fit)
    x_scaled = scaler.transform(x_fit)

    xgb, lgbm = _fit_trees(x_scaled, y_fit)
    print("[train] xgboost trained", flush=True)
    print("[train] lightgbm trained", flush=True)

    holdout_summary: Optional[Dict[str, object]] = None
    if holdout_mask.any():
        x_h = scaler.transform(x[holdout_mask])
        holdout_summary = tabular_summary(
            x_h, y[holdout_mask], xgb, lgbm, forward_returns=fwd[holdout_mask]
        )
        holdout_summary.update(
            {
                "horizon": horizon,
                "holdoutDays": holdout_days,
                "trainSamples": int(train_mask.sum()),
                "holdoutSamples": int(holdout_mask.sum()),
                "sessions": int(holdout_mask.sum()),
                "byAction": {
                    "BUY": holdout_summary["byClass"]["UP"],
                    "SELL": holdout_summary["byClass"]["DOWN"],
                    "HOLD": holdout_summary["byClass"]["SIDEWAYS"],
                },
                "calibration": [],
                "avgPnlPercent": None,
            }
        )
        print(
            f"[train] holdout hitRate={holdout_summary['overallHitRate']} "
            f"n={holdout_summary['scoredCalls']} ensemble=trees",
            flush=True,
        )
        _write_holdout(horizon, holdout_summary)

    lstm = transformer = None
    if not trees_only:
        lstm, transformer = _fit_sequences(x_scaled, y_fit, x.shape[1])
        print("[train] lstm trained", flush=True)
        print("[train] transformer trained", flush=True)

    print("[train] refitting on all labeled rows for live artifacts", flush=True)
    scaler = Scaler().fit(x)
    x_all = scaler.transform(x)
    xgb, lgbm = _fit_trees(x_all, y)
    regressors = train_path_regressors(x_all, path_targets)
    print(f"[train] path regressors: {list(regressors)}", flush=True)
    if not trees_only:
        lstm, transformer = _fit_sequences(x_all, y, x.shape[1])

    model_id = str(uuid.uuid4())
    out_dir = os.path.join(settings.models_dir, horizon, "candidates", model_id)
    os.makedirs(out_dir, exist_ok=True)
    xgb.save(os.path.join(out_dir, "xgboost.json"))
    print("[train] xgboost saved", flush=True)
    lgbm.save(os.path.join(out_dir, "lightgbm.txt"))
    print("[train] lightgbm saved", flush=True)
    if regressors:
        save_path_regressors(regressors, out_dir)
        print("[train] path regressors saved", flush=True)
    if lstm is not None and transformer is not None:
        lstm.save(os.path.join(out_dir, "lstm.pt"))
        print("[train] lstm saved", flush=True)
        transformer.save(os.path.join(out_dir, "transformer.pt"))
        print("[train] transformer saved", flush=True)
        seq_ok, _ = make_sequences(x_all, y)
        if len(seq_ok) > 0:
            proba = lstm.predict_proba_last(x_all)
            assert proba.shape == (1, 3), "lstm output shape mismatch"
    else:
        for name in ("lstm.pt", "transformer.pt"):
            path = os.path.join(out_dir, name)
            if os.path.exists(path):
                os.remove(path)

    scaler.save(os.path.join(out_dir, "scaler.json"))
    with open(os.path.join(out_dir, "feature-baseline.json"), "w", encoding="utf-8") as handle:
        json.dump(
            {
                "schemaVersion": "feature-baseline.v1",
                "featureNames": FEATURE_COLUMNS,
                "mean": scaler.mean.tolist(),
                "std": scaler.std.tolist(),
            },
            handle,
            indent=2,
        )
    stamp = policy_stamp()
    metadata = {
        "horizon": horizon,
        "features": FEATURE_COLUMNS,
        "feature_version": FEATURE_SET_VERSION,
        "dataset_version": settings.dataset_version,
        "classes": CLASSES,
        "class_moves": class_move_stats(y, fwd),
        "samples": int(x.shape[0]),
        "n_features": int(x.shape[1]),
        "fundamentals": True,
        "class_distribution": {CLASSES[i]: int((y == i).sum()) for i in range(3)},
        "model_version": settings.model_version,
        "synthetic": synthetic,
        "ensemble": "trees" if trees_only else "full",
        "holdoutDays": holdout_days,
        "holdout": holdout_summary,
        "fitSamples": int(x_fit.shape[0]),
        "universe": universe,
        **stamp,
        "pathTargets": list(path_targets.keys()),
        "authorizationBoundary": "ML→TradeIntelligence_only",
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    persist_dataset_quality(quality, out_dir)
    metadata["dataset_quality"] = {
        "passed": quality.get("passed"),
        "rows": quality.get("rows"),
        "pitViolations": quality.get("pitViolations"),
        "pitMembershipViolations": quality.get("pitMembershipViolations"),
        "missingRate": quality.get("missingRate"),
        "classCounts": quality.get("classCounts"),
        "pricePolicy": quality.get("pricePolicy"),
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    entry = register_model(
        horizon=horizon,
        model_id=model_id,
        model_version=str(metadata["model_version"]),
        feature_version=FEATURE_SET_VERSION,
        dataset_version=str(metadata["dataset_version"]),
        algorithm="ensemble-trees" if trees_only else "ensemble-full",
        metrics={
            "holdout": holdout_summary if holdout_summary else {},
            "datasetQuality": metadata["dataset_quality"],
        },
        activate=False,
        artifact_dir=out_dir,
    )
    print(
        f"[train] {horizon} candidate modelId={entry['modelId']} "
        f"written to {out_dir} (candidate until promote)",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train StockPred ML models")
    parser.add_argument("--days", type=int, default=1500, help="history depth in days")
    parser.add_argument("--synthetic", action="store_true", help="force synthetic data (offline)")
    parser.add_argument("--symbols", type=str, default="", help="comma-separated symbol override")
    parser.add_argument("--all-horizons", action="store_true", help="also train 10D and 20D models")
    parser.add_argument(
        "--trees-only",
        action="store_true",
        default=True,
        help="train XGBoost+LightGBM only (default). Use --full-ensemble for LSTM/Transformer.",
    )
    parser.add_argument(
        "--full-ensemble",
        action="store_true",
        help="also train LSTM and Transformer (35% of the live blend)",
    )
    parser.add_argument(
        "--holdout-days",
        type=int,
        default=DEFAULT_HOLDOUT_DAYS,
        help="last N calendar days held out of the fit (0 disables)",
    )
    add_universe_arg(parser)
    add_full_arg(parser)
    args = parser.parse_args()
    trees_only = not args.full_ensemble
    basket = normalize_universe(args.universe)

    symbols = (
        [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        if args.symbols
        else load_universe(basket)
    )
    # Single-symbol desk train: mix in Nifty 50 so trees have enough samples to write artifacts.
    scoped = bool(args.symbols)
    if scoped:
        support = load_universe("nifty50")
        symbols = list(dict.fromkeys([*symbols, *support]))
        print(
            f"[train] scoped train: primary={args.symbols} + {len(support)} nifty50 support names "
            f"({len(symbols)} total)",
            flush=True,
        )
    if args.full and not args.synthetic:
        wipe_feature_cache()
        print("[train] --full: wiped feature cache", flush=True)
    elif not args.synthetic and not scoped:
        from .incremental import has_new_feature_bars, live_models_ready

        if live_models_ready() and not has_new_feature_bars(symbols):
            print(
                f"[train] cache hit: {len(symbols)} symbols, 0 new bars — keeping live models",
                flush=True,
            )
            print("[train] done. Predictions are probabilistic - this is not investment advice.")
            return
    print(
        f"[train] universe: {len(symbols)} symbols ({basket}), "
        f"{args.days} days, synthetic={args.synthetic}, "
        f"ensemble={'trees' if trees_only else 'full'}, holdoutDays={args.holdout_days}",
        flush=True,
    )
    horizons = list(HORIZONS) if args.all_horizons else list(CORE_HORIZONS)
    for horizon in horizons:
        train_horizon(
            horizon,
            symbols,
            args.days,
            args.synthetic,
            trees_only,
            args.holdout_days,
            universe=basket,
        )
    print("[train] done. Predictions are probabilistic - this is not investment advice.")


if __name__ == "__main__":
    main()
