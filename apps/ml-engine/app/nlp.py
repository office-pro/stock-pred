"""Ingest-time financial NLP: lexicon sentiment + event rules, optional FinBERT.

The direction model never sees raw text. This module only scores headlines
into numeric fields stored on NewsMention / daily aggregates.
"""
from __future__ import annotations

import os
import re
from typing import Dict, List, Optional, Tuple

POS_WORDS = {
    "beat",
    "beats",
    "surge",
    "surges",
    "rally",
    "rallies",
    "profit",
    "growth",
    "expand",
    "expansion",
    "win",
    "wins",
    "won",
    "award",
    "contract",
    "order",
    "upgrade",
    "buyback",
    "dividend",
    "record",
    "strong",
    "bullish",
    "outperform",
    "launch",
    "approved",
    "approval",
}
NEG_WORDS = {
    "miss",
    "misses",
    "plunge",
    "slump",
    "loss",
    "losses",
    "fraud",
    "probe",
    "investigation",
    "downgrade",
    "layoff",
    "layoffs",
    "strike",
    "debt",
    "default",
    "ban",
    "penalty",
    "fine",
    "lawsuit",
    "weak",
    "bearish",
    "warning",
    "crash",
    "scam",
    "sebi",
}

EVENT_PATTERNS: List[Tuple[str, re.Pattern, float]] = [
    ("EARNINGS_BEAT", re.compile(r"\b(beats?|beat estimates|above estimate)\b", re.I), 0.85),
    ("EARNINGS_MISS", re.compile(r"\b(misses?|below estimate|short of estimate)\b", re.I), 0.85),
    ("REVENUE_GROWTH", re.compile(r"\b(revenue (up|growth|rose)|sales (up|growth))\b", re.I), 0.7),
    ("PROFIT_GROWTH", re.compile(r"\b(profit (up|growth|rose)|pat (up|growth)|net profit)\b", re.I), 0.7),
    ("NEW_CONTRACT", re.compile(r"\b(contract|order (win|won|bag)|bags? order)\b", re.I), 0.8),
    ("ORDER_WIN", re.compile(r"\b(order win|won (an )?order|secures? order)\b", re.I), 0.8),
    ("PRODUCT_LAUNCH", re.compile(r"\b(launch(es|ed)?|unveils?|introduces?)\b", re.I), 0.65),
    ("CAPEX", re.compile(r"\b(capex|capacity expansion|invests? rs)\b", re.I), 0.7),
    ("ACQUISITION", re.compile(r"\b(acqui(re|res|red|sition)|buys? stake)\b", re.I), 0.75),
    ("MERGER", re.compile(r"\b(merger|amalgamat|scheme of)\b", re.I), 0.75),
    ("DEBT", re.compile(r"\b(debt|bond issue|ncd|downgrade.*debt)\b", re.I), 0.6),
    ("REGULATORY_ACTION", re.compile(r"\b(sebi|rbi|nclt|penalty|banned|show.?cause)\b", re.I), 0.8),
    ("MANAGEMENT_CHANGE", re.compile(r"\b(ceo|cfo|md resign|appoints? (ceo|cfo|md))\b", re.I), 0.65),
    ("FRAUD", re.compile(r"\b(fraud|scam|forensic|diversion of fund)\b", re.I), 0.95),
    ("LEGAL_ISSUE", re.compile(r"\b(lawsuit|litigation|court|cbi|ed raid)\b", re.I), 0.8),
    ("STRIKE", re.compile(r"\b(strike|lockout|protest)\b", re.I), 0.7),
    ("LAYOFF", re.compile(r"\b(layoff|laid off|job cut|retrench)\b", re.I), 0.75),
    ("DIVIDEND", re.compile(r"\b(dividend|interim dividend)\b", re.I), 0.7),
    ("BUYBACK", re.compile(r"\b(buyback|share repurchase)\b", re.I), 0.75),
    ("PROMOTER_SELLING", re.compile(r"\b(promoter (sell|sold|stake sale)|pledged)\b", re.I), 0.8),
    ("PROMOTER_BUYING", re.compile(r"\b(promoter (buy|bought|raises stake))\b", re.I), 0.75),
]

EARNINGS_EVENTS = {
    "EARNINGS_BEAT",
    "EARNINGS_MISS",
    "REVENUE_GROWTH",
    "PROFIT_GROWTH",
    "DIVIDEND",
}

_TOKEN = re.compile(r"[a-z]+")
_finbert = None
_finbert_tried = False


def _tokenize(text: str) -> List[str]:
    return _TOKEN.findall(text.lower())


def lexicon_sentiment(text: str) -> Tuple[float, float, float, float]:
    tokens = _tokenize(text)
    if not tokens:
        return 0.0, 0.0, 0.0, 1.0
    pos = sum(1 for tok in tokens if tok in POS_WORDS)
    neg = sum(1 for tok in tokens if tok in NEG_WORDS)
    total = max(pos + neg, 1)
    pos_p = pos / total if pos or neg else 0.0
    neg_p = neg / total if pos or neg else 0.0
    neu_p = 1.0 - pos_p - neg_p if pos or neg else 1.0
    score = (pos - neg) / max(len(tokens), 1)
    score = max(-1.0, min(1.0, score * 8.0))
    if not pos and not neg:
        return 0.0, 0.0, 0.0, 1.0
    return score, pos_p, neg_p, max(0.0, neu_p)


def classify_event(text: str) -> Tuple[str, float]:
    for name, pattern, strength in EVENT_PATTERNS:
        if pattern.search(text or ""):
            return name, strength
    return "OTHER", 0.2


def _try_finbert(text: str) -> Optional[Tuple[float, float, float, float]]:
    global _finbert, _finbert_tried
    if os.getenv("USE_FINBERT", "").strip() not in {"1", "true", "yes"}:
        return None
    if not _finbert_tried:
        _finbert_tried = True
        try:
            from transformers import pipeline  # type: ignore

            _finbert = pipeline(
                "text-classification",
                model="ProsusAI/finbert",
                truncation=True,
                max_length=64,
            )
        except Exception:
            _finbert = None
    if _finbert is None:
        return None
    try:
        result = _finbert(text[:512])[0]
        label = str(result.get("label", "")).lower()
        conf = float(result.get("score") or 0.0)
        pos = conf if "positive" in label else 0.0
        neg = conf if "negative" in label else 0.0
        neu = conf if "neutral" in label else 0.0
        if "positive" in label:
            score = conf
        elif "negative" in label:
            score = -conf
        else:
            score = 0.0
        return score, pos, neg, neu
    except Exception:
        return None


def score_headline(text: str) -> Dict[str, object]:
    event, strength = classify_event(text)
    score, pos, neg, neu = lexicon_sentiment(text)
    bert = _try_finbert(text)
    if bert is not None:
        score, pos, neg, neu = bert
    return {
        "sentiment": round(float(score), 4),
        "pos": round(float(pos), 4),
        "neg": round(float(neg), 4),
        "neu": round(float(neu), 4),
        "eventType": event,
        "eventStrength": strength,
        "confidence": 0.85 if bert is not None else (0.7 if event != "OTHER" else 0.4),
    }


def is_earnings_event(event_type: str) -> bool:
    return event_type in EARNINGS_EVENTS
