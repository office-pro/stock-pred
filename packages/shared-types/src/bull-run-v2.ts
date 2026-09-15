/**
 * Bull-Run v2 — target×horizon probability contracts.
 * BullRunProbability(T,H) = P(max forward return within H >= T)
 * Advisory only — never rankingScore, authorization, or execution.
 * Missing evidence → UNAVAILABLE (never 0 / never fabricated).
 */

import type {
  BullRunStage,
  IntelligenceAvailabilityStatus,
  IntelligenceProvenance,
  IntelligenceUnavailableReason,
} from './b9-b17-intelligence';

/** Calendar horizons (12M = 1 year). Independent of target threshold. */
export type BullRunCalendarHorizon = '1D' | '1W' | '1M' | '3M' | '6M' | '12M';

/** Supported minimum-return thresholds (fraction, e.g. 0.10 = +10%). */
export type BullRunTargetReturn = 0.05 | 0.1 | 0.2 | 0.3 | 0.5 | 1.0;

export const BULL_RUN_CALENDAR_HORIZONS: BullRunCalendarHorizon[] = [
  '1D',
  '1W',
  '1M',
  '3M',
  '6M',
  '12M',
];

export const BULL_RUN_DEFAULT_TARGETS: BullRunTargetReturn[] = [0.05, 0.1, 0.2, 0.3, 0.5, 1.0];

/** Bars used for empirical max-forward-return windows (trading days). */
export const BULL_RUN_HORIZON_BARS: Record<BullRunCalendarHorizon, number> = {
  '1D': 1,
  '1W': 5,
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '12M': 252,
};

export type BullRunDataStatus =
  | 'LIVE'
  | 'DELAYED'
  | 'STALE'
  | 'OFFLINE'
  | 'UNKNOWN'
  | 'MISSING'
  | 'INVALID';

export type BullRunConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';

/** Primary artifact — empirical forward max-return samples (where available). */
export interface ForwardReturnDistribution {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  horizon: BullRunCalendarHorizon;
  horizonBars: number;
  sampleSize: number;
  /** Sorted ascending max-forward returns (fraction). Omit when UNAVAILABLE. */
  maxForwardReturns?: number[];
  percentiles?: {
    p10?: number | null;
    p25?: number | null;
    p50?: number | null;
    p75?: number | null;
    p90?: number | null;
  };
}

export interface BullRunTargetHorizonCell {
  targetReturn: number;
  horizon: BullRunCalendarHorizon;
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  /** P(max fwd return within H >= T), 0–1. Null when UNAVAILABLE — never use 0 for missing. */
  probability?: number | null;
  expectedReturnRange?: { low: number; high: number } | null;
  expectedDrawdownRange?: { low: number; high: number } | null;
  timeToTargetRange?: { lowBars: number; highBars: number } | null;
  confidence?: BullRunConfidenceBand;
  sampleSize?: number;
  calibration?: string | null;
  evidence?: string[];
  dataStatus?: BullRunDataStatus;
  dataAsOf?: number | string | null;
}

export interface BullRunV2Assessment {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  stage: BullRunStage;
  dataStatus: BullRunDataStatus;
  distributions: ForwardReturnDistribution[];
  cells: BullRunTargetHorizonCell[];
  /** Supported targets for this assessment (contract-backed). */
  supportedTargets: number[];
  evidence: string[];
  invalidation?: string[];
  provenance: IntelligenceProvenance;
  /**
   * Auth isolation marker — always false. Bull-Run never authorizes.
   * Offline/stale analytical probability ≠ execution readiness.
   */
  executionReadyFromBullRun: false;
}

/** Compact batch labels for Target×Horizon (omit UNAVAILABLE cells). */
export interface BullRunV2CompactCell {
  t: number;
  h: BullRunCalendarHorizon;
  p?: number;
  conf?: BullRunConfidenceBand;
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
}

export interface BatchResearchReportSectorSummary {
  sector: string;
  state?: string;
  memberCount: number;
  bullCandidates: number;
  leaders?: string[];
  laggards?: string[];
}

export interface BatchResearchReportBullRunCounts {
  horizon: BullRunCalendarHorizon;
  targetReturn: number;
  /** Count of AVAILABLE cells only — never count UNAVAILABLE. */
  candidateCount: number;
}

export interface BatchResearchReportBestOpportunity {
  symbol: string;
  rank: number;
  companyName?: string;
  sector?: string;
  recommendation?: string;
  tradePlanStatus?: string;
  tradePlanExecutionReady?: boolean;
  bullRunStage?: string;
  /** Target×horizon context for this pick (backend-owned). */
  targetReturn?: number;
  horizon?: BullRunCalendarHorizon;
  probability?: number | null;
  confidence?: BullRunConfidenceBand;
}

export interface BatchResearchReportDataQuality {
  analyzed: number;
  incomplete: number;
  quoteGaps: number;
  providerGaps: number;
  insufficientHistory: number;
  /** Must remain 0 — fabricated intelligence is forbidden. */
  fabricated: 0;
}

export type BatchOutcomeKind = 'HAS_OPPORTUNITIES' | 'NO_SUITABLE_OPPORTUNITY' | 'PARTIAL_COVERAGE';

/** Backend-owned research projection for a completed/partial batch. */
export interface BatchResearchReport {
  schemaVersion: 'batch-research-report.v1';
  batchId: string;
  completedAt: number;
  universe: string;
  coverage: { total: number; processed: number; failed: number };
  outcome: BatchOutcomeKind;
  marketSummary?: {
    regime?: string;
    note?: string;
  };
  sectorSummary: BatchResearchReportSectorSummary[];
  sectorRotation?: {
    leading: string[];
    improving: string[];
    weakening: string[];
    lagging: string[];
  };
  bullRunSummary?: {
    stagesPresent: string[];
    note?: string;
  };
  bullRunCountsByHorizon: BatchResearchReportBullRunCounts[];
  bestOpportunities: BatchResearchReportBestOpportunity[];
  dataQuality: BatchResearchReportDataQuality;
  dataAsOf?: number | string | null;
  dataStatus?: BullRunDataStatus;
  provenance: IntelligenceProvenance;
  disclaimer: string;
}
