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

/**
 * Supported minimum-return thresholds (fraction, e.g. 0.10 = +10%).
 * +200% (2.0) and +500% (5.0) are evidence-gated — omit cell when unsupported.
 */
export type BullRunTargetReturn = 0.05 | 0.1 | 0.2 | 0.3 | 0.5 | 1.0 | 2.0 | 5.0;

export const BULL_RUN_CALENDAR_HORIZONS: BullRunCalendarHorizon[] = [
  '1D',
  '1W',
  '1M',
  '3M',
  '6M',
  '12M',
];

export const BULL_RUN_DEFAULT_TARGETS: BullRunTargetReturn[] = [
  0.05, 0.1, 0.2, 0.3, 0.5, 1.0, 2.0, 5.0,
];

/** Command Center Best Picks / Opportunities columns (P(≥T); UI may omit empty columns). */
export const COMMAND_CENTER_MATRIX_TARGETS: number[] = [0.1, 0.2, 0.3, 0.5, 1.0, 2.0, 5.0];

/** Default Overview horizon for matrix display. */
export const COMMAND_CENTER_DEFAULT_HORIZON: BullRunCalendarHorizon = '3M';

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

/** One Target×Horizon cell in Command Center matrix (backend-owned; FE display only). */
export interface BatchResearchReportMatrixCell {
  targetReturn: number;
  status: IntelligenceAvailabilityStatus;
  /** P(≥T within H). Null when UNAVAILABLE — never invent 0 for missing. */
  p?: number | null;
  conf?: BullRunConfidenceBand;
}

export interface BatchResearchReportHorizonMatrix {
  horizon: BullRunCalendarHorizon;
  cells: BatchResearchReportMatrixCell[];
}

export interface BatchResearchReportBestOpportunity {
  symbol: string;
  rank: number;
  companyName?: string;
  sector?: string;
  recommendation?: string;
  tradePlanStatus?: string;
  /** Backend P1 readiness only — never infer from APPROVE + confidence. */
  tradePlanExecutionReady?: boolean;
  bullRunStage?: string;
  /** RankingContext BEST_OPPORTUNITIES membership — not max Bull-Run probability. */
  isBestPick?: boolean;
  /** Advisory integrity from ManipulationBand — omit when absent. */
  integrityStatus?: 'NORMAL' | 'INVESTIGATE' | 'SUSPICIOUS';
  /** Target×horizon context for this pick (legacy single-cell; prefer bullRunMatrix). */
  targetReturn?: number;
  horizon?: BullRunCalendarHorizon;
  probability?: number | null;
  confidence?: BullRunConfidenceBand;
  /** Full compact matrix from batch bullRunV2Cells (all horizons present on row). */
  bullRunMatrix?: BatchResearchReportHorizonMatrix[];
  thesis?: string;
  tradePlanExpectedR?: number;
  tradePlanHorizon?: string;
  invalidationPrice?: number;
  /** Evidence validation — qualitative only; never EvidenceScore / ranking. */
  evidenceQuality?: 'STRONG' | 'MIXED' | 'WEAK' | 'INSUFFICIENT' | 'UNKNOWN';
  /** Passthrough from batch context when present (HIGH/MEDIUM/LOW). */
  opportunityQuality?: string;
  /** P(≥20% within 1W) — null when UNAVAILABLE; never fabricated 0. */
  prob1W20?: number | null;
  /** P(≥20% within 1M) — null when UNAVAILABLE; never fabricated 0. */
  prob1M20?: number | null;
  /** Batch snapshot price when finite — live quote preferred in UI. */
  price?: number | null;
  conflictSummary?: string;
  supportingEvidence?: string[];
  conflictingEvidence?: string[];
  missingEvidence?: string[];
  /** Historical analogues at batch finalize — often UNAVAILABLE without candle recompute. */
  historicalStatus?: 'AVAILABLE' | 'UNAVAILABLE';
  historicalSampleSize?: number | null;
  historicalNote?: string;
}

export interface BatchResearchReportIntegritySummary {
  normal: number;
  investigate: number;
  suspicious: number;
  unknown: number;
}

/**
 * Prior same-universe batch KPI deltas — only when a prior research-report exists.
 * Never invent percentages when unavailable.
 */
