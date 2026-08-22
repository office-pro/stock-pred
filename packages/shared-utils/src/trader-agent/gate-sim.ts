import type { DecisionReasonCode, LiveCapsConfig, TradeDecision } from '@stockpred/shared-types';
import type { SimulatedBook } from './simulated-book';
import { checkLiveCaps, type LiveCapsCheckInput } from './live-caps';

export const DEFAULT_DUPLICATE_ORDER_WINDOW_MS = 60_000;

export interface GateSimInput {
  decision: TradeDecision;
  /** Live / next-bar open used for PRICE_DEVIATION (same as approve gate live quote). */
  livePrice: number | null;
  maxPriceDeviationPct: number;
  book: SimulatedBook;
  now: number;
  maxQuoteAgeMs?: number;
  duplicateOrderWindowMs?: number;
  tradingEnabled?: boolean;
  killSwitch?: boolean;
  /**
   * Phase 5 LIVE caps — revalidated at Gate (final safety).
   * When mode is LIVE and caps provided, stale portfolio after approve-time
   * check can BLOCK here even if an earlier service check passed.
   */
  liveCaps?: LiveCapsCheckInput;
}

export interface GateSimResult {
  passed: boolean;
  reasonCodes: DecisionReasonCode[];
  reasons: string[];
}

/**
 * Mirrors live approve revalidation gates
 * (TTL, freshness, PRICE_DEVIATION, DUPLICATE_ORDER, LIVE caps).
 * Does not invent new trading intelligence.
 */
export function simulateRevalidatingGate(input: GateSimInput): GateSimResult {
  const {
    decision,
    livePrice,
    maxPriceDeviationPct,
    book,
    now,
    maxQuoteAgeMs = 60_000,
    duplicateOrderWindowMs = DEFAULT_DUPLICATE_ORDER_WINDOW_MS,
    tradingEnabled = true,
    killSwitch = false,
    liveCaps,
  } = input;

  const reasonCodes: DecisionReasonCode[] = [];
  const reasons: string[] = [];

  if (!tradingEnabled) {
    reasonCodes.push('TRADING_DISABLED');
    reasons.push('AI agent trading is disabled');
  }
  if (killSwitch) {
    reasonCodes.push('KILL_SWITCH');
    reasons.push('Kill switch is on');
  }

  if (now - decision.createdAt > decision.ttlMs) {
    reasonCodes.push('DECISION_EXPIRED');
    reasons.push('Decision TTL expired at gate');
  }

  if (decision.quoteTimestamp != null && now - decision.quoteTimestamp > maxQuoteAgeMs) {
    reasonCodes.push('DATA_STALE');
    reasons.push(`Quote age ${now - decision.quoteTimestamp}ms exceeds ${maxQuoteAgeMs}ms at gate`);
  }

  const entryPrice = decision.setup.entry ?? 0;
  if (entryPrice > 0 && livePrice != null && livePrice > 0) {
    const deviationPct = (Math.abs(livePrice - entryPrice) / entryPrice) * 100;
    if (deviationPct > maxPriceDeviationPct) {
      reasonCodes.push('PRICE_DEVIATION');
      reasons.push(
        `Live ₹${livePrice} vs entry ₹${entryPrice} deviation ${deviationPct.toFixed(2)}% exceeds max ${maxPriceDeviationPct}%`,
      );
    }
  }

  const lastSubmit = book.lastSubmit(decision.symbol);
  if (lastSubmit != null && now - lastSubmit < duplicateOrderWindowMs) {
    reasonCodes.push('DUPLICATE_ORDER');
    reasons.push(`Recent submit for ${decision.symbol} within ${duplicateOrderWindowMs / 1000}s`);
  }

  if (liveCaps) {
    const capsResult = checkLiveCaps(liveCaps);
    reasonCodes.push(...capsResult.reasonCodes);
    reasons.push(...capsResult.reasons);
  }

  return {
    passed: reasonCodes.length === 0,
    reasonCodes,
    reasons,
  };
}

/** Helper for tests / callers assembling LIVE gate cap input. */
export function liveCapsGateInput(
  caps: LiveCapsConfig,
  tradeNotional: number,
  openNotional: number,
  openPositions: number,
): LiveCapsCheckInput {
  return {
    mode: 'LIVE',
    caps,
    tradeNotional,
    openNotional,
    openPositions,
  };
}
