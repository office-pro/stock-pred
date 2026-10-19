/**
 * Market Intelligence — unified fundamentals + news + corporate evidence contracts.
 * Configuration-driven; no hard-coded universe sizes. Never authorizes trades.
 */

import type { AnalysisPeriod, AnalysisResolution, InstrumentRef } from './instrument';
import type { IntelligenceBatchMode } from './intelligence-batch';

/** Batch universes for MI (dynamic membership). NSE_EQUITY_ALL = cash equity only. */
export type MarketIntelligenceUniverseType =
  | 'NIFTY50'
  | 'NIFTY100'
  | 'NIFTY200'
  | 'NIFTY500'
  | 'NSE_EQUITY_ALL'
  | 'CUSTOM';

export type EvidenceSourceType =
  | 'NSE'
  | 'BSE'
  | 'COMPANY'
  | 'YAHOO'
  | 'TRUEDATA'
  | 'SCREENER'
  | 'TRENDLYNE'
  | 'MONEYCONTROL'
  | 'PULSE'
  | 'OTHER';

export type EvidenceKind =
  | 'NEWS'
  | 'FILING'
  | 'RESULT'
  | 'ANNUAL_REPORT'
  | 'INVESTOR_PRESENTATION'
  | 'EARNINGS_CALL'
  | 'FINANCIAL_STATEMENT'
  | 'FUNDAMENTAL'
  | 'CORPORATE_ACTION'
  | 'SHAREHOLDING'
  | 'OTHER';

/** Coverage of required evidence — independent of freshness. */
export type MiCoverageState = 'COMPLETE' | 'PARTIAL' | 'MISSING';

/** Freshness of available evidence — independent of coverage. */
export type MiFreshnessState = 'CURRENT' | 'DELAYED' | 'STALE' | 'UNKNOWN';

export type MiRequirementLevel = 'required' | 'optional' | 'off';

export type MiNewsEventType =
  | 'EARNINGS'
  | 'REVENUE_GUIDANCE'
  | 'PROFIT_WARNING'
  | 'ORDER_WIN'
  | 'CONTRACT'
  | 'ACQUISITION'
  | 'MERGER'
  | 'FUNDRAISING'
  | 'DEBT'
  | 'CREDIT_RATING'
  | 'DIVIDEND'
  | 'BUYBACK'
  | 'BONUS'
  | 'SPLIT'
  | 'MANAGEMENT_CHANGE'
  | 'PROMOTER_ACTION'
  | 'REGULATORY_ACTION'
  | 'LEGAL_EVENT'
  | 'PRODUCT_LAUNCH'
  | 'CAPEX'
  | 'EXPANSION'
  | 'PLANT_SHUTDOWN'
  | 'ESG_EVENT'
  | 'MACRO_EVENT'
  | 'SECTOR_EVENT'
  | 'OTHER';

/** Provenance retained on every evidence item. */
export interface EvidenceProvenance {
  instrumentId?: string;
  instrument: InstrumentRef;
  source: string;
  sourceType: EvidenceSourceType;
  evidenceKind: EvidenceKind;
  sourceUrl?: string;
  sourceDocumentId?: string;
  publishedAt?: string;
  /** Point-in-time visibility — must not be used before this instant in backtests. */
  availableAt: string;
  effectiveAt?: string;
  retrievedAt: string;
  contentHash?: string;
  rawReference?: string;
  parserVersion?: string;
  normalizedVersion?: string;
}

export interface MiDateRange {
  start: string;
  end: string;
}

export interface RawFundamentalRecord {
  provenance: EvidenceProvenance;
  metric: string;
  valueNative: number | string | null;
  unitNative?: string;
  periodStart?: string;
  periodEnd?: string;
  payload?: Record<string, unknown>;
}

export interface RawFinancialRecord extends RawFundamentalRecord {
  statement: 'INCOME' | 'BALANCE' | 'CASHFLOW' | 'RATIOS' | 'OTHER';
}

export interface RawCorporateAction {
  provenance: EvidenceProvenance;
  actionType: string;
  exDate?: string;
  recordDate?: string;
  details?: Record<string, unknown>;
}

export interface RawCorporateDisclosure {
  provenance: EvidenceProvenance;
  title: string;
  category?: string;
  bodyRef?: string;
}

