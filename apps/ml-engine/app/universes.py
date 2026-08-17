"""Named index baskets for faster train / predict / unusual-activity jobs.

CLI:  --universe nifty50|nifty100|nifty500|smallcap|all
UI:   ML Lab universe picker (same ids).

`all` is every listed name. The other ids are NSE index snapshots intersected
with whatever the market-data service currently lists. Smallcap here is
Nifty 500 excluding Nifty 100 (mid + small names) — not a legal classification.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Dict, Iterable, List, Sequence, Tuple

UNIVERSE_IDS = ("nifty50", "nifty100", "nifty500", "smallcap", "all")

UNIVERSE_META: Dict[str, Dict[str, str]] = {
    "nifty50": {
        "label": "Nifty 50",
        "blurb": "~50 large-cap names. Fastest run.",
    },
    "nifty100": {
        "label": "Nifty 100",
        "blurb": "Nifty 50 + Next 50. Still quick.",
    },
    "nifty500": {
        "label": "Nifty 500",
        "blurb": "Broad NSE large/mid/small snapshot (~500).",
    },
    "smallcap": {
        "label": "Smallcap",
        "blurb": "Nifty 500 excluding Nifty 100 (~400 mid/small names).",
    },
    "all": {
        "label": "All listed",
        "blurb": "Every listed NSE/BSE name. Slowest.",
    },
}

# Ticker changes / dual listings so a basket symbol still matches our book.
_ALIAS_GROUPS: Tuple[Tuple[str, ...], ...] = (
    ("TMPV", "TATAMOTORS", "TMCV"),
    ("ETERNAL", "ZOMATO"),
    ("LTM", "LTIM", "LTI"),
    ("UNITDSPR", "MCDOWELL-N"),
    ("MOTHERSON", "MOTHERSUMI"),
    ("ESCORTS", "ESCORT"),
    ("FORTIS", "FORTISHEALTH"),
    ("IOC", "IOCL"),
    ("CANBK", "CANBANK"),
    ("INDUSINDBK", "INDUSIND"),
    ("AUROPHARMA", "AUROBINDO"),
    ("LUPIN", "LUPIINDIA"),
    ("DIVISLAB", "DIVI"),
    ("CHOLAFIN", "CCINDIA"),
    ("GMRAIRPORT", "GMRINFRA"),
)


def _alias_lookup() -> Dict[str, Tuple[str, ...]]:
    out: Dict[str, Tuple[str, ...]] = {}
    for group in _ALIAS_GROUPS:
        for symbol in group:
            out[symbol] = group
    return out


ALIASES = _alias_lookup()


def normalize_universe(value: str | None) -> str:
    name = (value or "all").strip().lower().replace("-", "").replace("_", "")
    aliases = {
        "nifty50": "nifty50",
        "n50": "nifty50",
        "nifty100": "nifty100",
        "n100": "nifty100",
        "nifty500": "nifty500",
        "n500": "nifty500",
        "smallcap": "smallcap",
        "small": "smallcap",
        "niftysmallcap": "smallcap",
        "niftysmallcap100": "smallcap",
        "niftysmallcap250": "smallcap",
        "all": "all",
        "full": "all",
        "listed": "all",
    }
    if name not in aliases:
        raise ValueError(f"Unknown universe '{value}'. Use one of: {', '.join(UNIVERSE_IDS)}")
    return aliases[name]


def add_universe_arg(parser) -> None:
    parser.add_argument(
        "--universe",
        default="all",
        help="Index basket: nifty50, nifty100, nifty500, smallcap, or all (default all)",
    )


@lru_cache(maxsize=1)
def _baskets() -> Dict[str, List[str]]:
    path = os.path.join(os.path.dirname(__file__), "data", "index_universes.json")
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    return {
        "nifty50": list(payload["nifty50"]),
        "nifty100": list(payload["nifty100"]),
        "nifty500": list(payload["nifty500"]),
        "smallcap": list(payload["smallcap"]),
    }


def constituents(universe: str) -> Sequence[str]:
    name = normalize_universe(universe)
    if name == "all":
        return ()
    return _baskets()[name]


def _wanted(universe: str) -> set:
    wanted: set = set()
    for symbol in constituents(universe):
        wanted.update(ALIASES.get(symbol, (symbol,)))
        wanted.add(symbol)
    return wanted


def basket_symbols(universe: str) -> List[str]:
    """Index constituents only — does not scan the full listed book."""
    name = normalize_universe(universe)
    if name == "all":
        return []
    return list(dict.fromkeys(symbol.upper() for symbol in constituents(name)))


def filter_listed(listed: Iterable[str], universe: str) -> List[str]:
    """Keep listed symbols that belong to the named basket. `all` is a no-op."""
    name = normalize_universe(universe)
    names = [str(symbol).strip().upper() for symbol in listed if str(symbol).strip()]
    if name == "all":
        return list(dict.fromkeys(names))
    wanted = _wanted(name)
    matched = [symbol for symbol in dict.fromkeys(names) if symbol in wanted]
    if matched:
        return matched
    return list(dict.fromkeys(symbol.upper() for symbol in constituents(name)))


def describe_filter(listed_count: int, kept: Sequence[str], universe: str) -> str:
    name = normalize_universe(universe)
    if name == "all":
        return f"[universe] all: {len(kept)} listed symbols"
    total = len(constituents(name))
    return (
        f"[universe] {name}: {len(kept)} listed "
        f"(of {total} constituents; book={listed_count})"
    )


def catalog() -> List[Dict[str, str]]:
    return [
        {"id": uid, "label": meta["label"], "blurb": meta["blurb"]}
        for uid, meta in UNIVERSE_META.items()
    ]
