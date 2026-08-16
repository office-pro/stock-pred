"""Score the listed universe and write ml-models/latest-predictions.json."""
from typing import List, Optional

from .data import load_universe
from .persistence import cache_prediction, persist_latest_file
from .predict import models_available, predict_symbol


def run(limit: Optional[int] = 150, symbols: Optional[List[str]] = None) -> int:
    if not models_available():
        raise RuntimeError("No trained models - run python -m app.train first")
    names = symbols if symbols else load_universe()
    if limit is not None:
        names = names[:limit]
    written = 0
    for symbol in names:
        try:
            for prediction in predict_symbol(symbol):
                cache_prediction(prediction)
                written += 1
        except Exception as error:  # noqa: BLE001
            print(f"[batch] skip {symbol}: {error}")
    persist_latest_file()
    print(f"[batch] wrote {written} predictions for {len(names)} symbols")
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
    args = parser.parse_args()
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] if args.symbols else None
    run(None if args.all else args.limit, symbols)


if __name__ == "__main__":
    main()
