/**
 * Multi-asset identity and adapter contracts.
 * InstrumentRef is canonical — provider symbols map only at the provider boundary.
 * CapabilityState ≠ DataStatus (currentness / validity).
 */

/** Capability presence — not freshness. */
export type CapabilityState = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

/**
 * Currentness / validity of a data payload.
 * Separate from CapabilityState (e.g. candles AVAILABLE + STALE).
 */
export type MultiAssetDataStatus =
  | 'LIVE'
  | 'DELAYED'
  | 'STALE'
  | 'OFFLINE'
  | 'HISTORICAL'
  | 'UNKNOWN'
  | 'MISSING'
  | 'INVALID';

export type AssetClass =
  | 'EQUITY'
  | 'INDEX'
  | 'ETF'
  | 'CRYPTO_SPOT'
  | 'COMMODITY'
  | 'COMMODITY_FUTURE'
  | 'CRYPTO_FUTURE'
  | 'INDEX_FUTURE'
  | 'OPTION'
  | 'FX';

/** Trading venue / exchange id (string for extensibility; NSE/BSE remain primary). */
export type VenueId = string;

export type ContractType = 'PERPETUAL' | 'MONTHLY' | 'QUARTERLY' | 'PRODUCT';

/** Canonical instrument identity — never put Yahoo/broker suffixes in business engines.
 * OPTION (when gated AVAILABLE later): require strike + optionType on InstrumentRef;
 * contract identity is not symbol-alone.
 */
export interface InstrumentRef {
  symbol: string;
  assetClass: AssetClass;
  venue: VenueId;
  quoteCurrency: string;
  underlying?: string;
  contractMonth?: string;
  expiry?: string;
  contractMultiplier?: number;
  canonicalSymbol?: string;
  providerAssetId?: string;
  contractType?: ContractType;
}

export type PredictionHorizonKind = 'DURATION' | 'NEXT_CANDLE' | 'NEXT_SESSION';

/**
 * Analysis lookback period — how much historical market behavior to analyze.
 * Not candle interval. Candle size is {@link AnalysisResolution}.
 */
export type AnalysisPeriod = '1W' | '1M' | '3M' | '6M' | '1Y' | 'CUSTOM';

/** Candle / bar resolution used inside the analysis window. */
export type AnalysisResolution = '5m' | '15m' | '1H' | '4H' | '1D';

/**
 * @deprecated Prefer {@link AnalysisPeriod} for lookback and {@link AnalysisResolution} for candles.
 * Kept for paper-experiment / historical-intelligence candle ids.
 */
export type AnalysisTimeframe = AnalysisResolution | '1m' | '1h' | '4h' | '1d' | string;

export type DurationPredictionHorizon =
  | '1D'
  | '3D'
  | '5D'
  | '1W'
  | '1M'
  | '3M'
  | '6M'
  | '1Y'
  | string;

/** Inclusive calendar window when analysisPeriod is CUSTOM. Dates are YYYY-MM-DD. */
export interface AnalysisWindow {
  startDate: string;
  endDate: string;
}

export type SessionContextId =
  | 'NSE_REGULAR'
  | 'US_RTH'
  | 'ROLLING_24H'
  | 'CONTRACT_CALENDAR'
  | string;

export interface TemporalContext {
  timezone: string;
  sessionMode: 'REGULAR' | 'EXTENDED' | 'ROLLING_24H' | 'CONTRACT_CALENDAR';
  sessionDate?: string;
  rollingWindow?: string;
  sessionContextId: SessionContextId;
}

export interface HorizonDefinition {
  id: string;
  label: string;
  kind: PredictionHorizonKind;
  /** Duration value when kind=DURATION (unit-specific). */
  duration?: number;
  resolution?: string;
  /** Optional bar hint — adapters must not treat this as universal truth. */
  barMapping?: number;
  calendarSemantics: 'TRADING_DAYS' | 'CALENDAR_DAYS' | 'CLOCK_HOURS' | 'BARS' | 'NEXT_OBSERVATION';
  assetClass: AssetClass;
}

export type SeriesType =
  | 'INDIVIDUAL_CONTRACT'
  | 'CONTINUOUS_ADJUSTED'
  | 'CONTINUOUS_UNADJUSTED'
  | 'SPOT'
  | 'EQUITY_CASH';

export interface SeriesProvenance {
  /** Optional for spot/equity when series type is not applicable. */
  seriesType?: SeriesType;
  contractSelectionPolicy?: string;
  rollPolicy?: string;
  priceAdjustmentPolicy?: string;
  /** Alias for priceAdjustmentPolicy when adjustment is the primary concern. */
  adjustmentPolicy?: string;
  transformation?: string;
  source: string;
  provider?: string;
  dataAsOf?: number | string | null;
  fallbackUsed?: boolean;
  providerSelectionReason?: string;
}

