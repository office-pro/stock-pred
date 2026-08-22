import type { PortfolioFitLabel, RankedOpportunityDisplay } from '@stockpred/shared-types';

export interface RankOpportunityInput {
  opportunityId: string;
  symbol: string;
  /** Trade quality overallScore (0–100 preferred). */
  quality: number;
  /** Expected value in R. */
  expectedValueR: number;
  /** Signal / analysis overall score. */
  signalScore: number;
  /** Current suggested qty — echoed unchanged; ranking must not resize. */
  quantity: number;
  /** Portfolio fit from existing portfolio engine (display only). */
  portfolioFit: PortfolioFitLabel;
}

/**
 * Locked P5 display formula:
 *   rankScore = 0.40×quality + 0.35×normalizedEV + 0.25×normalizedScore
 *
 * Scores are normalized within the batch. referenceAllocationPct is display-only
 * and must not mutate order size, risk budget, or cash.
 */
export function rankOpportunitiesForDisplay(
  rows: RankOpportunityInput[],
): RankedOpportunityDisplay[] {
  if (rows.length === 0) return [];

  const qualities = rows.map((r) => clamp(r.quality, 0, 100));
  const evs = rows.map((r) => r.expectedValueR);
  const scores = rows.map((r) => clamp(r.signalScore, 0, 100));

  const normQuality = normalize01(qualities);
  const normEv = normalizeSigned(evs);
  const normScore = normalize01(scores);

  const scored = rows.map((row, i) => {
    const rankScore =
      0.4 * normQuality[i]! * 100 + 0.35 * normEv[i]! * 100 + 0.25 * normScore[i]! * 100;
    return {
      opportunityId: row.opportunityId,
      symbol: row.symbol,
      rankScore,
      quality: row.quality,
      expectedValueR: row.expectedValueR,
      signalScore: row.signalScore,
      portfolioFit: row.portfolioFit,
      quantityUnchanged: row.quantity,
    };
  });

  scored.sort((a, b) => b.rankScore - a.rankScore || a.symbol.localeCompare(b.symbol));

  const weights = scored.map((r) => Math.max(r.rankScore, 0.01));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  let allocated = 0;
  const out: RankedOpportunityDisplay[] = scored.map((row, i) => {
    const isLast = i === scored.length - 1;
    const pct = isLast
      ? Math.round((100 - allocated) * 100) / 100
      : Math.round((weights[i]! / weightSum) * 10000) / 100;
    if (!isLast) allocated += pct;
    return {
      ...row,
      rank: i + 1,
      referenceAllocationPct: pct,
    };
  });

  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function normalize01(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

function normalizeSigned(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}
