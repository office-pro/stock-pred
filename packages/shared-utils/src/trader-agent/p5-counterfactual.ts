/**
 * P5 counterfactual / WAIT_MARK evaluator — measurement only.
 * Never submits to Gate. Never feeds Risk / Portfolio / Policy.
 */

import type {
  P5CounterfactualProvenance,
  P5PathMetricsStatus,
  P5WaitMarkEndReason,
} from '@stockpred/shared-types';

export const P5_COUNTERFACTUAL_ENGINE_VERSION = 'p5-counterfactual.v1';
export const P5_COUNTERFACTUAL_CALCULATION_VERSION = 'stop-target-or-horizon.v1';
export const P5_ENTRY_CONVENTION = 'decision_snapshot_entry';
export const P5_EXIT_CONVENTION = 'stop_target_or_time_horizon';
export const P5_COST_MODEL_VERSION = 'nse-delivery-fees-slippage.v1';

export interface CounterfactualBar {
  ts: number;
  high: number;
  low: number;
  close: number;
}

export interface EvaluateCounterfactualInput {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number | null;
  plannedRiskAmount: number;
  quantity: number;
  bars: CounterfactualBar[];
  horizonMs?: number;
  decisionTimestamp: number;
  fees?: number;
  slippage?: number;
  sourceDataTimestamp?: number;
  evaluatedAt?: number;
}

export interface CounterfactualEvaluationResult {
  outcomeKind: 'COUNTERFACTUAL';
  exitPrice: number;
  exitReason: string;
  closedAt: number;
  holdingPeriodMs: number;
  pnl: number;
  pnlPercent: number;
  grossPnl: number;
  netPnl: number;
  grossR: number;
  netR: number;
  realizedR: number;
  plannedRiskAmount: number;
  fees: number;
  slippage: number;
  maeR: number | null;
  mfeR: number | null;
  pathMetricsStatus: P5PathMetricsStatus;
  counterfactualProvenance: P5CounterfactualProvenance;
}

/**
 * Simulate what would have happened if the trade had been taken.
 * Returns null when inputs are insufficient — never invents a path.
 */
export function evaluateCounterfactual(
  input: EvaluateCounterfactualInput,
): CounterfactualEvaluationResult | null {
  const entry = input.entryPrice;
  const stop = input.stopPrice;
  const qty = input.quantity;
  const risk = input.plannedRiskAmount;
  if (!(entry > 0) || !(stop > 0) || !(qty > 0) || !(risk > 0)) return null;
  if (!Array.isArray(input.bars) || input.bars.length === 0) return null;

  const horizonEnd =
    input.horizonMs != null && input.horizonMs > 0
      ? input.decisionTimestamp + input.horizonMs
      : input.bars[input.bars.length - 1]!.ts;

  const bars = input.bars.filter((b) => b.ts >= input.decisionTimestamp && b.ts <= horizonEnd);
  if (bars.length === 0) return null;

  const long = input.direction === 'BUY';
  const riskPerShare = Math.abs(entry - stop);
  if (!(riskPerShare > 0)) return null;

  let exitPrice = bars[bars.length - 1]!.close;
  let exitReason = 'HORIZON';
  let closedAt = bars[bars.length - 1]!.ts;
  let extremeAdverse = 0;
  let extremeFavorable = 0;

  for (const bar of bars) {
    if (long) {
      extremeAdverse = Math.max(extremeAdverse, entry - bar.low);
      extremeFavorable = Math.max(extremeFavorable, bar.high - entry);
      if (bar.low <= stop) {
        exitPrice = stop;
        exitReason = 'STOP';
        closedAt = bar.ts;
        break;
      }
      if (input.targetPrice != null && input.targetPrice > 0 && bar.high >= input.targetPrice) {
        exitPrice = input.targetPrice;
        exitReason = 'TARGET';
        closedAt = bar.ts;
        break;
      }
    } else {
      extremeAdverse = Math.max(extremeAdverse, bar.high - entry);
      extremeFavorable = Math.max(extremeFavorable, entry - bar.low);
      if (bar.high >= stop) {
        exitPrice = stop;
        exitReason = 'STOP';
        closedAt = bar.ts;
        break;
      }
      if (input.targetPrice != null && input.targetPrice > 0 && bar.low <= input.targetPrice) {
        exitPrice = input.targetPrice;
        exitReason = 'TARGET';
        closedAt = bar.ts;
        break;
      }
    }
  }

  const grossPnl = long ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;
  const fees = input.fees ?? 0;
  const slippage = input.slippage ?? 0;
  const netPnl = grossPnl - fees - slippage;
  const grossR = grossPnl / risk;
  const netR = netPnl / risk;
  const evaluatedAt = input.evaluatedAt ?? Date.now();

  return {
    outcomeKind: 'COUNTERFACTUAL',
    exitPrice,
    exitReason: `COUNTERFACTUAL_${exitReason}`,
    closedAt,
    holdingPeriodMs: Math.max(0, closedAt - input.decisionTimestamp),
    pnl: netPnl,
    pnlPercent: entry > 0 && qty > 0 ? (netPnl / (entry * qty)) * 100 : 0,
    grossPnl,
    netPnl,
    grossR,
    netR,
    realizedR: netR,
    plannedRiskAmount: risk,
    fees,
    slippage,
    maeR: extremeAdverse / riskPerShare,
    mfeR: extremeFavorable / riskPerShare,
    pathMetricsStatus: 'AVAILABLE',
    counterfactualProvenance: {
      evaluatedAt,
      evaluationEngineVersion: P5_COUNTERFACTUAL_ENGINE_VERSION,
      calculationVersion: P5_COUNTERFACTUAL_CALCULATION_VERSION,
      entryConvention: P5_ENTRY_CONVENTION,
      exitConvention: P5_EXIT_CONVENTION,
      costModelVersion: P5_COST_MODEL_VERSION,
      sourceDataTimestamp: input.sourceDataTimestamp ?? bars[bars.length - 1]!.ts,
    },
  };
}

