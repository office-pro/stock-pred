/**
 * B1 Intelligence Batch Foundation — durable research jobs.
 * Advisory / analytical only. Never authorization. Never RankingScore.
 * LIVE_CONTINUOUS / LIVE / HYBRID are type reservations — not executable in B1.
 */

import type { ExitRecommendationAction } from './exit-intelligence';
import type { ManipulationBand } from './manipulation';
import type { DataFreshnessStatus } from './market';
import type { ThesisState } from './thesis-intelligence';
import type { WaitReevaluateTrigger } from './wait-intelligence';

/** Research / promotion states only — not APPROVE/WAIT/REJECT or execution. */
export type IntelligenceLifecycleState =
  | 'MONITORED'
  | 'DETECTED'
  | 'CANDIDATE'
  | 'INTELLIGENCE_ANALYSIS'
  | 'SHORTLIST'
  | 'OPPORTUNITY';

export type IntelligenceUniverseId =
  | 'NIFTY50'
  | 'NIFTY100'
  | 'NIFTY150'
  | 'NIFTY500'
  | 'ALL'
  | 'NSE_ALL'
  | 'US_SP500'
  | 'US_ALL'
  | 'CRYPTO_ALL'
  | 'CRYPTO_SPOT_ALL'
  | 'CRYPTO_FUTURES_ALL'
  | 'COMMODITY_ALL'
  | 'FUTURES_ALL'
  | 'MCX_FUTURES_ALL'
  | 'CME_FUTURES_ALL'
  | 'FOREX_ALL'
  | 'CUSTOM'
  | 'SECTOR'
  | 'SINGLE_STOCK'
  | 'US_CUSTOM'
  | 'CRYPTO_CUSTOM'
  | 'COMMODITIES_CUSTOM'
  | 'FUTURES_CUSTOM';

/** FULL_ANALYSIS executable; LIVE_CONTINUOUS reserved. */
export type IntelligenceBatchType = 'FULL_ANALYSIS' | 'LIVE_CONTINUOUS';

/**
 * Advisory scan kinds (B9–B17). FULL_MARKET maps to classic full analysis.
 * Never authorization.
 */
export type IntelligenceScanKind =
  | 'FULL_MARKET'
  | 'SECTOR'
  | 'SINGLE_STOCK'
  | 'BULL_RUN_SCAN'
  | 'RELATIONSHIP_SCAN'
  | 'INVERSE_SCAN'
  | 'EVENT_ANALYSIS'
  | 'GLOBAL_EVENT_SCAN'
  | 'CUSTOM'
  | 'US_SCAN'
  | 'CRYPTO_SCAN'
  | 'COMMODITIES_SCAN'
  | 'FUTURES_SCAN'
  | 'FOREX_SCAN';

/** HISTORICAL executable in B1; LIVE / HYBRID reserved. */
export type IntelligenceBatchMode = 'HISTORICAL' | 'LIVE' | 'HYBRID';

export type IntelligenceBatchStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'RESUMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PARTIAL';

/**
 * Data-preparation / analysis phase. Independent of BatchStatus, DataStatus,
 * MarketSession, CapabilityState, and ExecutionReadiness.
 */
export type IntelligenceBatchLifecycleStage =
  | 'UNIVERSE_RESOLVED'
  | 'DATA_PREPARING'
  | 'DATA_HYDRATING'
  | 'DATA_VALIDATED'
  | 'RUNNING_INTELLIGENCE'
  | 'RUNNING_PROFESSIONAL_TRADER'
  | 'FINALIZING';

export type BatchSymbolTaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

export type IntelligencePipelineStageId =
  | 'marketData'
  | 'technical'
  | 'fundamental'
  | 'news'
  | 'social'
  | 'macro'
  | 'regime'
  | 'relativeStrength'
  | 'sector'
  | 'multiHorizon'
  | 'thesis'
  | 'wait'
  | 'exit'
  | 'integrity'
  | 'ml'
  | 'professionalAnalysis';

export type IntelligencePipelineStageAvailability =
  | 'available'
  | 'Not available'
  | 'prerequisite_missing';

export type IntelligencePipelineStageUnavailableReason = 'REQUIRES_OPEN_POSITION';

