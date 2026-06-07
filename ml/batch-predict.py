#!/usr/bin/env python
"""Batch prediction for all universe stocks.

Usage:
    python ml/batch-predict.py [--limit 50]  # predict first 50 stocks (default all)
"""
import json
import os
import sys
import argparse
from typing import List

ML_ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "ml-engine")
sys.path.insert(0, os.path.abspath(ML_ENGINE_DIR))

from app.predict import predict_symbol
from app.data import load_universe


def batch_predict(symbols: List[str], output_file: str = "predictions.jsonl") -> None:
    """Predict for multiple symbols, save results to JSONL."""
    total = len(symbols)
    successful = 0
    failed = []

    print(f"Predicting {total} stocks...")
    with open(output_file, "w") as f:
        for i, symbol in enumerate(symbols, 1):
            try:
                predictions = predict_symbol(symbol)
                for pred in predictions:
                    f.write(json.dumps(pred) + "\n")
                successful += 1
                status = "✓" if (i % 10 == 0 or i == total) else ""
                if status or i <= 5:
                    print(f"  [{i:3d}/{total}] {symbol:15s} - OK {status}")
            except Exception as e:
                failed.append((symbol, str(e)))
                print(f"  [{i:3d}/{total}] {symbol:15s} - FAILED: {e}")

    print(f"\nCompleted: {successful}/{total} successful, {len(failed)} failed")
    if failed:
        print("\nFailed symbols:")
        for symbol, error in failed[:10]:  # Show first 10 failures
            print(f"  {symbol}: {error}")
        if len(failed) > 10:
            print(f"  ... and {len(failed) - 10} more")
    print(f"\nResults saved to: {output_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch predict for universe stocks")
    parser.add_argument("--limit", type=int, default=None, help="Limit predictions to N symbols")
    parser.add_argument("--output", type=str, default="predictions.jsonl", help="Output file")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated symbols (overrides universe)")
    args = parser.parse_args()

    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    else:
        symbols = load_universe()

    if args.limit:
        symbols = symbols[: args.limit]

    print(f"Universe: {len(symbols)} stocks")
    batch_predict(symbols, args.output)