/** No silent raw vs adjusted mix — missing adjusted history → UNAVAILABLE. */
export interface PriceSeriesPolicy {
  adjustmentMode: 'RAW' | 'ADJUSTED' | 'MIXED_FORBIDDEN';
  source: string;
  appliedAt?: number | string | null;
}

/**
 * Coverage disposition for batch reporting.
 * CapabilityState stays AVAILABLE|PARTIAL|UNAVAILABLE; NOT_APPLICABLE is coverage-only.
 */
export type CoverageDisposition = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export type EligibilityStatus =
  | 'ELIGIBLE'
  | 'EXCLUDED'
  | 'DELISTED'
  | 'SUSPENDED'
  | 'NOT_SUPPORTED'
  | 'INVALID_IDENTITY';

export interface UniverseMembership {
  universeId: string;
  membershipSource: string;
  effectiveDate: string;
  discoveredAt: number;
  eligibilityStatus: EligibilityStatus;
  eligibilityReason?: string;
  symbol: string;
  instrument?: InstrumentRef;
}

export type CompletenessStatus = 'COMPLETE' | 'PARTIAL' | 'FAILED';

export interface UniverseValidationResult {
  universeId: string;
  source: string;
  sourceCount: number;
  normalizedCount: number;
  eligibleCount: number;
  rejectedCount: number;
  duplicateCount: number;
  excludedCount: number;
  completenessStatus: CompletenessStatus;
  warnings: string[];
  errors: string[];
}

export interface UniverseRefreshPolicy {
  minAbsoluteCount?: number;
  minRelativeRetention?: number;
  maxDropPct?: number;
}

export interface DataIngestionRun {
  runId: string;
  provider: string;
  universe: string;
  startedAt: number;
  completedAt?: number;
  requested: number;
  received: number;
  normalized: number;
  rejected: number;
  duplicates: number;
  missing: number;
  failed: number;
  requestCount: number;
  pageCount: number;
  cursorCount: number;
  providerReportedTotal?: number;
  receivedTotal: number;
  completenessStatus: CompletenessStatus;
  errorCodes: string[];
}

export type MarketSessionStatus =
  | 'PRE_OPEN'
  | 'OPEN'
  | 'POST_CLOSE'
  | 'CLOSED'
  | 'HOLIDAY'
  | 'HALTED'
  | 'UNKNOWN';

/** Backend-owned — FE must not clock-derive open/closed. */
export interface MarketSessionState {
  venue: VenueId;
  assetClass: AssetClass;
  status: MarketSessionStatus;
  timezone: string;
  sessionDate: string;
  isLive: boolean;
  isTradable: boolean;
  lastMarketUpdateAt?: number | null;
  nextExpectedOpenAt?: number | null;
  nextExpectedCloseAt?: number | null;
  dataAsOf?: number | null;
  dataAgeMs?: number | null;
  source?: string;
  dataStatus?: MultiAssetDataStatus;
}

export type ProviderAuthorityRole = 'PRIMARY' | 'SECONDARY' | 'FALLBACK';

export interface ProviderCapabilityAuthority {
  provider: string;
  capability: string;
  role: ProviderAuthorityRole;
}

export interface SourceAuthorityPolicy {
  identity: string[];
  universe: string[];
  marketData: string[];
  fundamentals: string[];
  corporateActions: string[];
  sector: string[];
  news: string[];
}

export interface CurrencyContext {
  baseCurrency: string;
  quoteCurrency: string;
  fxSource?: string | null;
  fxDataAsOf?: number | string | null;
  conversionPolicy: 'NONE' | 'EXPLICIT_FX' | 'FORBIDDEN_SILENT';
}

export type UnavailableReasonCode =
  | 'NO_PROVIDER'
  | 'NO_HISTORY'
  | 'INSUFFICIENT_HISTORY'
  | 'NO_BENCHMARK'
  | 'STALE_DATA'
  | 'INVALID_DATA'
  | 'PROVIDER_FAILURE'
  | 'UNSUPPORTED_ASSET'
  | 'CONTRACT_UNRESOLVED'
  | 'MODEL_UNAVAILABLE'
  | 'UNSUPPORTED_UNIVERSE'
  | 'UNIVERSE_REFRESH_FAILED'
  | 'IDENTITY_CONFLICT'
  | 'DATA_INCOMPLETE';

export type FundamentalsProvenanceKind = 'SOURCE_REPORTED' | 'ENGINE_DERIVED' | 'MODEL_DERIVED';

export type EntityMappingStatus = 'VALID' | 'AMBIGUOUS' | 'UNMAPPED';

