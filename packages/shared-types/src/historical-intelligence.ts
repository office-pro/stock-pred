/**
 * Historical Intelligence + Evidence Validation contracts.
 * Advisory only — never rankingScore, authorization, or fabricated stats.
 * Below minimum sample thresholds → UNAVAILABLE (never fake certainty).
 */

import type {
  IntelligenceAvailabilityStatus,
  IntelligenceProvenance,
  IntelligenceUnavailableReason,
} from './b9-b17-intelligence';
import type { BullRunCalendarHorizon } from './bull-run-v2';

/** Prediction / outcome horizons (bars ≈ trading days). LOOKBACK ≠ these. */
export type HistoricalPredictionHorizon =
  | '1D'
  | '3D'
  | '5D'
  | '10D'
  | '20D'
  | '1M'
  | '3M'
  | '6M'
  | '12M'
  | '2Y'
  | '3Y';

export const HISTORICAL_PREDICTION_HORIZON_BARS: Record<HistoricalPredictionHorizon, number> = {
  '1D': 1,
  '3D': 3,
  '5D': 5,
  '10D': 10,
  '20D': 20,
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '12M': 252,
  '2Y': 504,
  '3Y': 756,
};

/** Analogue lookback windows — not prediction horizons. */
export type HistoricalLookbackWindow = '1Y' | '3Y' | '5Y' | '10Y';

export const HISTORICAL_LOOKBACK_BARS: Record<HistoricalLookbackWindow, number> = {
  '1Y': 252,
  '3Y': 756,
  '5Y': 1260,
  '10Y': 2520,
};

/** Minimum analogues for AVAILABLE forward distributions / Bull-Run historical feed. */
export const HISTORICAL_ANALOGUE_MIN_SAMPLE = 20;
/** Minimum outcomes for horizon-level rates. */
export const HISTORICAL_OUTCOME_MIN_SAMPLE = 20;
/** Minimum for reliability metrics publication. */
export const PREDICTION_RELIABILITY_MIN_SAMPLE = 30;

export type PriceReturnBasis =
  | 'AS_PROVIDED_CANDLES'
  | 'SPLIT_ADJUSTED'
  | 'TOTAL_RETURN'
  | 'UNKNOWN';

export type UniverseMembershipStatus =
  | 'HISTORICAL_MEMBERSHIP_USED'
  | 'CURRENT_MEMBERSHIP_FALLBACK'
  | 'UNKNOWN';

export interface HistoricalStateFeatures {
  return1d?: number | null;
  return5d?: number | null;
  return20d?: number | null;
  return60d?: number | null;
  momentum20?: number | null;
  volatility20?: number | null;
  volumeRatio20?: number | null;
  drawdown60?: number | null;
}

/** Point-in-time state — must not include future information. */
export interface HistoricalState {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  /** Index into candle series (inclusive as-of bar). */
  asOfIndex: number;
  asOfDate?: string | null;
  analysisTimeframe: '1D';
  predictionHorizon?: HistoricalPredictionHorizon;
  features: HistoricalStateFeatures;
  priceReturnBasis: PriceReturnBasis;
  corporateActionNote: string;
  universeMembershipStatus: UniverseMembershipStatus;
  provenance: IntelligenceProvenance;
}

export interface HistoricalAnalogue {
  symbol: string;
  historicalIndex: number;
  historicalDate?: string | null;
  similarity: number;
  matchedFeatures: string[];
  marketRegime?: string | null;
  sectorState?: string | null;
  sampleEligibility: 'ELIGIBLE' | 'INSUFFICIENT_FORWARD' | 'EXCLUDED';
}

export interface HistoricalAnalogueSet {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  lookback: HistoricalLookbackWindow;
  queryAsOfIndex: number;
  analogues: HistoricalAnalogue[];
  sampleSize: number;
  minSampleRequired: number;
  provenance: IntelligenceProvenance;
}