export interface RawNewsArticle {
  provenance: EvidenceProvenance;
  articleId: string;
  title: string;
  summary?: string;
  bodyRef?: string;
  author?: string;
  language?: string;
  category?: string;
  tags?: string[];
}

export interface NormalizedFundamentalFact {
  instrument: InstrumentRef;
  metric: string;
  value: number | null;
  unit: string;
  periodStart?: string;
  periodEnd?: string;
  availableAt: string;
  publishedAt?: string;
  sourceDocumentId?: string;
  sources: EvidenceSourceType[];
  conflict: boolean;
  values?: Array<{ source: EvidenceSourceType; value: number | null; unit?: string }>;
}

export interface NormalizedNewsItem {
  instrument: InstrumentRef;
  articleId: string;
  headline: string;
  summary?: string;
  category?: string;
  eventType?: MiNewsEventType;
  sentimentLabel?: 'positive' | 'negative' | 'neutral';
  sentimentScore?: number;
  sentimentConfidence?: number;
  sentimentModelVersion?: string;
  relevance?: number;
  publishedAt: string;
  availableAt: string;
  sourceDocumentId?: string;
  sources: EvidenceSourceType[];
  eventId?: string;
}

export interface FundamentalProvider {
  id: string;
  getCompanyProfile?(instrument: InstrumentRef): Promise<RawFundamentalRecord[]>;
  getFinancialStatements?(
    instrument: InstrumentRef,
    range: MiDateRange,
  ): Promise<RawFinancialRecord[]>;
  getCorporateActions?(
    instrument: InstrumentRef,
    range: MiDateRange,
  ): Promise<RawCorporateAction[]>;
}

export interface NewsProvider {
  id: string;
  searchByInstrument?(instrument: InstrumentRef, range: MiDateRange): Promise<RawNewsArticle[]>;
  searchMarketNews?(range: MiDateRange): Promise<RawNewsArticle[]>;
}

export interface CorporateDisclosureProvider {
  id: string;
  getAnnouncements?(
    instrument: InstrumentRef,
    range: MiDateRange,
  ): Promise<RawCorporateDisclosure[]>;
}

export type MiIdentityResolutionStatus =
  | 'RESOLVED'
  | 'IDENTITY_UNRESOLVED'
  | 'IDENTITY_AMBIGUOUS'
  | 'IDENTITY_MISMATCH';

export interface MiIdentityResolution {
  status: MiIdentityResolutionStatus;
  instrument?: InstrumentRef;
  reasonCode?: string;
}

export interface MarketIntelligenceBatchConfiguration {
  universeType: MarketIntelligenceUniverseType;
  /** Required when universeType is CUSTOM. */
  customSymbols?: string[];
  /** Canonical NSE equity membership when universeType is NSE_EQUITY_ALL. */
  nseEquityAllSymbols?: string[];
  analysisPeriod?: AnalysisPeriod;
  analysisResolution?: AnalysisResolution;
  predictionHorizon?: string;
  mode?: IntelligenceBatchMode | 'STANDARD' | 'ADVANCED' | 'CUSTOM';
  /** Explicit feature toggles; when omitted, mode defaults apply. */
  features?: {
    fundamentals?: MiRequirementLevel;
    news?: MiRequirementLevel;
    corporateEvents?: MiRequirementLevel;
  };
  /** Batch as-of timestamp (ISO) for look-ahead checks. */
  asOf?: string;
  newsLookbackDays?: number;
}

export interface MarketIntelligenceRequirements {
  instruments: InstrumentRef[];
  requiredCount: number;
  universeType: MarketIntelligenceUniverseType;
  universeVersion: string;
  fundamentals: MiRequirementLevel;
  news: MiRequirementLevel;
  corporateEvents: MiRequirementLevel;
  newsLookbackDays: number;
  fundamentalRecency: 'latest-available';
  asOf: string;
}

export interface MiDomainCoverage {
  coverage: MiCoverageState;
  freshness: MiFreshnessState;
  eligible: number;
  available: number;
  missing: number;
  required: boolean;
  lastUpdated?: string | null;
  source?: string;
}

export interface MarketIntelligencePreflightResult {
  canRun: boolean;
  requirements: MarketIntelligenceRequirements;
  coverage: {
    fundamentals: MiDomainCoverage;
    news: MiDomainCoverage;
    corporateEvents: MiDomainCoverage;
  };
  blockingReasons: string[];
  warnings: string[];
}