export interface BatchResearchReportVsPrevious {
  available: boolean;
  priorBatchId?: string;
  priorCompletedAt?: number;
  deltaTotal?: number | null;
  deltaActionable?: number | null;
  deltaWatchlist?: number | null;
  deltaAvoid?: number | null;
  /** e.g. NO_PRIOR_SAME_UNIVERSE | PRIOR_SUMMARY_MISSING */
  reason?: string;
}

/** KPI strip for Research Reports Command Center (full rankings, not top-50). */
export interface BatchResearchReportDashboardSummary {
  total: number;
  actionable: number;
  watchlist: number;
  avoid: number;
  vsPrevious?: BatchResearchReportVsPrevious;
}

/** Honest coverage of finite tradePlanExpectedR on rankings. */
export interface BatchResearchReportExpectedRCoverage {
  withExpectedR: number;
  missing: number;
}

export interface BatchResearchReportRecommendationDistribution {
  approve: number;
  wait: number;
  reject: number;
  /** Rows lacking APPROVE/WAIT/REJECT — never invent MONITOR. */
  unspecified: number;
}

export interface BatchResearchReportSectorOpportunityCount {
  sector: string;
  count: number;
}

export interface BatchResearchReportExpectedRBin {
  id: 'lt_neg1' | 'neg1_0' | '0_1' | '1_2' | 'gt_2';
  label: string;
  count: number;
}

export interface BatchResearchReportBullRunOpportunity {
  symbol: string;
  rank: number;
  sector?: string;
  targetReturn: number;
  horizon: BullRunCalendarHorizon;
  probability: number;
  confidence?: BullRunConfidenceBand;
  integrityStatus?: 'NORMAL' | 'INVESTIGATE' | 'SUSPICIOUS';
  recommendation?: string;
  tradePlanExecutionReady?: boolean;
  isBestPick?: boolean;
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
  schemaVersion: 'batch-research-report.v1' | 'batch-research-report.v2';
  batchId: string;
  completedAt: number;
  universe: string;
  coverage: { total: number; processed: number; failed: number };
  outcome: BatchOutcomeKind;
  /** Command Center default horizon for Best Picks matrix (UI may override). */
  commandCenterHorizon?: BullRunCalendarHorizon;
  /** Display targets for Command Center columns (evidence may omit per-stock cells). */
  matrixTargets?: number[];
  marketSummary?: {
    regime?: string;
    note?: string;
    breadth?: string;
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
  /** RankingContext order (canonical rank). isBestPick marks BEST_OPPORTUNITIES. */
  bestOpportunities: BatchResearchReportBestOpportunity[];
  /** BEST_OPPORTUNITIES subset in RankingContext order (same ranks as bestOpportunities). */
  bestPicks?: BatchResearchReportBestOpportunity[];
  /**
   * Full RankingContext projection for Opportunities table (all processed ranks).
   * Prefer this over bestOpportunities (top-50) for dashboard KPIs/table.
   */
  opportunities?: BatchResearchReportBestOpportunity[];
  /** Full-batch KPI strip — counts over all rankings. */
  dashboardSummary?: BatchResearchReportDashboardSummary;
  recommendationDistribution?: BatchResearchReportRecommendationDistribution;
  sectorOpportunityCounts?: BatchResearchReportSectorOpportunityCount[];
  expectedRHistogram?: BatchResearchReportExpectedRBin[];
  /** Rows with finite tradePlanExpectedR vs missing — never invent histogram bins. */
  expectedRCoverage?: BatchResearchReportExpectedRCoverage;
  /** Rows with AVAILABLE bull-run cells for Opportunities section (not FE-ranked). */
  bullRunOpportunities?: BatchResearchReportBullRunOpportunity[];
  integritySummary?: BatchResearchReportIntegritySummary;
  /** Honest calibration note — Bull-Run cell calibration is not populated in-engine. */
  calibrationNote?: string;
  /** Comparative improvement vs prior prediction engine — never assume PASS. */
  predictionImprovementNote?: string;
  dataQuality: BatchResearchReportDataQuality;
  dataAsOf?: number | string | null;
  dataStatus?: BullRunDataStatus;
  provenance: IntelligenceProvenance;
  disclaimer: string;
}
