import type { DecisionReasonCode, RiskVerdict, TradeDecision } from '@stockpred/shared-types';
import { DEFAULT_RISK_LIMITS } from '@stockpred/shared-types';
import { positionSize, riskRewardRatio } from '../risk';

export interface RiskEngineInput {
  decision: TradeDecision;
  capital: number;
  cash: number;
  riskPerTradePercent?: number;
  minRiskReward?: number;
  dayStartEquity?: number;
  weekStartEquity?: number;
  /** 0–100 or 0–1; may only scale quantity down from the risk ceiling. */
  confidence?: number;
  tradingEnabled: boolean;
  killSwitch: boolean;
  maxQuoteAgeMs?: number;
  now?: number;
}

/** Normalize confidence to 0–1. Values > 1 are treated as percent. */
export function confidenceToScale(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence < 0) return 0;
  const raw = confidence > 1 ? confidence / 100 : confidence;
  return Math.min(1, raw);
}

/** Absolute veto + final quantity — independent of AI score excitement. */
export function evaluateRisk(input: RiskEngineInput): RiskVerdict {
  const {
    decision,
    capital,
    cash,
    riskPerTradePercent = DEFAULT_RISK_LIMITS.perTradeRiskPercent,
    minRiskReward = 1.5,
    tradingEnabled,
    killSwitch,
    maxQuoteAgeMs = 60_000,
    now = Date.now(),
  } = input;

  const blockedBy: DecisionReasonCode[] = [];
  const reasons: string[] = [];

  if (!tradingEnabled) {
    blockedBy.push('TRADING_DISABLED');
    reasons.push('AI agent trading is disabled');
  }
  if (killSwitch) {
    blockedBy.push('KILL_SWITCH');
    reasons.push('Kill switch is on');
  }

  const entry = decision.setup.entry;
  const stop = decision.setup.stopLoss;
  const target = decision.setup.target1;

  if (entry == null || entry <= 0) {
    blockedBy.push('MISSING_ENTRY');
    reasons.push('Entry price missing');
  }
  if (stop == null || stop <= 0) {
    blockedBy.push('MISSING_STOP');
    reasons.push('Stop loss missing');
  }

  if (decision.quoteTimestamp != null && now - decision.quoteTimestamp > maxQuoteAgeMs) {
    blockedBy.push('DATA_STALE');
    reasons.push(`Quote age ${now - decision.quoteTimestamp}ms exceeds ${maxQuoteAgeMs}ms`);
  }

  if (now - decision.createdAt > decision.ttlMs) {
    blockedBy.push('DECISION_EXPIRED');
    reasons.push('Decision TTL expired');
  }

  let rr = decision.setup.riskReward ?? 0;
  if (entry != null && stop != null && target != null && entry > 0 && stop > 0) {
    rr = riskRewardRatio(entry, target, stop);
    if (rr < minRiskReward) {
      blockedBy.push('RR_BELOW_MINIMUM');
      reasons.push(`R:R ${rr.toFixed(2)} below minimum ${minRiskReward}`);
    }
  }

  let quantityBeforeConfidence = 0;
  let quantity = 0;
  let riskAmount = 0;
  let confidenceScale = 1;
  const reasonCodes: DecisionReasonCode[] = [];

  if (entry != null && stop != null && entry > 0 && stop > 0 && capital > 0) {
    quantityBeforeConfidence = positionSize(capital, riskPerTradePercent, entry, stop);
    const perShare = Math.abs(entry - stop);
    const maxByCash = Math.floor(cash / entry);
    if (maxByCash < 1) {
      blockedBy.push('INSUFFICIENT_CASH');
      reasons.push(`Cash ₹${cash.toFixed(0)} cannot buy 1 share at ₹${entry}`);
    } else {
      quantityBeforeConfidence = Math.min(quantityBeforeConfidence, maxByCash);
      // Hard notional cap: 5% of cash (legacy ceiling; confidence cannot raise this).
      const maxByShare = Math.floor((cash * 0.05) / entry);
      if (maxByShare >= 1) {
        quantityBeforeConfidence = Math.min(quantityBeforeConfidence, maxByShare);
      }

      const conf = input.confidence != null ? input.confidence : decision.confidence;
      confidenceScale = confidenceToScale(conf);
      quantity = Math.floor(quantityBeforeConfidence * confidenceScale);
      if (confidenceScale < 1 && quantity < quantityBeforeConfidence) {
        reasonCodes.push('CONFIDENCE_SCALED_DOWN');
        reasons.push(
          `Confidence ${conf} → scale ${confidenceScale.toFixed(2)}; qty ${quantityBeforeConfidence} → ${quantity}`,
        );
      }
      riskAmount = quantity * perShare;
    }
    if (quantity < 1 && !blockedBy.includes('INSUFFICIENT_CASH')) {
      blockedBy.push('RISK_PER_TRADE_EXCEEDED');
      reasons.push('Risk sizing produced 0 quantity');
    }
  }

  const dayStart = input.dayStartEquity ?? capital;
  const weekStart = input.weekStartEquity ?? capital;
  if (dayStart > 0 && capital > 0) {
    const dd = ((dayStart - capital) / dayStart) * 100;
    if (dd >= DEFAULT_RISK_LIMITS.dailyDrawdownPercent) {
      blockedBy.push('DAILY_DRAWDOWN_LIMIT');
      reasons.push(`Daily drawdown ${dd.toFixed(2)}% at/above limit`);
    }
  }
  if (weekStart > 0 && capital > 0) {
    const dd = ((weekStart - capital) / weekStart) * 100;
    if (dd >= DEFAULT_RISK_LIMITS.weeklyDrawdownPercent) {
      blockedBy.push('WEEKLY_DRAWDOWN_LIMIT');
      reasons.push(`Weekly drawdown ${dd.toFixed(2)}% at/above limit`);
    }
  }

  if (blockedBy.length > 0) {
    return { allowed: false, reasonCodes: blockedBy, reasons, blockedBy };
  }

  const riskScore = Math.max(0, Math.min(100, 100 - (riskAmount / Math.max(capital, 1)) * 1000));

  return {
    allowed: true,
    riskScore: Math.round(riskScore),
    quantity,
    quantityBeforeConfidence,
    confidenceScale,
    riskAmount,
    stopLoss: stop!,
    maxLoss: riskAmount,
    riskReward: rr,
    reasonCodes,
    reasons: [
      `Sized ${quantity} shares (ceiling ${quantityBeforeConfidence}); risk ₹${riskAmount.toFixed(0)} (${riskPerTradePercent}% rule)`,
      ...reasons.filter((r) => !r.startsWith('Sized')),
    ],
  };
}
