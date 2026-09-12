/**
 * P5 Minimal Measurement Hardening — observe-only evidence types.
 * Never authorize trades. Never feed Risk / Portfolio / Policy / Gate.
 */

import type { TiTradeHorizon } from './trade-intelligence';

/** ACTUAL vs COUNTERFACTUAL must never be mixed in the same metric. */
export type P5OutcomeKind = 'ACTUAL' | 'COUNTERFACTUAL' | 'WAIT_MARK';

/** Path extremes: never invent when bar path is missing. */
export type P5PathMetricsStatus = 'AVAILABLE' | 'UNAVAILABLE';

/**
 * Why a WAIT_MARK ended — only persist when the wait model already distinguishes.
 * Do not invent new wait behavior solely to populate this.
 */
export type P5WaitMarkEndReason =
  | 'WAIT_EXPIRED'
  | 'NEW_DECISION'
  | 'OPPORTUNITY_EXPIRED'
  | 'SESSION_END'
  | 'MANUAL_REVIEW';

/** Peer row frozen inside a decision-time ranking cohort. */
export interface P5RankingPeerStamp {
  symbol: string;
  opportunityId?: string;
  rank: number;
  dominance?: string;
}

/**
 * Immutable ranking cohort stamped at human decision time.
 * Never reconstruct by re-running today's ranking engine.
 */
export interface P5DecisionRankingContext {
  rankingContextId: string;
  rankingEngineVersion: string;
  calculationVersion: string;
  tradeHorizon: TiTradeHorizon | string;
  strategyTag?: string;
  timestamp: string;
  /** This opportunity's rank within the frozen universe. */
  rank: number;
  candidateUniverse: string[];
  peerRanks: P5RankingPeerStamp[];
}

/**
 * Provenance required on every COUNTERFACTUAL row so cost/exit model changes
 * cannot silently make old evidence incomparable.
 */
export interface P5CounterfactualProvenance {
  evaluatedAt: number;
  evaluationEngineVersion: string;
  calculationVersion: string;
  entryConvention: string;
  exitConvention: string;
  costModelVersion: string;
  sourceDataTimestamp: number;
}

/** Sample floors for P5 validation (guidance + mechanical verdict). */
export interface P5SampleFloors {
  minReviewed: number;
  minActualFills: number;
  minQualityVsRealizedRSamples: number;
}

export const DEFAULT_P5_SAMPLE_FLOORS: P5SampleFloors = {
  minReviewed: 20,
  minActualFills: 10,
  minQualityVsRealizedRSamples: 10,
};

export type P5ValidationVerdict = 'GO' | 'NO-GO' | 'INCONCLUSIVE';

export interface P5OutcomeDistribution {
  sampleCount: number;
  expectancyNetR: number | null;
  medianNetR: number | null;
  winRate: number | null;
  lossRate: number | null;
  p25NetR: number | null;
  p75NetR: number | null;
}

export interface P5ValidationReport {
  schemaVersion: 'p5-validation-report.v1';
  generatedAt: string;
  sample: {
    candidates: number;
    approve: number;
    wait: number;
    reject: number;
    actualFills: number;
    counterfactualCount: number;
    waitMarkCount: number;
    reviewed: number;
    qualityVsRealizedRSamples: number;
  };
  ranking: {
    rank1: P5OutcomeDistribution;
    rank2to3: P5OutcomeDistribution;
    rank4Plus: P5OutcomeDistribution;
    outcomeKind: 'ACTUAL';
  };
  rankingCounterfactual: {
    rank1: P5OutcomeDistribution;
    rank2to3: P5OutcomeDistribution;
    rank4Plus: P5OutcomeDistribution;
    outcomeKind: 'COUNTERFACTUAL';
  };
  intelligence: {
    note: string;
    qualityVsRealizedRSamples: number;
  };
  execution: {
    actualWithPathMetrics: number;
    actualPathUnavailable: number;
    avgMaeR: number | null;
    avgMfeR: number | null;
    avgSlippage: number | null;
    avgNetR: number | null;
  };
  human: {
    approveActual: P5OutcomeDistribution;
    rejectCounterfactual: P5OutcomeDistribution;
    waitMarks: number;
  };
  floors: P5SampleFloors;
  floorsMet: boolean;
  safetyPass: boolean;
  verdict: P5ValidationVerdict;
  verdictReason: string;
  /** GO = ARM eligibility only — never auto-arm. */
  armEligibility: 'ELIGIBLE' | 'BLOCKED';
}
