"""NSE cash delivery (CNC) friction for swing backtests.

Conservative discount-broker schedule (not a broker quote). Stamp and STT
dominate overnight holds; brokerage is kept non-zero so cheap brokers are
not assumed. Slippage is applied on fill price, not as a fee line.
"""
from __future__ import annotations

BROKERAGE_RATE = 0.0003  # 3 bps each side
STT_BUY = 0.001  # 0.10%
STT_SELL = 0.001  # 0.10%
EXCHANGE_RATE = 0.00000297  # ~0.00297% NSE
SEBI_RATE = 0.0000001  # ₹10 / crore
STAMP_BUY = 0.00015  # 0.015% on buy
GST_RATE = 0.18  # on brokerage + exchange + SEBI
SLIPPAGE_RATE = 0.0005  # 5 bps each side


def apply_slippage(price: float, side: str) -> float:
    if price <= 0:
        return price
    if side.upper() == "BUY":
        return price * (1.0 + SLIPPAGE_RATE)
    return price * (1.0 - SLIPPAGE_RATE)


def nse_delivery_fee(notional: float, side: str) -> float:
    """Statutory + brokerage cash cost for one side. Notional is |qty * price|."""
    if notional <= 0:
        return 0.0
    brokerage = notional * BROKERAGE_RATE
    exchange = notional * EXCHANGE_RATE
    sebi = notional * SEBI_RATE
    gst = GST_RATE * (brokerage + exchange + sebi)
    stamp = notional * STAMP_BUY if side.upper() == "BUY" else 0.0
    stt = notional * (STT_BUY if side.upper() == "BUY" else STT_SELL)
    return brokerage + exchange + sebi + gst + stamp + stt


def round_trip_cost(buy_notional: float, sell_notional: float) -> float:
    return nse_delivery_fee(buy_notional, "BUY") + nse_delivery_fee(sell_notional, "SELL")
