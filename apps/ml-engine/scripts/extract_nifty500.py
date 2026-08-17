"""One-shot: parse the Wikipedia Nifty 500 dump into index_universes.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

SRC = Path(
    r"C:\Users\asus\.cursor\projects\c-Users-asus-stock-pred\agent-tools"
    r"\d56f6fc4-c08c-44c7-a105-65cdb52dae4e.txt"
)
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "index_universes.json"

NIFTY_50 = [
    "ADANIENT",
    "ADANIPORTS",
    "APOLLOHOSP",
    "ASIANPAINT",
    "AXISBANK",
    "BAJAJ-AUTO",
    "BAJFINANCE",
    "BAJAJFINSV",
    "BEL",
    "BHARTIARTL",
    "CIPLA",
    "COALINDIA",
    "DRREDDY",
    "EICHERMOT",
    "ETERNAL",
    "GRASIM",
    "HCLTECH",
    "HDFCBANK",
    "HDFCLIFE",
    "HINDALCO",
    "HINDUNILVR",
    "ICICIBANK",
    "INDIGO",
    "INFY",
    "ITC",
    "JIOFIN",
    "JSWSTEEL",
    "KOTAKBANK",
    "LT",
    "M&M",
    "MARUTI",
    "MAXHEALTH",
    "NESTLEIND",
    "NTPC",
    "ONGC",
    "POWERGRID",
    "RELIANCE",
    "SBILIFE",
    "SHRIRAMFIN",
    "SBIN",
    "SUNPHARMA",
    "TCS",
    "TATACONSUM",
    "TMPV",
    "TATASTEEL",
    "TECHM",
    "TITAN",
    "TRENT",
    "ULTRACEMCO",
    "WIPRO",
]

NEXT_50 = [
    "ABB",
    "ADANIENSOL",
    "ADANIGREEN",
    "ADANIPOWER",
    "AMBUJACEM",
    "BAJAJHLDNG",
    "BANKBARODA",
    "BPCL",
    "BRITANNIA",
    "BOSCHLTD",
    "CANBK",
    "CGPOWER",
    "CHOLAFIN",
    "CUMMINSIND",
    "DIVISLAB",
    "DLF",
    "DMART",
    "GAIL",
    "GODREJCP",
    "HDFCAMC",
    "HAL",
    "HINDZINC",
    "HYUNDAI",
    "INDHOTEL",
    "IOC",
    "IRFC",
    "JINDALSTEL",
    "LODHA",
    "LTM",
    "MAZDOCK",
    "MUTHOOTFIN",
    "PIDILITIND",
    "PFC",
    "PNB",
    "RECLTD",
    "MOTHERSON",
    "SHREECEM",
    "SIEMENS",
    "ENRIN",
    "SOLARINDS",
    "TATACAP",
    "TMCV",
    "TATAPOWER",
    "TORNTPHARM",
    "TVSMOTOR",
    "UNIONBANK",
    "UNITDSPR",
    "VBL",
    "VEDL",
    "ZYDUSLIFE",
]


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    nifty500 = re.findall(r"\| ([A-Z0-9][A-Z0-9&-]*) \| EQ \|", text)
    nifty500 = list(dict.fromkeys(nifty500))
    if len(nifty500) < 450:
        raise SystemExit(f"expected ~500 Nifty 500 symbols, got {len(nifty500)}")
    nifty50 = list(NIFTY_50)
    nifty100 = list(dict.fromkeys(NIFTY_50 + NEXT_50))
    nifty100_set = set(nifty100)
    smallcap = [s for s in nifty500 if s not in nifty100_set]
    payload = {
        "asOf": "2026-06-30",
        "source": "NSE index snapshots (Nifty 50 / Next 50 / Nifty 500 Wikipedia tables)",
        "nifty50": nifty50,
        "nifty100": nifty100,
        "nifty500": nifty500,
        "smallcap": smallcap,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {OUT} "
        f"nifty50={len(nifty50)} nifty100={len(nifty100)} "
        f"nifty500={len(nifty500)} smallcap={len(smallcap)}"
    )


if __name__ == "__main__":
    main()
