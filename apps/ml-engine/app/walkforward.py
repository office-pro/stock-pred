"""Walk-forward retraining: expanding yearly folds, trees only.

Does not overwrite live artifacts in ml-models/<horizon>/. Writes walkforward.json.
"""
from __future__ import annotations

import argparse
import json
import os
from typing import Dict, List

import numpy as np

from .config import CORE_HORIZONS, HORIZONS, settings
from .data import load_universe
from .models.scaler import Scaler
from .split import expanding_year_folds
from .tabular_eval import tabular_summary
from .train import _fit_trees, collect_dataset
from .universes import add_universe_arg, normalize_universe


def run_horizon(horizon: str, symbols: List[str], days: int, synthetic: bool) -> Dict[str, object]:
    config = HORIZONS[horizon]
    print(f"[walkforward] horizon={horizon}", flush=True)
    x, y, _fwd, times = collect_dataset(symbols, days, synthetic, config["bars"], config["threshold"])
    folds = expanding_year_folds(times)
    if not folds:
        print("[walkforward] not enough history for annual folds", flush=True)
        return {"horizon": horizon, "folds": [], "overallHitRate": None}
    rows = []
    hits = []
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
        summary = tabular_summary(scaler.transform(x[test]), y[test], xgb, lgbm)
        summary["year"] = fold["year"]
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
    return {"horizon": horizon, "folds": rows, "overallHitRate": overall, "ensemble": "trees"}


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
        report["horizons"][horizon] = run_horizon(horizon, symbols, args.days, args.synthetic)
    os.makedirs(settings.models_dir, exist_ok=True)
    path = os.path.join(settings.models_dir, "walkforward.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(f"[walkforward] wrote {path}", flush=True)
    print("[walkforward] done. This is not investment advice.")


if __name__ == "__main__":
    main()
