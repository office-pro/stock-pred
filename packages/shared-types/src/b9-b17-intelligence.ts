/**
 * B9–B17 Professional Trader Intelligence — advisory contracts only.
 * Never rankingScore, authorization, positionSize, gateVerdict, or broker orders.
 * Missing / insufficient data → UNAVAILABLE or UNKNOWN — never fabricated 0/NEUTRAL.
 */

import type { SessionReturn1dStatus } from './market';

export type IntelligenceAvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export type IntelligenceUnavailableReason =
  | 'INSUFFICIENT_HISTORY'
  | 'MISSING_INPUT'
  | 'STALE_DATA'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PARTIAL_UNIVERSE'
  | 'NO_COMPARABLE_EVENTS'
  | 'INVALID_PAYLOAD';

export interface IntelligenceProvenance {
  dataAsOf?: number | string | null;
  receivedAt?: number | string | null;
  analysisAt: number | string;
  dataAgeMs?: number | null;
  source: string;
  dataStatus?: string;
  modelVersion?: string;
  featureVersion?: string;
  sampleSize?: number;
  engineVersion: string;
}

export interface UnavailableIntelligence {
  status: 'UNAVAILABLE';
  reason: IntelligenceUnavailableReason;
  message?: string;
  provenance: IntelligenceProvenance;
}

/** B9 sector state (advisory — never sorts opportunities). */
export type SectorState = 'LEADING' | 'IMPROVING' | 'WEAKENING' | 'LAGGING' | 'UNKNOWN';

export interface SectorMemberSnapshot {
  symbol: string;
  return1d?: number | null;
  /** ~1 week (trading sessions) */
  return5d?: number | null;
  /** ~15 trading sessions */
  return15d?: number | null;
  /** ~1 month (trading sessions) */
  return20d?: number | null;
  /** ~3 months */
  return60d?: number | null;
  /** ~6 months */
  return126d?: number | null;
  /** ~1 year */
  return252d?: number | null;
  relativeStrength?: number | null;
  /** Observed current-session 1D freshness for this member (when computed). */
  sessionReturnStatus?: SessionReturn1dStatus | null;
  sessionDate?: string | null;
}

/** Coverage of observed current-session 1D across sector members. */
export interface SectorSessionCoverage {
  live: number;
  delayed: number;
  priorSession: number;
  closedMarket: number;
  stale: number;
  unavailable: number;
  newestDataAt?: number | null;
  oldestDataAt?: number | null;
}

export interface SectorIntelligenceSnapshot {
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  reason?: IntelligenceUnavailableReason;
  sector: string;
  industry?: string | null;
  subIndustry?: string | null;
  return1d?: number | null;
  /** ~1 week (trading sessions) */
  return5d?: number | null;
  /** ~15 trading sessions */
  return15d?: number | null;
  /** ~1 month (trading sessions) */
  return20d?: number | null;
  /** ~3 months */
  return60d?: number | null;
  /** ~6 months */
  return126d?: number | null;
  /** ~1 year */
  return252d?: number | null;
  breadthAdvancing?: number | null;
  breadthDeclining?: number | null;
  breadthUnchanged?: number | null;
  relativeStrength?: number | null;
  momentum?: number | null;
  volatility?: number | null;
  /** Equal-weighted sector index points (normalized ~100 at start), for sparklines. */
  trendSeries?: number[];
  /** Optional fundamentals enrichment when available. */
  medianPe?: number | null;
  medianPb?: number | null;
  state: SectorState;
  leaders: SectorMemberSnapshot[];
  laggards: SectorMemberSnapshot[];
  coverageSymbols: number;
  memberCount?: number;
  /** IST YYYY-MM-DD of the tip used for aggregate 1D (modal / newest). */
  sessionDate?: string | null;
  /** Aggregate freshness for observed 1D (not wall-clock). */
  dataStatus?: SessionReturn1dStatus | null;
  sessionCoverage?: SectorSessionCoverage;
  provenance: IntelligenceProvenance;
}

/** B10 bull-run horizons (evidence-calibrated, not a new ML train). */
export type BullRunHorizon = 'W1_4' | 'M1_3' | 'M3_6' | 'M6_12' | 'Y1_3';

export type BullRunStage =
  | 'EARLY'
  | 'ACCELERATING'
  | 'CONFIRMED'
  | 'MATURE'
  | 'WEAKENING'
  | 'FAILED'
  | 'UNKNOWN';

export interface BullRunHorizonAssessment {
  horizon: BullRunHorizon;
  /** Only when evidence sufficient — never synthetic. */
  bullRunProbability?: number | null;
  expectedReturnRange?: { low: number; high: number } | null;
  expectedDrawdownRange?: { low: number; high: number } | null;
  confidence?: number | null;
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
}

