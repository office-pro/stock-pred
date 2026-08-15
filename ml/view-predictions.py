#!/usr/bin/env python
"""View and analyze predictions.jsonl"""
import json
import sys
from collections import defaultdict, Counter
from pathlib import Path

import pandas as pd


def load_predictions(filename: str = "predictions.jsonl"):
    """Load predictions from JSONL file."""
    predictions = []
    with open(filename, "r") as f:
        for line in f:
            if line.strip():
                predictions.append(json.loads(line))
    return predictions


def view_summary(predictions: list):
    """Print summary statistics."""
    df = pd.DataFrame(predictions)

    print("\n" + "=" * 80)
    print("PREDICTIONS SUMMARY")
    print("=" * 80)
    print(f"\nTotal predictions: {len(predictions)}")
    print(f"Unique symbols: {df['symbol'].nunique()}")
    print(f"Horizons: {df['horizon'].unique().tolist()}")

    # Direction distribution
    print("\n[DIRECTION DISTRIBUTION]")
    for horizon in df["horizon"].unique():
        subset = df[df["horizon"] == horizon]
        print(f"\n  {horizon}:")
        directions = subset["direction"].value_counts()
        for direction, count in directions.items():
            pct = (count / len(subset)) * 100
            print(f"    {direction:10s}: {count:3d} ({pct:5.1f}%)")

    # Confidence analysis
    print("\n[CONFIDENCE ANALYSIS]")
    for horizon in df["horizon"].unique():
        subset = df[df["horizon"] == horizon]
        print(f"\n  {horizon}:")
        print(f"    Mean:   {subset['confidence'].mean():.1f}%")
        print(f"    Median: {subset['confidence'].median():.1f}%")
        print(f"    Min:    {subset['confidence'].min():.1f}%")
        print(f"    Max:    {subset['confidence'].max():.1f}%")

    # High confidence predictions
    print("\n[HIGH CONFIDENCE PREDICTIONS >65%]")
    high_conf = df[df["confidence"] > 65]
    print(f"  Count: {len(high_conf)}")
    if len(high_conf) > 0:
        for direction in ["UP", "DOWN", "SIDEWAYS"]:
            count = len(high_conf[high_conf["direction"] == direction])
            if count > 0:
                print(f"    {direction}: {count}")


def view_table(predictions: list, limit: int = 20, filter_direction: str = None):
    """Print predictions as table."""
    df = pd.DataFrame(predictions)

    if filter_direction:
        df = df[df["direction"] == filter_direction.upper()]

    df = df.head(limit)[
        ["symbol", "horizon", "direction", "confidence", "expectedMove"]
    ]
    df["confidence"] = df["confidence"].apply(lambda x: f"{x:.1f}%")

    print("\n" + "=" * 80)
    print(f"PREDICTIONS TABLE (First {limit})")
    print("=" * 80)
    print(df.to_string(index=False))
    print()


def view_by_symbol(predictions: list, symbol: str):
    """Show all predictions for a symbol."""
    df = pd.DataFrame(predictions)
    symbol_data = df[df["symbol"].str.upper() == symbol.upper()]

    if len(symbol_data) == 0:
        print(f"\n[ERROR] No predictions found for {symbol}")
        return

    print("\n" + "=" * 80)
    print(f"PREDICTIONS FOR {symbol}")
    print("=" * 80)

    for _, row in symbol_data.iterrows():
        print(f"\n  Horizon: {row['horizon']}")
        print(
            f"    Direction:   {row['direction']} ({row['confidence']:.1f}% confidence)"
        )
        print(f"    Expected Move: {row['expectedMove']:.2f}%")
        print(f"    Probabilities:")
        for direction, prob in row["probabilities"].items():
            print(f"      {direction:10s}: {prob:.2f}%")


def export_csv(predictions: list, output_file: str = "predictions.csv"):
    """Export predictions to CSV."""
    df = pd.DataFrame(predictions)
    df.to_csv(output_file, index=False)
    print(f"\n[OK] Exported to {output_file}")