export interface MarketDataPreflightInput {
  canRun: boolean;
  eligible: number;
  quotesAvailable: number;
  historicalAvailable?: number;
  blockingReasons?: string[];
  warnings?: string[];
}

export interface CombinedBatchPreflightResult {
  canRun: boolean;
  marketData: MarketDataPreflightInput;
  marketIntelligence: MarketIntelligencePreflightResult;
  blockingReasons: string[];
  warnings: string[];
}

export interface MarketIntelligenceSnapshot {
  snapshotId: string;
  instrument: InstrumentRef;
  generatedAt: string;
  sourceDataTimestamp?: string;
  fundamentalsSummary?: Record<string, unknown>;
  recentNewsSummary?: Record<string, unknown>;
  corporateEventSummary?: Record<string, unknown>;
  sentimentSummary?: Record<string, unknown>;
  evidenceRefs?: string[];
  providerVersions?: Record<string, string>;
  featureExtractorVersion?: string;
}

/** Per-instrument evidence flags used by MI preflight (no fabrication). */
export interface MiInstrumentEvidenceStatus {
  instrument: InstrumentRef;
  identityStatus: MiIdentityResolutionStatus;
  hasFundamentals: boolean;
  fundamentalsAvailableAt?: string;
  hasNewsInWindow: boolean;
  newsLatestAvailableAt?: string;
  hasCorporateEvents: boolean;
  corporateLatestAvailableAt?: string;
}

/** Normalized corporate event taxonomy (MI-2). */
export type MiCorporateEventType =
  | 'BOARD_MEETING'
  | 'EARNINGS'
  | 'DIVIDEND'
  | 'BUYBACK'
  | 'BONUS'
  | 'SPLIT'
  | 'ORDER_WIN'
  | 'ACQUISITION'
  | 'MANAGEMENT_CHANGE'
  | 'REGULATORY_ACTION'
  | 'OTHER';

/** Data-only coverage report — no PASS/BLOCK. */
export interface MiCoverageReport {
  universeType: MarketIntelligenceUniverseType;
  universeVersion: string;
  asOf: string;
  universe: {
    requested: number;
    resolved: number;
    unresolved: number;
    mismatch: number;
  };
  fundamentals: {
    available: number;
    partial: number;
    unavailable: number;
  };
  corporateEvents: {
    available: number;
    unavailable: number;
  };
  news: {
    instrumentsWithEvidence: number;
    withoutEvidence: number;
  };
  sentiment: {
    scored: number;
    unavailable: number;
  };
  macro: {
    available: boolean;
  };
}

/** MI-3 preflight reason codes (deterministic). */
export type MiPreflightReasonCode =
  | 'MARKET_DATA_INSUFFICIENT'
  | 'HISTORICAL_DATA_INSUFFICIENT'
  | 'FUNDAMENTALS_INSUFFICIENT'
  | 'NEWS_INSUFFICIENT'
  | 'SENTIMENT_UNAVAILABLE'
  | 'CORPORATE_EVENTS_INSUFFICIENT'
  | 'MACRO_UNAVAILABLE'
  | 'STALE_REQUIRED_DATA'
  /** Quote inventory could not be read (MDS error/timeout) — not evidence of zero quotes. */
  | 'QUOTE_INVENTORY_UNAVAILABLE'
  | 'UNIVERSE_IDENTITY_INCOMPLETE'
  | 'IDENTITY_MISMATCH'
  | 'IDENTITY_UNRESOLVED'
  | 'PIT_DATA_EXCLUDED'
  /** ELIGIBLE_SUBSET: the shared historical inventory could not be read. */
  | 'HISTORICAL_INVENTORY_UNAVAILABLE'
  /** ELIGIBLE_SUBSET: per-instrument candle-read failures exceed 2% of the universe. */
  | 'HISTORICAL_FAILURE_THRESHOLD_EXCEEDED'
  /** ELIGIBLE_SUBSET: the fundamentals inventory query failed. */
  | 'FUNDAMENTALS_INVENTORY_UNAVAILABLE'
  /** ELIGIBLE_SUBSET: eligible count or eligible / universe total below the policy minimums. */
  | 'ELIGIBLE_SUBSET_BELOW_MINIMUM'
  /** ELIGIBLE_SUBSET: no instrument passes every required per-instrument check. */
  | 'NO_ELIGIBLE_INSTRUMENTS';

