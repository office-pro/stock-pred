"""Walk-forward retraining: expanding yearly folds, trees only.

Does not overwrite live artifacts in ml-models/<horizon>/. Writes walkforward.json.
Fits OOS calibrator and records M3 cost/imbalance evidence.
"""
from __future__ import annotations

import argparse
import json
import os
from typing import Dict, List

import numpy as np

from .calibration import fit_multiclass_calibrator, save_calibrator
from .config import CORE_HORIZONS, HORIZONS, settings
from .data import load_universe
from .eval_metrics import assert_cost_aware_promote_ok, assert_imbalance_promote_ok
from .models.ensemble import blend_probabilities
from .models.scaler import Scaler
from .promote_gates import summarize_walkforward_stability
from .registry import latest_candidate
from .split import expanding_year_folds
from .tabular_eval import tabular_summary
from .train import _fit_trees, collect_dataset
from .universes import add_universe_arg, normalize_universe


def run_horizon(
    horizon: str,
    symbols: List[str],
    days: int,
    synthetic: bool,
    universe: str,
) -> Dict[str, object]:
    config = HORIZONS[horizon]
    print(f"[walkforward] horizon={horizon}", flush=True)
    x, y, fwd, times, _paths = collect_dataset(
        symbols,
        days,
        synthetic,
        config["bars"],
        config["threshold"],
        universe=universe,
    )
    folds = expanding_year_folds(times)
    if not folds:
        print("[walkforward] not enough history for annual folds", flush=True)
        return summarize_walkforward_stability(
            {"horizon": horizon, "folds": [], "overallHitRate": None, "ensemble": "trees"}
        )
    rows = []
    hits = []
    oos_probs = []
    oos_labels = []
    for index, fold in enumerate(folds):
        print(
            f"[walkforward] fold {index + 1}/{len(folds)} year={fold['year']} "
            f"train={fold['trainRows']} test={fold['testRows']}",
            flush=True,
        )
        train = fold["train"]
        test = fold["test"]
        scaler = Scaler().fit(x[train])
        xgb, lgbm = _fit_trees(scaler.transform(x[train]), y[train])
        x_test = scaler.transform(x[test])
        summary = tabular_summary(
            x_test, y[test], xgb, lgbm, forward_returns=fwd[test]
        )
        summary["year"] = fold["year"]
        blended = blend_probabilities(
            {
                "xgboost": xgb.predict_proba(x_test),
                "lightgbm": lgbm.predict_proba(x_test),
                "lstm": None,
                "transformer": None,
            }
        )
        oos_probs.append(blended)
        oos_labels.append(y[test])
        print(
            f"[walkforward] year={fold['year']} hitRate={summary['overallHitRate']} "
            f"n={summary['scoredCalls']}",
            flush=True,
        )
        rows.append(summary)
        if summary.get("overallHitRate") is not None:
            hits.append(float(summary["overallHitRate"]))
    overall = round(float(np.mean(hits)), 2) if hits else None
    print(f"[walkforward] {horizon} mean hitRate={overall} folds={len(rows)}", flush=True)

    report: Dict[str, object] = {
        "horizon": horizon,
        "folds": rows,
        "overallHitRate": overall,
        "ensemble": "trees",
    }
    if oos_probs and oos_labels:
        probs = np.concatenate(oos_probs, axis=0)
        labels = np.concatenate(oos_labels, axis=0)
        calibrator = fit_multiclass_calibrator(labels, probs)
        candidate = latest_candidate(horizon)
        candidate_dir = candidate.get("artifactDir") if candidate else None
        out_dir = (
            str(candidate_dir)
            if candidate_dir
            else os.path.join(settings.models_dir, "candidates", "_wf_staging", horizon)
        )
        os.makedirs(out_dir, exist_ok=True)
        cal_path = os.path.join(out_dir, "calibration.json")
        save_calibrator(calibrator, cal_path)
        report["calibration"] = {
            "path": cal_path,
            "method": calibrator.get("method"),
            "metrics": calibrator.get("metrics"),
        }
        # Aggregate M3 evidence across folds (last fold's structure + mean nets).
        nets = [
            (f.get("costAware") or {}).get("avgNetReturn")
            for f in rows
            if (f.get("costAware") or {}).get("avgNetReturn") is not None
        ]
        bal = [
            (f.get("imbalance") or {}).get("balancedAccuracy")
            for f in rows
            if (f.get("imbalance") or {}).get("balancedAccuracy") is not None
        ]
        report["m3"] = {
            "meanNetReturn": round(float(np.mean(nets)), 6) if nets else None,
            "meanBalancedAccuracy": round(float(np.mean(bal)), 4) if bal else None,
        }
        # Soft evidence on the pooled OOS set for promote helpers.
        from .eval_metrics import cost_aware_summary, imbalance_metrics

        pred = probs.argmax(axis=1)
        # Reconstruct signed returns only if lengths match pooled fwd — use fold metrics.
        if bal:
            report["imbalance"] = {
                "balancedAccuracy": report["m3"]["meanBalancedAccuracy"],
                "perClass": (rows[-1].get("imbalance") or {}).get("perClass") or {},
            }
            # Prefer pooled imbalance for promote gates.
            report["imbalance"] = imbalance_metrics(labels, pred)
        if nets:
            report["costAware"] = {
                "avgNetReturn": report["m3"]["meanNetReturn"],
                "netPositive": float(np.mean(nets)) > 0,
                "samples": int(sum((f.get("costAware") or {}).get("samples") or 0 for f in rows)),
            }

    return summarize_walkforward_stability(report)


def main() -> None:
    parser = argparse.ArgumentParser(description="Walk-forward retrain (trees only)")
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
    print(f"[walkforward] universe={basket} symbols={len(symbols)} days={args.days}", flush=True)
    report = {
        "universe": basket,
        "days": args.days,
        "horizons": {},
    }
    for horizon in CORE_HORIZONS:
        report["horizons"][horizon] = run_horizon(
            horizon, symbols, args.days, args.synthetic, universe=basket
        )
    os.makedirs(settings.models_dir, exist_ok=True)
    path = os.path.join(settings.models_dir, "walkforward.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(f"[walkforward] wrote {path}", flush=True)
    print("[walkforward] done. This is not investment advice.")


if __name__ == "__main__":
    main()