def main():
    if len(sys.argv) < 2:
        # Default: show summary
        predictions = load_predictions()
        view_summary(predictions)
        view_table(predictions, limit=20)
        export_csv(predictions)
    else:
        command = sys.argv[1].lower()
        predictions = load_predictions()

        if command == "summary":
            view_summary(predictions)

        elif command == "table":
            limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
            view_table(predictions, limit=limit)

        elif command == "up":
            view_table(predictions, limit=50, filter_direction="UP")

        elif command == "down":
            view_table(predictions, limit=50, filter_direction="DOWN")

        elif command == "symbol":
            if len(sys.argv) < 3:
                print("Usage: python view-predictions.py symbol SYMBOL")
                sys.exit(1)
            view_by_symbol(predictions, sys.argv[2])

        elif command == "csv":
            output = sys.argv[2] if len(sys.argv) > 2 else "predictions.csv"
            export_csv(predictions, output)

        elif command == "html":
            output = sys.argv[2] if len(sys.argv) > 2 else "predictions.html"
            export_html(predictions, output)

        else:
            print(f"Unknown command: {command}")
            print(
                "Usage: python view-predictions.py [summary|table|up|down|symbol SYMBOL|csv|html]"
            )


def export_html(predictions: list, output_file: str = "predictions.html"):
    """Export predictions to interactive HTML."""
    df = pd.DataFrame(predictions)

    html_header = f"""<!DOCTYPE html>
<html>
<head>
    <title>Stock Predictions</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; }}
        h1 {{ color: #333; }}
        table {{ border-collapse: collapse; width: 100%; margin-top: 20px; }}
        th {{ background: #333; color: white; padding: 10px; text-align: left; }}
        td {{ padding: 10px; border-bottom: 1px solid #ddd; }}
        tr:hover {{ background: #f5f5f5; }}
        .up {{ background: #d4edda; color: #155724; font-weight: bold; }}
        .down {{ background: #f8d7da; color: #721c24; font-weight: bold; }}
        .sideways {{ background: #fff3cd; color: #856404; font-weight: bold; }}
        .metric {{ display: inline-block; margin-right: 30px; }}
        .summary {{ background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }}
    </style>
</head>
<body>
    <h1>Stock Predictions Report</h1>
    <div class="summary">
        <div class="metric"><strong>Total Predictions:</strong> {len(predictions)}</div>
        <div class="metric"><strong>Unique Symbols:</strong> {df['symbol'].nunique()}</div>
        <div class="metric"><strong>Horizons:</strong> {", ".join(df['horizon'].unique())}</div>
    </div>
    <table>
        <thead>
            <tr>
                <th>Symbol</th>
                <th>Horizon</th>
                <th>Direction</th>
                <th>Confidence</th>
                <th>Expected Move</th>
                <th>DOWN %</th>
                <th>SIDEWAYS %</th>
                <th>UP %</th>
            </tr>
        </thead>
        <tbody>
"""

    html_rows = ""
    for _, row in df.iterrows():
        direction_class = row["direction"].lower()
        html_rows += f"""            <tr>
                <td><strong>{row['symbol']}</strong></td>
                <td>{row['horizon']}</td>
                <td class="{direction_class}">{row['direction']}</td>
                <td>{row['confidence']:.1f}%</td>
                <td>{row['expectedMove']:.2f}%</td>
                <td>{row['probabilities']['DOWN']:.1f}%</td>
                <td>{row['probabilities']['SIDEWAYS']:.1f}%</td>
                <td>{row['probabilities']['UP']:.1f}%</td>
            </tr>
"""

    html_footer = """        </tbody>
    </table>
</body>
</html>"""

    html = html_header + html_rows + html_footer

    with open(output_file, "w") as f:
        f.write(html)
    print(f"\n[OK] Exported to {output_file}")
    print(f"   Open in browser: file://{Path(output_file).absolute()}")


if __name__ == "__main__":
    main()