export const READINESS_POLICY_VERSION = 'readiness-policy.v1' as const;

/**
 * Slice G — orthogonal to readiness-policy.v1 and IntelligenceBatchMode.
 * Omit / CURRENT_MARKET keeps STRICT 15m current-market rules unchanged.
 * OFF_SESSION_ANALYSIS must be explicit (never a silent downgrade).
 */
export const ANALYSIS_SESSION_VERSION = 'analysis-session.v1' as const;

export type AnalysisSessionModeId = 'CURRENT_MARKET' | 'OFF_SESSION_ANALYSIS';

export interface AnalysisSessionContract {
  id: AnalysisSessionModeId;
  version: typeof ANALYSIS_SESSION_VERSION;
}

/** Research batches in OFF_SESSION_ANALYSIS are always NON_ACTIONABLE. */
export type AnalysisActionability = 'ACTIONABLE_CANDIDATE' | 'NON_ACTIONABLE';

/**
 * Analysis-facing quote status — timestamps are never rewritten.
 * OFF_SESSION = venue closed + valid prior-session tip (research OK).
 * STALE = venue open + aged beyond STRICT maxAge (integrity failure).
 */
export type AnalysisQuoteDataStatus = 'OFF_SESSION' | 'STALE' | 'CURRENT' | 'UNKNOWN';

export interface AnalysisQuoteProvenance {
  dataStatus: AnalysisQuoteDataStatus;
  /** Source quote/observation timestamp (ms); never mutated to appear fresh. */
  dataAsOfMs: number | null;
  dataAgeMs: number | null;
  venueSessionOpen: boolean;
}

export type ReadinessPolicyId = 'STRICT_ALL' | 'ELIGIBLE_SUBSET';

export type ReadinessPolicyErrorCode =
  | 'READINESS_POLICY_INVALID'
  | 'READINESS_POLICY_UNKNOWN_VERSION'
  | 'READINESS_POLICY_UNKNOWN_ID'
  | 'READINESS_POLICY_MINIMUMS_REQUIRED'
  | 'READINESS_POLICY_UNSUPPORTED_UNIVERSE';

/** HTTP 400 body for an invalid or unsupported readiness policy. */
export interface ReadinessPolicyErrorBody {
  code: ReadinessPolicyErrorCode;
  message: string;
}

/** Batch readiness policy. Absent means STRICT_ALL (unchanged behavior). */
export interface ReadinessPolicy {
  id: ReadinessPolicyId;
  version: typeof READINESS_POLICY_VERSION;
  /** ELIGIBLE_SUBSET only; required, no implicit defaults. */
  minimums?: {
    minEligibleCount: number;
    /** Measured against the full universe, never against the eligible set. */
    minEligibleFraction: number;
  };
}

export type InstrumentReadinessState = 'ELIGIBLE' | 'ANALYZED_NOT_PROMOTABLE' | 'INELIGIBLE';

export interface InstrumentReadinessEligibility {
  symbol: string;
  state: InstrumentReadinessState;
  reasons: string[];
}

export interface ReadinessEligibilitySummary {
  policy: ReadinessPolicy;
  /** Full membership size; never reduced to the eligible set. */
  universeTotal: number;
  eligible: number;
  analyzedNotPromotable: number;
  ineligible: number;
  ineligibleByReason: Record<string, number>;
  instruments: InstrumentReadinessEligibility[];
}

export type MiRequirementMode = 'REQUIRED' | 'OPTIONAL' | 'NOT_APPLICABLE';

export interface MiFreshnessPolicy {
  maxAgeMs?: number;
  mode: 'STRICT' | 'LATEST_AVAILABLE' | 'WINDOWED';
}

export interface BatchPreflightDuration {
  value: number;
  unit: 'D' | 'W' | 'M' | 'Y';
}