export interface IntelligencePipelineStageProgress {
  id: IntelligencePipelineStageId;
  availability: IntelligencePipelineStageAvailability;
  done: number;
  total: number;
  /** Set when availability is prerequisite_missing (e.g. Exit without open position). */
  unavailableReason?: IntelligencePipelineStageUnavailableReason;
}

/**
 * Compact observe-only labels for batch tasks/results.
 * overallScore = existing analysis.scores.overall only — never RankingScore / never sort key.
 * B2 TI labels omitted when engines return nothing (never fabricated).
 */
export interface IntelligenceBatchContextLabels {
  thesis?: string;
  decision?: string;
  /** Existing AgentAnalysis.scores.overall — not RankingScore. */
  overallScore?: number;
  regimeCombo?: string;
  rsBucket?: string;
  sectorFit?: string;
  sectorTrend?: string;
  horizonAgreement?: string;
  /**
   * B3 — existing analysis.scores only (any sign = available; omit = unavailable).
   * Never RankingScore / never sort key. Never use 0 to mean missing.
   */
  fundamentalScore?: number;
  /** Existing blended sentiment — does NOT imply news or social stage completion. */
  sentimentScore?: number;
  macroScore?: number;
  /** Existing TI catalystContext.eventRisk when catalyst was observed. */
  eventRisk?: string;
  /**
   * B4 — evidence-based intelligence lifecycle (not “batch processed”).
   * Omit when insufficient evidence. MONITORED/DETECTED not assigned in batch finalize.
   */
  intelligenceLifecycleState?: IntelligenceLifecycleState;
  /** T2 ThesisState — separate from narrative `thesis` string. */
  thesisState?: ThesisState;
  /** Present only when WaitRecommendation was built (`WAIT`). Never invent NONE. */
  waitState?: 'WAIT';
  waitTrigger?: WaitReevaluateTrigger;
  /** ExitRecommendationAction — omit without real ExitIntelligencePosition. */
  exitAdvisory?: ExitRecommendationAction;
  /** Existing ManipulationBand from quote.manipulation — omit when absent. */
  integrityStatus?: ManipulationBand;
  /**
   * B5 — compact ML labels from usable HorizonPrediction / MLPredictionSnapshot.
   * Omit when missing/unusable. Never invent bull-run or max-profit fields.
   */
  mlHorizon?: string;
  mlDirection?: string;
  /** Raw ensemble confidence 0–100; omit if absent. Never 0 = missing. */
  mlConfidence?: number;
  mlProbUp?: number;
  mlProbDown?: number;
  mlProbSideways?: number;
  mlExpectedReturn?: number;
  mlExpectedMfe?: number;
  mlExpectedMae?: number;
  mlModelId?: string;
  mlModelVersion?: string;
  mlFeatureVersion?: string;
  mlFreshnessStatus?: string;
  mlDriftStatus?: string;
  /** B6 — advisory Professional Trader / TradePlan compact fields. */
  tradePlanRecommendation?: 'APPROVE' | 'WAIT' | 'REJECT';
  tradePlanExpectedR?: number;
  tradePlanConfidence?: number;
  tradePlanHorizon?: string;
  opportunityQuality?: string;
  /** Persisted TradePlan summary — omit when unavailable. Never invent max-profit / bull-run. */
  tradePlanDirection?: 'LONG' | 'SHORT' | 'FLAT';
  upsideProbability?: number;
  expectedReturnLow?: number;
  expectedReturnHigh?: number;
  expectedPriceLow?: number;
  expectedPriceHigh?: number;
  buyZoneLow?: number;
  buyZoneHigh?: number;
  preferredEntry?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  invalidationPrice?: number;
  exitStrategy?: string;
  /**
   * Truthful completeness — APPROVE + upside ≠ COMPLETE.
   * COMPLETE = geometry + recommendation present; PARTIAL = some fields; UNAVAILABLE = no plan.
   */
  tradePlanStatus?: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  tradePlanMissingFields?: string[];
  /**
   * P1 — true only when APPROVE + COMPLETE geometry.
   * APPROVE + PARTIAL is advisory / not execution-ready (auth chain unchanged).
   */
  tradePlanExecutionReady?: boolean;
  /** Quote provenance for TradePlan geometry — omit when VALID. */
  quoteStatus?: 'VALID' | 'MDS_UNAVAILABLE' | 'PRICE_ZERO' | 'MAP_MISS_RECOVERED';
  /** B9–B17 compact advisory labels — omit when unavailable. Never rankingScore. */
  sectorState?: string;
  bullRunStage?: string;
  bullRunProbability3m?: number;
  /**
   * Bull-Run v2 compact Target×Horizon cells (AVAILABLE only).
   * Never store probability 0 to mean missing — omit the cell instead.
   */
  bullRunV2Cells?: Array<{
    t: number;
    h: '1D' | '1W' | '1M' | '3M' | '6M' | '12M';
    p: number;
    conf?: 'HIGH' | 'MEDIUM' | 'LOW';
    status?: 'AVAILABLE';
  }>;
  bullRunDataStatus?: 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN';
  globalEventImpact?: string;
  fnoStatus?: string;
}

