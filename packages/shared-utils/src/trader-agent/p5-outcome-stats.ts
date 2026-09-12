/**
 * P5 cost-adjusted outcome distributions — measurement only.
 * Never authorizes. Never mixes ACTUAL with COUNTERFACTUAL.
 */

import type { P5OutcomeDistribution } from '@stockpred/shared-types';

export interface P5OutcomeSample {
  netR?: number | null;
  realizedR?: number | null;
  grossR?: number | null;
  fees?: number | null;
  slippage?: number | null;
}

function resolveNetR(s: P5OutcomeSample): number | null {
  if (s.netR != null && Number.isFinite(s.netR)) return s.netR;
  if (s.realizedR != null && Number.isFinite(s.realizedR)) return s.realizedR;
  if (s.grossR != null && Number.isFinite(s.grossR)) return s.grossR;
  return null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

/** Build a distribution from samples. Empty → nulls, never fabricated. */
export function computeOutcomeDistribution(samples: P5OutcomeSample[]): P5OutcomeDistribution {
  const values = samples
    .map(resolveNetR)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) {
    return {
      sampleCount: 0,
      expectancyNetR: null,
      medianNetR: null,
      winRate: null,
      lossRate: null,
      p25NetR: null,
      p75NetR: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const wins = values.filter((v) => v > 0).length;
  const losses = values.filter((v) => v < 0).length;
  return {
    sampleCount: values.length,
    expectancyNetR: sum / values.length,
    medianNetR: percentile(sorted, 0.5),
    winRate: wins / values.length,
    lossRate: losses / values.length,
    p25NetR: percentile(sorted, 0.25),
    p75NetR: percentile(sorted, 0.75),
  };
}

/**
 * Derive net R from gross R and absolute cost components when planned risk is known.
 * Returns null when inputs are insufficient — never invents.
 */
export function netRFromGross(
  grossR: number | null | undefined,
  plannedRiskAmount: number | null | undefined,
  fees: number | null | undefined,
  slippage: number | null | undefined,
): number | null {
  if (grossR == null || !Number.isFinite(grossR)) return null;
  if (plannedRiskAmount == null || !(plannedRiskAmount > 0)) return grossR;
  const cost = (fees ?? 0) + (slippage ?? 0);
  return grossR - cost / plannedRiskAmount;
}
