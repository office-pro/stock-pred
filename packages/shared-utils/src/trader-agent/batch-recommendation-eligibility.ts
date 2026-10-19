/**
 * Slice B — recommendation eligibility from batch-snapshot evidence.
 * Advisory only. Does not authorize, rescale, or veto the
 * evaluateTrade → Risk → Portfolio → Policy → Gate chain.
 * RankingContext remains observe-only.
 */

import type {
  AssetClass,
  BatchInstrumentData,
  BatchResultRecommendation,
} from '@stockpred/shared-types';
import { dataRequirementPlan } from './batch-data-requirements';

/** RankingContext may order rows; it cannot authorize or invent evidence. */
export const RANKING_CONTEXT_IS_ADVISORY = true;

export type SnapshotEvidenceAvailability =
  | 'AVAILABLE'
  | 'PARTIAL'
  | 'UNAVAILABLE'
  | 'UNKNOWN'
  | 'N/A';

export interface RecommendationEvidenceContract {
  /** When true, news UNAVAILABLE/UNKNOWN blocks an actionable recommendation. */
  requireNews?: boolean;
}

export interface RecommendationEligibility {
  recommendationEligible: boolean;
  bestOpportunityEligible: boolean;
  reasonCode?: string;
  blockingCapabilities: string[];
}

export interface AppliedRecommendationEligibility {
  recommendation: BatchResultRecommendation;
  reasonCode: string;
  reason: string;
  bestOpportunityEligible: boolean;
  recommendationEligibilityReason?: string;
}

const ACTIONABLE: ReadonlySet<string> = new Set(['APPROVE']);

function finiteNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function assetClassOf(
  instrument?: BatchInstrumentData,
  fallback?: AssetClass,
): AssetClass | undefined {
  return instrument?.instrumentRef.assetClass ?? fallback;
}

function fundamentalsApplicable(assetClass?: AssetClass): boolean {
  return assetClass != null && assetClass !== 'FX';
}

/**
 * Snapshot-owned availability. Missing payload stays UNAVAILABLE/UNKNOWN —
 * never coerced to 0 / NEUTRAL / LOW / BUY / STRONG.
 * A legitimate numeric zero (e.g. sentiment.score = 0) is AVAILABLE data.
 */
export function snapshotEvidenceAvailability(
  capability: string,
  instrument?: BatchInstrumentData,
): SnapshotEvidenceAvailability {
  if (!instrument) return 'UNKNOWN';
  const assetClass = instrument.instrumentRef.assetClass;
  if (capability === 'fundamentals' && !fundamentalsApplicable(assetClass)) return 'N/A';
  if (capability === 'marketData') {
    const price = finiteNum(instrument.quote?.price);
    if (price != null && price > 0) return 'AVAILABLE';
    if (instrument.dataStatus === 'PARTIAL') return 'PARTIAL';
    if (instrument.quote) return 'UNAVAILABLE';
    return instrument.dataStatus === 'PENDING' ? 'UNKNOWN' : 'UNAVAILABLE';
  }
  if (capability === 'historicalCandles') {
    const n = instrument.candles?.length ?? 0;
    if (n >= 20) return 'AVAILABLE';
    if (n > 0) return 'PARTIAL';
    return 'UNAVAILABLE';
  }
  if (capability === 'fundamentals') {
    if (!instrument.fundamentals) return 'UNAVAILABLE';
    if (instrument.fundamentals.kind === 'UNAVAILABLE') return 'UNAVAILABLE';
    return 'AVAILABLE';
  }
  if (capability === 'news') {
    const count = instrument.news?.headlineCount;
    if (count == null) return 'UNAVAILABLE';
    return count > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
  }
  if (capability === 'sentiment') {
    const score = finiteNum(instrument.sentiment?.score);
    if (score != null) return 'AVAILABLE';
    return 'UNAVAILABLE';
  }
  return 'UNKNOWN';
}