/** Quote/identity provenance for a batch result row — never replaces task.symbol. */
export type BatchIdentityStatus = 'VALID' | 'UNKNOWN_QUOTE' | 'MISMATCH' | 'IDENTITY_MISMATCH';

export type BatchResultRecommendation = 'APPROVE' | 'WAIT' | 'WATCH' | 'NO_TRADE' | 'REJECT';

export type BatchQuarantineStatus = 'IDENTITY_MISMATCH';

/** Named backend presets — FE must not invent filter combinations. */
export type IntelligenceBatchResultsPreset =
  | 'BEST_OPPORTUNITIES'
  | 'HIGH_CONFIDENCE'
  | 'HIGHEST_EXPECTED_RETURN'
  | 'HIGHEST_EXPECTED_R'
  | 'MULTI_HORIZON_ALIGNED'
  | 'BULL_RUN';

export type IntelligenceBatchResultsSort =
  | 'rank'
  | 'symbol'
  | 'direction'
  | 'upsideProb'
  | 'expectedReturn'
  | 'preferredEntry'
  | 'target'
  | 'expectedR'
  | 'confidence'
  | 'horizon'
  | 'recommendation';

export interface IntelligenceBatchResultsQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  preset?: IntelligenceBatchResultsPreset;
  recommendation?: 'APPROVE' | 'WAIT' | 'REJECT';
  thesisState?: string;
  mlAvailable?: boolean;
  sort?: IntelligenceBatchResultsSort;
  order?: 'asc' | 'desc';
  /** Match AVAILABLE bullRunV2Cells.t (e.g. 0.2). Presentation filter only. */
  targetReturn?: number;
  /** Match AVAILABLE bullRunV2Cells.h. */
  horizon?: '1D' | '1W' | '1M' | '3M' | '6M' | '12M';
  /** Match AVAILABLE bullRunV2Cells.conf — ≠ probability. */
  bullRunConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Filter intelligenceContext.bullRunStage (comma-separated allowed via API string). */
  bullRunStage?: string;
  /** Filter integrityStatus (ManipulationBand). */
  integrityStatus?: 'NORMAL' | 'INVESTIGATE' | 'SUSPICIOUS';
  /**
   * Comma-separated integrity bands to exclude (e.g. SUSPICIOUS,INVESTIGATE).
   * Advisory discovery only — not authorization.
   */
  excludeIntegrity?: string;
  /** Filter tradePlanExecutionReady. */
  executionReady?: boolean;
  /** Filter bullRunDataStatus. */
  dataStatus?: 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'UNKNOWN';
  /** Filter row.sector when present. */
  sector?: string;
}

/** Usable-vs-unavailable rollup for ML / RS coverage diagnostics. */
export interface IntelligenceStageOmitDiagnostics {
  usable: number;
  unavailable: number;
  byReason: Record<string, number>;
}

export interface IntelligenceBatchProgressDiagnostics {
  ml?: IntelligenceStageOmitDiagnostics;
  rs?: IntelligenceStageOmitDiagnostics;
}

export interface BatchSymbolTask {
  symbol: string;
  partitionId: string;
  status: BatchSymbolTaskStatus;
  /** Intelligence lifecycle stub — research only. */
  lifecycleState?: IntelligenceLifecycleState;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  opportunityId?: string;
  intelligenceContext?: IntelligenceBatchContextLabels;
  /** Provenance: quote/TI data time actually used — not finalize wall clock alone. */
  dataAsOf?: number;
}