export interface BullRunIntelligenceSnapshot {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  stage: BullRunStage;
  horizons: BullRunHorizonAssessment[];
  evidence: string[];
  invalidation?: string[];
  provenance: IntelligenceProvenance;
}

/** B11 relationships — correlation only, never causation. */
export type RelationshipPairKind =
  | 'STOCK_STOCK'
  | 'STOCK_SECTOR'
  | 'STOCK_INDEX'
  | 'SECTOR_SECTOR'
  | 'STOCK_ASSET'
  | 'SECTOR_ASSET'
  | 'STOCK_GLOBAL';

export interface RelationshipMetrics {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  kind: RelationshipPairKind;
  left: string;
  right: string;
  pearson?: number | null;
  spearman?: number | null;
  rollingPearson?: number | null;
  upsideCorrelation?: number | null;
  downsideCorrelation?: number | null;
  beta?: number | null;
  conditionalBeta?: number | null;
  stability?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  sampleSize: number;
  windowDays: number;
  note: string;
  provenance: IntelligenceProvenance;
}

export interface LeadLagRelationship {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  leadSymbol: string;
  lagSymbol: string;
  lagDays: 1 | 2 | 5 | 10;
  relationshipStrength?: number | null;
  sampleSize: number;
  stability?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  marketRegime?: string | null;
  note: string;
  provenance: IntelligenceProvenance;
}

/** B12 inverse / beneficiary — event-based, not permanent labels. */
export type InverseRelationshipClass =
  | 'DIRECT_INVERSE'
  | 'CONDITIONAL_INVERSE'
  | 'RELATIVE_BENEFICIARY'
  | 'DEFENSIVE'
  | 'SECTOR_ROTATION'
  | 'LEAD_LAG'
  | 'UNSTABLE'
  | 'NO_STABLE_RELATIONSHIP';

export interface BeneficiaryCandidate {
  symbol: string;
  positiveResponseRate?: number | null;
  medianResponse?: number | null;
  sampleSize: number;
  stability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  classification: InverseRelationshipClass;
}

export interface InverseBeneficiarySnapshot {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  anchorSymbol: string;
  downsideThresholdPct: number;
  beneficiaries: BeneficiaryCandidate[];
  provenance: IntelligenceProvenance;
}

/** B13 historical event outcomes. */
export interface HistoricalHorizonOutcome {
  horizonDays: 5 | 10 | 20 | 60 | 120 | 252;
  positiveRate?: number | null;
  medianReturn?: number | null;
  medianDrawdown?: number | null;
  medianRecoveryDays?: number | null;
  sampleSize: number;
}

export interface HistoricalEventIntelligence {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  eventDescription: string;
  comparableEvents: number;
  outcomes: HistoricalHorizonOutcome[];
  provenance: IntelligenceProvenance;
}

/** B14 cross-asset. */
export interface CrossAssetRelationship {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  left: string;
  asset: string;
  pearson?: number | null;
  beta?: number | null;
  sampleSize: number;
  windowDays: number;
  provenance: IntelligenceProvenance;
}

/** B15 F&O — provider optional. */
export interface FnoIntelligenceSnapshot {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  symbol: string;
  openInterest?: number | null;
  oiChange?: number | null;
  volume?: number | null;
  iv?: number | null;
  ivChange?: number | null;
  pcr?: number | null;
  futuresBasis?: number | null;
  provenance: IntelligenceProvenance;
}

/** B17 US/Global → India. */
export type GlobalEventImportance = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type GlobalImpactDirection = 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';

export interface GlobalEventSectorImpact {
  sector: string;
  impact: GlobalImpactDirection;
  note?: string;
}

export interface GlobalEventStockImpact {
  symbol: string;
  impact: GlobalImpactDirection;
  exposureNote?: string;
}

export interface GlobalEventIntelligence {
  status: IntelligenceAvailabilityStatus;
  reason?: IntelligenceUnavailableReason;
  eventId: string;
  eventType: string;
  country?: string | null;
  eventTime?: string | null;
  source: string;
  importance: GlobalEventImportance;
  actual?: string | number | null;
  consensus?: string | number | null;
  previous?: string | number | null;
  surprise?: string | null;
  direction?: GlobalImpactDirection;
  affectedAssets: string[];
  affectedSectors: GlobalEventSectorImpact[];
  affectedStocks: GlobalEventStockImpact[];
  historicalNote?: string | null;
  provenance: IntelligenceProvenance;
}

/** Batch scan kinds (B9–B17) — see IntelligenceScanKind in intelligence-batch.ts. */