export interface BatchPreflightConfiguration {
  universeType: MarketIntelligenceUniverseType;
  customSymbols?: string[];
  nseEquityAllSymbols?: string[];
  /**
   * MI-4 Lock 1: when set, DataRequirementPlan uses this exact membership
   * (same symbols resolved by create) and does not re-resolve from catalog.
   */
  lockedMembershipSymbols?: string[];
  analysisPeriod: BatchPreflightDuration;
  resolution: string;
  predictionHorizon: BatchPreflightDuration;
  mode?: IntelligenceBatchMode | 'STANDARD' | 'ADVANCED' | 'CUSTOM';
  intelligence?: {
    fundamentals?: boolean;
    news?: boolean;
    sentiment?: boolean;
    corporateEvents?: boolean;
    macro?: boolean;
    social?: boolean;
  };
  asOf?: string;
  newsLookbackDays?: number;
  coveragePolicy?: {
    marketData?: { minimumCoverage: number };
    historical?: { minimumCoverage: number };
    fundamentals?: { minimumCoverage: number };
    news?: { minimumCoverage: number };
    sentiment?: { minimumCoverage: number };
    corporateEvents?: { minimumCoverage: number };
    macro?: { minimumCoverage: number };
  };
  /** Absent → STRICT_ALL. */
  readinessPolicy?: ReadinessPolicy;
  /**
   * Absent → CURRENT_MARKET (analysis-session.v1).
   * OFF_SESSION_ANALYSIS must be sent explicitly — never inferred from stale quotes.
   */
  analysisSession?: AnalysisSessionContract;
}

export interface MiCapabilityRequirement {
  mode: MiRequirementMode;
  freshness: MiFreshnessPolicy;
}

export interface DataRequirementPlan {
  universe: {
    type: MarketIntelligenceUniverseType;
    version: string;
    instruments: InstrumentRef[];
    /** Membership size before identity gate. */
    requestedCount: number;
    resolved: InstrumentRef[];
    unresolved: number;
    mismatched: number;
  };
  asOf: string;
  marketData: MiCapabilityRequirement & { required: boolean };
  historical: MiCapabilityRequirement & {
    required: boolean;
    resolution: string;
    start: string;
    end: string;
    minimumBarsPerInstrument: number;
  };
  intelligence: {
    fundamentals: MiCapabilityRequirement;
    news: MiCapabilityRequirement;
    sentiment: MiCapabilityRequirement;
    corporateEvents: MiCapabilityRequirement;
    macro: MiCapabilityRequirement;
    social: MiCapabilityRequirement;
  };
  newsLookbackDays: number;
}

export interface MiReadinessSampleIssue {
  symbol: string;
  issues: string[];
}

export interface MiReadinessResult {
  mode: MiRequirementMode;
  available: number;
  requiredCount: number;
  coverage: MiCoverageState;
  freshness: MiFreshnessState;
  sampleIssues?: MiReadinessSampleIssue[];
  reasonCodes?: MiPreflightReasonCode[];
}

export interface CombinedBatchPreflightV2 {
  /**
   * Current-market trade-path gate (readiness-policy.v1).
   * Always false for OFF_SESSION_ANALYSIS — research uses canAnalyze instead.
   */
  canRun: boolean;
  /**
   * Research gate for OFF_SESSION_ANALYSIS (integrity / coverage, not trade readiness).
   * For CURRENT_MARKET, mirrors canRun when set.
   */
  canAnalyze?: boolean;
  universe: {
    requested: number;
    resolved: number;
    unresolved: number;
    mismatched: number;
  };
  marketData: MiReadinessResult;
  historical: MiReadinessResult;
  intelligence: {
    fundamentals: MiReadinessResult;
    news: MiReadinessResult;
    sentiment: MiReadinessResult;
    corporateEvents: MiReadinessResult;
    macro: MiReadinessResult;
    social: MiReadinessResult;
  };
  blockers: MiPreflightReasonCode[];
  warnings: MiPreflightReasonCode[];
  generatedAt: string;
  asOf: string;
  requirementPlan?: {
    universeType: MarketIntelligenceUniverseType;
    universeVersion: string;
    historicalMinBars: number;
    historicalStart: string;
    historicalEnd: string;
  };
  /** Echo of an explicitly requested policy; absent when none was sent. */
  readinessPolicy?: ReadinessPolicy;
  /** ELIGIBLE_SUBSET only: the STRICT_ALL verdict for the same inputs. */
  strictAll?: { canRun: boolean; blockers: MiPreflightReasonCode[] };
  /** ELIGIBLE_SUBSET only. */
  eligibility?: ReadinessEligibilitySummary;
  /** Echo of resolved analysis-session.v1 (omit ≡ CURRENT_MARKET). */
  analysisSession?: AnalysisSessionContract;
  /** OFF_SESSION_ANALYSIS → always NON_ACTIONABLE. */
  analysisActionability?: AnalysisActionability;
  /** Quote provenance for UI — timestamps preserved. */
  quoteProvenance?: AnalysisQuoteProvenance;
}