export interface BatchPartition {
  partitionId: string;
  index: number;
  symbolStart: number;
  symbolEnd: number;
  symbols: string[];
}

export interface BatchCheckpoint {
  completedSymbols: string[];
  failedSymbols: string[];
  currentSymbol: string | null;
  partitionId: string | null;
  lastCheckpointAt: number;
}

export interface IntelligenceBatchProgress {
  processed: number;
  pending: number;
  failed: number;
  totalEligible: number;
  total: number;
  percent: number;
  stages: IntelligencePipelineStageProgress[];
  /** Backend omit/usable rollups for coverage click diagnostics. */
  diagnostics?: IntelligenceBatchProgressDiagnostics;
}

export interface IntelligenceBatch {
  schemaVersion: 'intelligence-batch.v1';
  batchId: string;
  universe: IntelligenceUniverseId;
  batchType: IntelligenceBatchType;
  mode: IntelligenceBatchMode;
  status: IntelligenceBatchStatus;
  /**
   * Preparation/analysis phase. Never overload BatchStatus, DataStatus,
   * MarketSession, CapabilityState, or ExecutionReadiness with this.
   */
  lifecycleStage?: IntelligenceBatchLifecycleStage;
  /** Frozen BatchDataSnapshot identity for this run. MDS/cache is not batch input. */
  dataSnapshotVersion?: string;
  dataReadiness?: import('./asset-intelligence').BatchDataReadiness;
  dataReadinessReport?: import('./asset-intelligence').BatchDataReadinessReport;
  symbols: string[];
  /** Immutable canonical identities for this run. */
  instrumentSet?: import('./instrument').InstrumentRef[];
  /**
   * Immutable membership snapshot identity — must match canonical universe version
   * used at create time. Current universe refreshes must not rewrite this set.
   */
  universeVersion?: string;
  membershipSource?: string;
  eligibleCount?: number;
  sourceCount?: number;
  adapterVersion?: string;
  providerSelection?: string;
  /** Analysis lookback period (1W/1M/3M/6M/1Y/CUSTOM). Not candle size. */
  analysisTimeframe?: string;
  analysisPeriod?: import('./instrument').AnalysisPeriod;
  analysisResolution?: import('./instrument').AnalysisResolution;
  analysisWindow?: import('./instrument').AnalysisWindow;
  predictionHorizon?: string;
  sessionContext?: string;
  partitions: BatchPartition[];
  tasks: BatchSymbolTask[];
  checkpoint: BatchCheckpoint;
  progress: IntelligenceBatchProgress;
  featureVersion: string;
  modelVersion: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  /** Present after successful ranking pass. */
  resultsArtifactId?: string;
  /** B9–B17 advisory scan kind — omit means FULL_MARKET. Never authorization. */
  scanKind?: IntelligenceScanKind;
  /** When universe=SECTOR. */
  sector?: string;
  /** Optional inverse / global scan params (advisory). */
  inverseDownsideThreshold?: number;
  globalEventType?: string;
  /** Snapshot-owned coverage — attached on GET from frozen BatchDataSnapshot. */
  capabilityCoverage?: import('./instrument').SnapshotCapabilityCoverageItem[];
  identityCounts?: import('./instrument').BatchIdentityCounts;
  snapshotProvider?: string;
  snapshotDataAsOf?: number;
}