export interface WaitMarkInput {
  markPrice: number;
  entryPrice: number;
  direction: 'BUY' | 'SELL';
  plannedRiskAmount: number;
  quantity: number;
  decisionTimestamp: number;
  markedAt: number;
  endReason?: P5WaitMarkEndReason;
  fees?: number;
  slippage?: number;
}

export interface WaitMarkResult {
  outcomeKind: 'WAIT_MARK';
  exitPrice: number;
  exitReason: string;
  closedAt: number;
  holdingPeriodMs: number;
  pnl: number;
  pnlPercent: number;
  grossR: number;
  netR: number;
  realizedR: number;
  plannedRiskAmount: number;
  fees: number;
  slippage: number;
  maeR: null;
  mfeR: null;
  pathMetricsStatus: 'UNAVAILABLE';
  waitMarkEndReason?: P5WaitMarkEndReason;
}

/** Mark-to-market at wait end. MAE/MFE stays UNAVAILABLE (single mark). */
export function evaluateWaitMark(input: WaitMarkInput): WaitMarkResult | null {
  const entry = input.entryPrice;
  const mark = input.markPrice;
  const qty = input.quantity;
  const risk = input.plannedRiskAmount;
  if (!(entry > 0) || !(mark > 0) || !(qty > 0) || !(risk > 0)) return null;

  const long = input.direction === 'BUY';
  const grossPnl = long ? (mark - entry) * qty : (entry - mark) * qty;
  const fees = input.fees ?? 0;
  const slippage = input.slippage ?? 0;
  const netPnl = grossPnl - fees - slippage;
  const netR = netPnl / risk;
  const reasonSuffix = input.endReason ? `_${input.endReason}` : '';

  return {
    outcomeKind: 'WAIT_MARK',
    exitPrice: mark,
    exitReason: `WAIT_MARK${reasonSuffix}`,
    closedAt: input.markedAt,
    holdingPeriodMs: Math.max(0, input.markedAt - input.decisionTimestamp),
    pnl: netPnl,
    pnlPercent: (netPnl / (entry * qty)) * 100,
    grossR: grossPnl / risk,
    netR,
    realizedR: netR,
    plannedRiskAmount: risk,
    fees,
    slippage,
    maeR: null,
    mfeR: null,
    pathMetricsStatus: 'UNAVAILABLE',
    waitMarkEndReason: input.endReason,
  };
}

/** Path MAE/MFE for ACTUAL fills. Nulls + UNAVAILABLE when path missing. */
export function computeActualPathMetrics(input: {
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopPrice: number;
  bars: CounterfactualBar[] | null | undefined;
}): {
  maeR: number | null;
  mfeR: number | null;
  pathMetricsStatus: P5PathMetricsStatus;
} {
  const entry = input.entryPrice;
  const stop = input.stopPrice;
  const riskPerShare = Math.abs(entry - stop);
  if (!(entry > 0) || !(riskPerShare > 0) || !input.bars || input.bars.length === 0) {
    return { maeR: null, mfeR: null, pathMetricsStatus: 'UNAVAILABLE' };
  }
  const long = input.direction === 'BUY';
  let extremeAdverse = 0;
  let extremeFavorable = 0;
  for (const bar of input.bars) {
    if (long) {
      extremeAdverse = Math.max(extremeAdverse, entry - bar.low);
      extremeFavorable = Math.max(extremeFavorable, bar.high - entry);
    } else {
      extremeAdverse = Math.max(extremeAdverse, bar.high - entry);
      extremeFavorable = Math.max(extremeFavorable, entry - bar.low);
    }
  }
  return {
    maeR: extremeAdverse / riskPerShare,
    mfeR: extremeFavorable / riskPerShare,
    pathMetricsStatus: 'AVAILABLE',
  };
}