export function evaluateBatchRecommendationEligibility(input: {
  instrument?: BatchInstrumentData;
  assetClass?: AssetClass;
  dataCompleteness?: string | null;
  contract?: RecommendationEvidenceContract;
}): RecommendationEligibility {
  const blocking: string[] = [];
  const assetClass = assetClassOf(input.instrument, input.assetClass);
  const completeness = String(input.dataCompleteness ?? '')
    .trim()
    .toUpperCase();

  if (completeness === 'DATA_INCOMPLETE' || completeness === 'UNKNOWN') {
    return {
      recommendationEligible: false,
      bestOpportunityEligible: false,
      reasonCode: completeness === 'UNKNOWN' ? 'EVIDENCE_UNKNOWN' : 'DATA_INCOMPLETE',
      blockingCapabilities: ['dataCompleteness'],
    };
  }

  if (!input.instrument) {
    return {
      recommendationEligible: true,
      bestOpportunityEligible: true,
      blockingCapabilities: [],
    };
  }

  const plan = assetClass ? dataRequirementPlan(assetClass) : [];
  const requireNews =
    input.contract?.requireNews === true ||
    plan.some((row) => row.capability === 'news' && row.required);

  for (const req of plan.filter((row) => row.required)) {
    const state = snapshotEvidenceAvailability(req.capability, input.instrument);
    if (state === 'UNAVAILABLE' || state === 'UNKNOWN') {
      blocking.push(req.capability);
    }
  }

  if (requireNews) {
    const news = snapshotEvidenceAvailability('news', input.instrument);
    if (news === 'UNAVAILABLE' || news === 'UNKNOWN') {
      if (!blocking.includes('news')) blocking.push('news');
    }
  }

  if (blocking.length > 0) {
    return {
      recommendationEligible: false,
      bestOpportunityEligible: false,
      reasonCode: 'REQUIRED_EVIDENCE_UNAVAILABLE',
      blockingCapabilities: blocking,
    };
  }

  const insufficient: string[] = [];
  for (const req of plan.filter((row) => row.required)) {
    if (snapshotEvidenceAvailability(req.capability, input.instrument) === 'PARTIAL') {
      insufficient.push(req.capability);
    }
  }
  if (fundamentalsApplicable(assetClass)) {
    const fund = snapshotEvidenceAvailability('fundamentals', input.instrument);
    if (fund === 'UNAVAILABLE' || fund === 'UNKNOWN' || fund === 'PARTIAL') {
      insufficient.push('fundamentals');
    }
  }

  if (insufficient.length > 0) {
    return {
      recommendationEligible: true,
      bestOpportunityEligible: false,
      reasonCode: 'BEST_OPPORTUNITY_EVIDENCE_INSUFFICIENT',
      blockingCapabilities: insufficient,
    };
  }

  return {
    recommendationEligible: true,
    bestOpportunityEligible: true,
    blockingCapabilities: [],
  };
}

function asRecommendation(value?: string | null): BatchResultRecommendation {
  const upper = String(value ?? '')
    .trim()
    .toUpperCase();
  if (
    upper === 'APPROVE' ||
    upper === 'WAIT' ||
    upper === 'WATCH' ||
    upper === 'NO_TRADE' ||
    upper === 'REJECT'
  ) {
    return upper;
  }
  return 'WAIT';
}

/**
 * Demote an actionable recommendation when snapshot evidence is unusable.
 * Never maps APPROVE → BUY or REJECT → AVOID.
 */
export function applyRecommendationEligibility(input: {
  recommendation?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  eligibility: RecommendationEligibility;
}): AppliedRecommendationEligibility {
  const recommendation = asRecommendation(input.recommendation);
  const eligibilityReason = input.eligibility.reasonCode;
  if (ACTIONABLE.has(recommendation) && !input.eligibility.recommendationEligible) {
    return {
      recommendation: 'WATCH',
      reasonCode: eligibilityReason ?? 'REQUIRED_EVIDENCE_UNAVAILABLE',
      reason:
        input.reason?.trim() ||
        'Required snapshot evidence is unavailable or incomplete; recommendation is not actionable',
      bestOpportunityEligible: false,
      recommendationEligibilityReason: eligibilityReason,
    };
  }
  if (ACTIONABLE.has(recommendation)) {
    return {
      recommendation,
      reasonCode: input.reasonCode?.trim() || 'TRADE_PLAN_APPROVE',
      reason: input.reason?.trim() || 'ProfessionalTrader approved the setup',
      bestOpportunityEligible: input.eligibility.bestOpportunityEligible,
      recommendationEligibilityReason: input.eligibility.bestOpportunityEligible
        ? undefined
        : eligibilityReason,
    };
  }
  return {
    recommendation,
    reasonCode: input.reasonCode?.trim() || 'WATCH_SETUP',
    reason: input.reason?.trim() || 'Watch the setup',
    bestOpportunityEligible: false,
    recommendationEligibilityReason: eligibilityReason,
  };
}