/** Ranked research rows — order from existing RankingContext engine only. */
export interface IntelligenceBatchResultRow {
  /** When universe=SECTOR or row sector known from quote. */
  sector?: string;
  rank: number;
  /** Canonical task / universe ticker — never UNKNOWN when task ticker exists. */
  symbol: string;
  opportunityId: string;
  companyName?: string;
  exchange?: string;
  identityStatus?: BatchIdentityStatus;
  price?: number;
  dominance?: string;
  stale?: boolean;
  dataCompleteness?: string;
  intelligenceContext?: IntelligenceBatchContextLabels;
  /** Provenance for this row's TI/quote inputs when known. */
  dataAsOf?: number;
  rankingEngineVersion?: string;
  calculationVersion?: string;
  tradeHorizon?: string;
  strategyTag?: string;
  /** Multi-asset identity — never join across venues on symbol alone. */
  instrument?: import('./instrument').InstrumentRef;
  adapterId?: string;
  analysisTimeframe?: import('./instrument').AnalysisTimeframe;
  predictionHorizon?: string;
  sessionContext?: import('./instrument').SessionContextId;
  seriesProvenance?: import('./instrument').SeriesProvenance;
  multiAssetDataStatus?: import('./instrument').MultiAssetDataStatus;
  membershipIdentity?: string;
  quarantined?: boolean;
  quarantineStatus?: BatchQuarantineStatus;
  recommendation?: BatchResultRecommendation;
  reasonCode?: string;
  reason?: string;
}

export interface IntelligenceBatchResults {
  schemaVersion: 'intelligence-batch-results.v1';
  batchId: string;
  generatedAt: number;
  dataAsOf: number;
  dataStatus: DataFreshnessStatus;
  rankingEngineVersion: string;
  calculationVersion: string;
  tradeHorizon: string;
  strategyTag: string;
  /** Backend RankingContext lexicographic order — validResults only. */
  rankings: IntelligenceBatchResultRow[];
  /** IDENTITY_MISMATCH rows — data-quality counts only, never ranked. */
  quarantined?: IntelligenceBatchResultRow[];
  identityCounts?: import('./instrument').BatchIdentityCounts;
}

/**
 * Paginated discovery view over stored RankingContext results.
 * Presentation sort never mutates RankingContext / auth.
 */
export interface IntelligenceBatchResultsPage {
  batchId: string;
  rankings: IntelligenceBatchResultRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: IntelligenceBatchResultsSort;
  order: 'asc' | 'desc';
  /** Always RankingContext rank — UI must not present presentation sort as canonical. */
  defaultSort: 'rank';
  rankingContextVersion: string;
  /** Bull Run advisory preset — true when any row has bullRunStage evidence. */
  bullRunAvailable: boolean;
  preset?: IntelligenceBatchResultsPreset | null;
  stages?: IntelligencePipelineStageProgress[];
  diagnostics?: IntelligenceBatchProgressDiagnostics;
  generatedAt?: number;
  dataAsOf?: number;
  dataStatus?: DataFreshnessStatus;
}

export interface CreateIntelligenceBatchRequest {
  universe: IntelligenceUniverseId;
  batchType?: IntelligenceBatchType;
  mode?: IntelligenceBatchMode;
  /** B9–B17 advisory scan kind — defaults to FULL_MARKET. Never authorization. */
  scanKind?: IntelligenceScanKind;
  /**
   * Manual instruments — only for CUSTOM / SINGLE_STOCK / legacy *_CUSTOM.
   * Predefined universes (NIFTY*, NSE_ALL, US_SP500, *_ALL) resolve membership on the backend.
   */
  symbols?: string[];
  /** Canonical custom identities. Preferred over legacy symbols. */
  instruments?: import('./instrument').InstrumentRef[];
  /** Exactly one canonical identity for SINGLE_STOCK. */
  instrument?: import('./instrument').InstrumentRef;
  /** Required when universe=SECTOR. */
  sector?: string;
  /** Deprecated/internal only; public predefined batches reject truncation. */
  allLimit?: number;
  /** Inverse scan downside threshold as fraction (e.g. -0.05). */
  inverseDownsideThreshold?: number;
  /** Optional global event type for GLOBAL_EVENT_SCAN. */
  globalEventType?: string;
  /** Analysis lookback period. Prefer analysisPeriod; analysisTimeframe kept for compatibility. */
  analysisTimeframe?: string;
  analysisPeriod?: import('./instrument').AnalysisPeriod;
  analysisResolution?: import('./instrument').AnalysisResolution;
  analysisWindow?: import('./instrument').AnalysisWindow;
  predictionHorizon?: string;
}

export const INTELLIGENCE_BATCH_PARTITION_SIZE = 50;
export const INTELLIGENCE_BATCH_FEATURE_VERSION = 'intelligence-batch.discovery.v1';
export const INTELLIGENCE_BATCH_MODEL_VERSION = 'none.discovery';