export interface HistoricalOutcomeMetrics {
  horizon: HistoricalPredictionHorizon;
  horizonBars: number;
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  sampleSize: number;
  forwardReturnMean?: number | null;
  forwardReturnMedian?: number | null;
  positiveRate?: number | null;
  mfeMedian?: number | null;
  maeMedian?: number | null;
  maxDrawdownMedian?: number | null;
  quantiles?: { p25?: number | null; p50?: number | null; p75?: number | null };
}

export interface HistoricalOutcomeBundle {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  outcomes: HistoricalOutcomeMetrics[];
  sampleSize: number;
  minSampleRequired: number;
  priceReturnBasis: PriceReturnBasis;
  provenance: IntelligenceProvenance;
}

export interface HistoricalForwardDistribution {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  horizon: HistoricalPredictionHorizon;
  horizonBars: number;
  sampleSize: number;
  meanReturn?: number | null;
  medianReturn?: number | null;
  quantiles?: {
    p10?: number | null;
    p25?: number | null;
    p50?: number | null;
    p75?: number | null;
    p90?: number | null;
  };
  upsideRange?: { low: number; high: number } | null;
  downsideRange?: { low: number; high: number } | null;
  drawdownRange?: { low: number; high: number } | null;
  /** Empirical max-forward returns for Bull-Run P(≥T) — omit when UNAVAILABLE. */
  maxForwardReturns?: number[];
  calibrationStatus: 'UNAVAILABLE' | 'NOT_MEASURED';
  provenance: IntelligenceProvenance;
}

export type EvidenceStance = 'SUPPORTING' | 'CONFLICTING' | 'NEUTRAL' | 'MISSING' | 'UNKNOWN';

export interface StructuredEvidenceItem {
  engine: string;
  status: IntelligenceAvailabilityStatus | 'MISSING';
  stance: EvidenceStance;
  value?: string | number | null;
  interpretation?: string;
  dataAsOf?: number | string | null;
  source: string;
  confidence?: string | number | null;
  sampleSize?: number | null;
  modelVersion?: string | null;
  featureVersion?: string | null;
}

export interface EvidenceValidationResult {
  schemaVersion: 'evidence-validation.v1';
  supportingEvidence: StructuredEvidenceItem[];
  conflictingEvidence: StructuredEvidenceItem[];
  missingEvidence: StructuredEvidenceItem[];
  neutralEvidence: StructuredEvidenceItem[];
  evidenceCount: number;
  /** Qualitative only — never a numeric ranking score. */
  evidenceQuality: 'STRONG' | 'MIXED' | 'WEAK' | 'INSUFFICIENT' | 'UNKNOWN';
  conflictSummary: string;
  provenance: IntelligenceProvenance;
}

/** Prediction quality fields — never collapse into one score. */
export interface PredictionQualityPayload {
  direction?: 'UP' | 'DOWN' | 'SIDEWAYS' | null;
  /** Probability of a defined event — not model confidence. */
  probability?: number | null;
  definedEvent?: string;
  expectedReturnRange?: { low: number; high: number } | null;
  expectedDrawdownRange?: { low: number; high: number } | null;
  predictionHorizon: HistoricalPredictionHorizon | BullRunCalendarHorizon | string;
  analysisTimeframe?: string;
  /** Reliability of the estimate — NOT probability. */
  confidence?: string | number | null;
  sampleSize?: number | null;
  calibrationStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_MEASURED';
  calibrationNote?: string;
  modelVersion?: string | null;
  featureVersion?: string | null;
  dataAsOf?: number | string | null;
  regime?: string | null;
  invalidation?: string[];
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason | 'NO_FORCED_PREDICTION';
}

export interface EngineReliabilityMetric {
  engine: string;
  horizon: string;
  regime: string;
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  sampleSize: number;
  accuracy?: number | null;
  hitRate?: number | null;
  calibration?: string | null;
  stability?: string | null;
  note?: string;
}

export interface PredictionImprovementClaim {
  status: 'PASS' | 'IMPROVEMENT_NOT_VERIFIED' | 'FAIL';
  message: string;
  comparisonWindow?: string;
  horizon?: string;
  universe?: string;
  costConvention?: string;
}