export interface SectorClassification {
  sector: string;
  industry?: string;
  taxonomy: string;
  source: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/** Extend BatchCapabilityCoverageItem denominators (eligible ≠ processed). */
export interface CapabilityCoverageDenominators {
  totalEligible: number;
  eligibleCount: number;
  available: number;
  partial: number;
  unavailable: number;
  notApplicable: number;
  processedCount: number;
  pendingCount: number;
  failedCount: number;
  dataStatus?: MultiAssetDataStatus;
  asOf?: number | string | null;
}

/** What the platform can attempt for an instrument/adapter — not freshness. */
export interface DataCapability {
  marketData: CapabilityState;
  historicalCandles: CapabilityState;
  benchmark: CapabilityState;
  sector: CapabilityState;
  fundamentals: CapabilityState;
  catalyst: CapabilityState;
  sentiment: CapabilityState;
  ml: CapabilityState;
  historicalAnalogues: CapabilityState;
  bullRun: CapabilityState;
  relationships: CapabilityState;
  /** NSE F&O specifically — not crypto/commodity derivatives. */
  fno: CapabilityState;
  /** Crypto futures / listed derivatives (mark, OI, funding). Independent of `fno`. */
  derivatives: CapabilityState;
  /** Liquidations / long-short / COT — independent of derivatives quotes. */
  positioning: CapabilityState;
  globalImpact: CapabilityState;
  paperTrading: CapabilityState;
}

export interface BatchCapabilityCoverageItem {
  capability: keyof DataCapability | string;
  available: number;
  partial: number;
  unavailable: number;
  /** Coverage-only — never conflated with CapabilityState. */
  notApplicable?: number;
  /** Dominant dataStatus among rows that have this capability available/partial. */
  dataStatus?: MultiAssetDataStatus;
  coverageCount: number;
  /** Denominator: canonical eligible membership when known; else processed rows. */
  totalCount: number;
  totalEligible?: number;
  eligibleCount?: number;
  processedCount?: number;
  pendingCount?: number;
  failedCount?: number;
  asOf?: number | string | null;
}

/** Snapshot-owned coverage status. N/A is not UNAVAILABLE. */
export type SnapshotCoverageStatus = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'PENDING' | 'N/A';

export type SnapshotCoverageGroup = 'data' | 'intelligence' | 'derivatives';

/**
 * Backend-owned capability coverage from frozen BatchDataSnapshot.
 * Applicable coveragePct = (available + partial) / eligible.
 * N/A uses `na`, eligible/available/partial/unavailable = 0, coveragePct null.
 */
export interface SnapshotCapabilityCoverageItem {
  capability: string;
  group: SnapshotCoverageGroup;
  status: SnapshotCoverageStatus;
  eligible: number;
  available: number;
  partial: number;
  unavailable: number;
  pending: number;
  na: number;
  coveragePct: number | null;
  reason?: string;
}

export interface BatchIdentityCounts {
  eligible: number;
  valid: number;
  quarantined: number;
}

export interface ProviderCapability {
  provider: string;
  assetClass: AssetClass;
  venue: VenueId;
  liveQuote: CapabilityState;
  historicalCandles: CapabilityState;
  fundamentals: CapabilityState;
  derivatives: CapabilityState;
  news: CapabilityState;
  macro: CapabilityState;
}

export type PaperExperimentStatus =
  | 'QUEUED'
  | 'ACTIVE'
  | 'MONITORING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

/** Advisory paper experiment — never auto-touches Risk/Gate. */
export interface PaperExperiment {
  experimentId: string;
  createdAt: number;
  status: PaperExperimentStatus;
  instrument: InstrumentRef;
  adapterId: string;
  batchId?: string;
  /** Exact batch snapshot identity — must resolve historical membership. */
  universeVersion?: string | null;
  decisionId?: string | null;
  operatingMode?: string | null;
  predictionSnapshot?: Record<string, unknown> | null;
  recommendationSnapshot?: Record<string, unknown> | null;
  analysisTimeframe: AnalysisTimeframe;
  predictionHorizon: string;
  sessionContext: SessionContextId;
  probability?: number | null;
  confidence?: string | null;
  confidenceStatus?: CapabilityState;
  confidenceBasis?: string | null;
  thesis?: string | null;
  recommendation?: string | null;
  modelVersion?: string | null;
  featureVersion?: string | null;
  dataAsOf?: number | string | null;
  dataStatus?: MultiAssetDataStatus;
  seriesProvenance?: SeriesProvenance;
  note?: string;
}

/** Learning segregation dimensions — no automatic NSE→BTC calibration. */
export interface LearningSegregationKey {
  engine: string;
  assetClass: AssetClass;
  venue: VenueId;
  horizon: string;
  regime?: string | null;
  modelVersion?: string | null;
}

export interface PaperExperimentOutcome {
  experimentId: string;
  evaluatedAt: number;
  actualReturn?: number | null;
  mfe?: number | null;
  mae?: number | null;
  targetReached?: boolean | null;
  timeToTargetMs?: number | null;
  sampleNote?: string;
  dataStatus?: MultiAssetDataStatus;
}

/** Learning stays MEASURE/CALIBRATE/VALIDATE — never promotes to production or mutates Gate. */
export type LearningPhase = 'MEASURE' | 'CALIBRATE' | 'VALIDATE';
