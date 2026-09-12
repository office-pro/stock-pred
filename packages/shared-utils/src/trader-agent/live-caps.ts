import type {
  DecisionReasonCode,
  LiveCapsCheckInput,
  LiveCapsCheckResult,
  LiveCapsConfig,
} from '@stockpred/shared-types';
import { DEFAULT_LIVE_CAPS } from '@stockpred/shared-types';

export { DEFAULT_LIVE_CAPS };
export type { LiveCapsConfig, LiveCapsCheckInput, LiveCapsCheckResult };

/**
 * LIVE notional / position caps.
 * PAPER and RESEARCH always pass (caps are LIVE-only).
 * Used on the approve early path and again at the revalidating Gate.
 */
export function checkLiveCaps(input: LiveCapsCheckInput): LiveCapsCheckResult {
  if (input.mode !== 'LIVE') {
    return { passed: true, reasonCodes: [], reasons: [] };
  }

  const { caps, tradeNotional, openNotional, openPositions } = input;
  const reasonCodes: DecisionReasonCode[] = [];
  const reasons: string[] = [];

  if (tradeNotional > caps.maxNotionalPerTrade) {
    reasonCodes.push('LIVE_MAX_NOTIONAL_PER_TRADE');
    reasons.push(
      `Trade notional ₹${Math.round(tradeNotional)} exceeds LIVE per-trade cap ₹${caps.maxNotionalPerTrade}`,
    );
  }

  if (openNotional + tradeNotional > caps.maxOpenNotional) {
    reasonCodes.push('LIVE_MAX_OPEN_NOTIONAL');
    reasons.push(
      `Open notional ₹${Math.round(openNotional)} + trade ₹${Math.round(tradeNotional)} exceeds LIVE open-notional cap ₹${caps.maxOpenNotional}`,
    );
  }

  if (openPositions + 1 > caps.maxOpenPositions) {
    reasonCodes.push('LIVE_MAX_OPEN_POSITIONS');
    reasons.push(
      `Open positions ${openPositions} + 1 exceeds LIVE open-positions cap ${caps.maxOpenPositions}`,
    );
  }

  return {
    passed: reasonCodes.length === 0,
    reasonCodes,
    reasons,
  };
}

/** Gross open notional from portfolio holdings (mark × qty). */
export function computeOpenNotional(
  holdings: Array<{
    quantity: number;
    currentPrice?: number;
    entryPrice?: number;
    avgPrice?: number;
  }>,
): number {
  let total = 0;
  for (const h of holdings) {
    const px = h.currentPrice ?? h.entryPrice ?? h.avgPrice ?? 0;
    const qty = h.quantity ?? 0;
    if (px > 0 && qty > 0) total += px * qty;
  }
  return total;
}
