"""Score the listed universe and write ml-models/latest-predictions.json."""
from typing import List, Optional

from .config import HORIZONS
from .data import load_macro_panel, load_news_panel, load_social_panel, load_fundamentals_panel, load_market_context, load_universe
from .persistence import cache_prediction, persist_latest_file
from .predict import get_models, missing_models_message, models_available, predict_symbol
from .universes import add_universe_arg, normalize_universe


def run(
    limit: Optional[int] = 150,
    symbols: Optional[List[str]] = None,
    universe: str = "all",
) -> int:
    if not models_available():
        raise RuntimeError(missing_models_message(universe))
    names = symbols if symbols else load_universe(universe)
    if limit is not None:
        names = names[:limit]
    print(f"[batch] scoring {len(names)} symbols universe={universe}", flush=True)
    print("[batch] loading models (once)", flush=True)
    for horizon in HORIZONS:
        try:
            get_models(horizon)
        except FileNotFoundError:
            continue
    load_market_context(120)
    load_fundamentals_panel()
    load_news_panel()
    load_social_panel()
    load_macro_panel()
    print("[batch] models ready", flush=True)
    written = 0
    for i, symbol in enumerate(names):
        print(f"[batch] {i + 1}/{len(names)} scoring {symbol}", flush=True)
        try:
            for prediction in predict_symbol(symbol):
                cache_prediction(prediction)
                written += 1
        except Exception as error:  # noqa: BLE001
            print(f"[batch] skip {symbol}: {error}", flush=True)
    persist_latest_file()
    print(f"[batch] wrote {written} predictions for {len(names)} symbols", flush=True)
    return written


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=150)
    parser.add_argument(
        "--all",
        action="store_true",
        help="score the full listed universe (ignores --limit)",
    )
    parser.add_argument("--symbols", type=str, default="", help="comma-separated symbol override")
    add_universe_arg(parser)
    args = parser.parse_args()
    basket = normalize_universe(args.universe)
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] if args.symbols else None
    run(None if args.all else args.limit, symbols, basket)


if __name__ == "__main__":
    main()