/** MI-4 create rejection when Combined Preflight BLOCK. */
export interface PreflightBlockedErrorBody {
  code: 'PREFLIGHT_BLOCKED';
  message: string;
  blockers: MiPreflightReasonCode[];
  combinedPreflight: CombinedBatchPreflightV2;
  /** ELIGIBLE_SUBSET: create rejected because no instrument is eligible; no batch was persisted. */
  outcome?: 'NO_ELIGIBLE_INSTRUMENTS';
}

export const MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION = 'mi-batch-snapshot.v1';

export type MiSentimentAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export interface InstrumentMiNewsItem {
  eventId?: string;
  headline?: string;
  publishedAt: string;
  availableAt: string;
  sentimentScore?: number | null;
  sentimentLabel?: string | null;
  category?: string;
}

export interface InstrumentMiFundamentalFact {
  factId?: string;
  metric: string;
  value: number | null;
  unit?: string | null;
  availableAt: string;
  publishedAt?: string | null;
}

export interface InstrumentMiBundle {
  instrument: InstrumentRef;
  fundamentals: {
    status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
    facts: InstrumentMiFundamentalFact[];
  };
  news: {
    status: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
    items: InstrumentMiNewsItem[];
  };
  corporateEvents: {
    status: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
    items: InstrumentMiNewsItem[];
  };
  sentiment: {
    availability: MiSentimentAvailability;
    score?: number | null;
    label?: string | null;
    modelVersion?: string;
    confidence?: number;
  };
  technical?: {
    status: 'AVAILABLE' | 'UNAVAILABLE';
    source: 'ENGINE_DERIVED';
    rsi?: number;
    ema20?: number;
    ema50?: number;
    ema200?: number;
    macd?: number;
    atr?: number;
    asOf?: number;
  };
}

/** Batch-level PIT MI snapshot (MI-5). Links to BatchDataSnapshot via dataSnapshotVersion. */
export interface MarketIntelligenceBatchSnapshot {
  schemaVersion: typeof MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION;
  snapshotId: string;
  batchId: string;
  dataSnapshotVersion: string;
  asOf: string;
  universeType: MarketIntelligenceUniverseType | string;
  instruments: InstrumentRef[];
  bySymbol: Record<string, InstrumentMiBundle>;
  macro?: {
    available: boolean;
    availableAt?: string;
    publishedAt?: string | null;
  };
  coverage: {
    fundamentalsAvailable: number;
    newsAvailable: number;
    sentimentAvailable: number;
    corporateAvailable: number;
    technicalAvailable: number;
    eligible: number;
  };
  generatedAt: string;
  /**
   * ES-10 — readiness policy frozen onto the MI snapshot when create requested one.
   * Absent on legacy snapshots and when no policy was supplied (STRICT_ALL default).
   * Observe-only lineage; never authorizes Risk / Portfolio / Policy / Gate / execution.
   */
  readinessPolicy?: ReadinessPolicy;
}

/** Additive per-instrument MI+technical context for Generate (feeds IntelligenceSnapshot). */
export interface IntelligenceContext {
  dataSnapshotVersion: string;
  marketIntelligenceSnapshotId: string;
  /** MI-7.1 — optional ref to AdvancedIntelligenceSnapshot (observe-only). */
  advancedIntelligenceSnapshotId?: string;
  /**
   * MI-7.8 — per-symbol advanced row from a batch-loaded AdvancedIntelligenceSnapshot.
   * Never fetched live inside analyzeSymbol.
   */
  advancedIntelligence?: import('./advanced-intelligence').AdvancedInstrumentIntelligence;
  instrument: InstrumentRef;
  asOf: string;
  technical?: InstrumentMiBundle['technical'];
  fundamentals?: InstrumentMiBundle['fundamentals'];
  news?: InstrumentMiBundle['news'];
  sentiment?: InstrumentMiBundle['sentiment'];
  corporateEvents?: InstrumentMiBundle['corporateEvents'];
}
