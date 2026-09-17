/**
 * Asset-class intelligence payloads and observe-only snapshot blocks.
 * Never authorization. Never fill missing with 0 / NEUTRAL.
 */

import type { AssetClass, CapabilityState, SeriesProvenance } from './instrument';

export const BATCH_DATA_SNAPSHOT_VERSION = 'batch-data-snapshot.v1';

/**
 * Named coverage policy for Run Batch — not a market-quality SLA.
 * Default 50%: below on required capabilities → NOT_READY.
 */
export const BATCH_MIN_REQUIRED_COVERAGE_PCT = 50;

export type FundamentalKind =
  | 'EQUITY_STATEMENTS'
  | 'NETWORK_PROJECT'
  | 'COMMODITY_ECONOMICS'
  | 'UNAVAILABLE';

export type EquityStatementsPayload = {
  kind: 'EQUITY_STATEMENTS';
  pe?: number;
  pb?: number;
  roe?: number;
  revenue?: number;
  netIncome?: number;
  asOf?: number;
};

export type NetworkProjectPayload = {
  kind: 'NETWORK_PROJECT';
};

export type CommodityEconomicsPayload = {
  kind: 'COMMODITY_ECONOMICS';
  inventory?: number;
  supply?: number;
  demand?: number;
  asOf?: number;
  seriesId?: string;
};

export type UnavailableFundamentalPayload = {
  kind: 'UNAVAILABLE';
  reasonCode: string;
  message: string;
};

export type FundamentalPayload =
  | EquityStatementsPayload
  | NetworkProjectPayload
  | CommodityEconomicsPayload
  | UnavailableFundamentalPayload;

export type EvidenceSourceKind = 'SOURCE_REPORTED' | 'ENGINE_DERIVED' | 'MODEL_DERIVED';

export interface IntelligenceDerivativesBlock {
  markPrice?: number;
  indexPrice?: number;
  openInterest?: number;
  lastFundingRate?: number;
  /** ENGINE_DERIVED only when mark and index both exist. */
  basis?: number;
  source: EvidenceSourceKind;
  reasonCode?: string;
}

export interface IntelligencePositioningBlock {
  status: CapabilityState;
  liquidations?: number;
  longShortRatio?: number;
  reasonCode?: string;
}

export interface IntelligenceNewsBlock {
  headlineCount?: number;
  asOf?: number;
  reasonCode?: string;
  source?: EvidenceSourceKind;
}

export interface IntelligenceMacroBlock {
  seriesId?: string;
  asOf?: number;
  reasonCode?: string;
  source?: EvidenceSourceKind;
}

/** FinBERT result. Missing sentinel is `null`, never numeric `0`. */
export type BatchSentimentScore = {
  source: 'MODEL_DERIVED';
  score: number;
};

export type BatchSentiment = BatchSentimentScore | null;

export interface BatchMacroSeriesPoint {
  seriesId: string;
  value: number;
  asOf: number;
  source: 'SOURCE_REPORTED';
  provider: 'fred' | 'bls';
}

/** One batch-level macro object. Never per-instrument CPI. */
export interface BatchMacroSnapshot {
  source: 'SOURCE_REPORTED';
  requestedCount: number;
  requestedSeries: string[];
  series: BatchMacroSeriesPoint[];
  asOf?: number;
  reasonCode?: string;
}

export interface IntelligenceCrossAssetBlock {
  relatedSymbols?: string[];
  reasonCode?: string;
}

export interface IntelligenceDataQualityBlock {
  dataStatus?: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'PENDING' | 'FAILED';
  dataAgeMs?: number;
  completeness?: number;
  reasons?: string[];
}

export const EQUITY_ASSET_CLASSES: ReadonlySet<AssetClass> = new Set(['EQUITY', 'ETF', 'INDEX']);

export function fundamentalAllowedForAssetClass(
  assetClass: AssetClass,
  kind: FundamentalKind,
): boolean {
  if (kind === 'UNAVAILABLE') return true;
  if (kind === 'EQUITY_STATEMENTS') return EQUITY_ASSET_CLASSES.has(assetClass);
  if (kind === 'NETWORK_PROJECT')
    return assetClass === 'CRYPTO_SPOT' || assetClass === 'CRYPTO_FUTURE';
  if (kind === 'COMMODITY_ECONOMICS')
    return assetClass === 'COMMODITY' || assetClass === 'COMMODITY_FUTURE';
  return false;
}

export function sanitizeFundamentalPayload(
  assetClass: AssetClass,
  payload: FundamentalPayload | undefined,
): FundamentalPayload | undefined {
  if (!payload) return undefined;
  if (!fundamentalAllowedForAssetClass(assetClass, payload.kind)) {
    return {
      kind: 'UNAVAILABLE',
      reasonCode: 'ASSET_CLASS_MISMATCH',
      message: `${payload.kind} is not valid for ${assetClass}`,
    };
  }
  return payload;
}

export interface BatchQuote {
  price: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  dayHigh?: number;
  dayLow?: number;
  previousClose?: number;
  markPrice?: number;
  indexPrice?: number;
}

export interface BatchCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface BatchDerivatives {
  markPrice?: number;
  indexPrice?: number;
  openInterest?: number;
  lastFundingRate?: number;
  basis?: number;
  source: EvidenceSourceKind;
  missing?: string[];
}

export type BatchInstrumentDataStatus =
  | 'AVAILABLE'
  | 'PARTIAL'
  | 'UNAVAILABLE'
  | 'PENDING'
  | 'FAILED';

export interface BatchInstrumentData {
  instrumentRef: import('./instrument').InstrumentRef;
  quote?: BatchQuote;
  candles?: BatchCandle[];
  fundamentals?: FundamentalPayload;
  derivatives?: BatchDerivatives;
  positioning?: IntelligencePositioningBlock;
  news?: IntelligenceNewsBlock;
  /**
   * `null` = missing / UNAVAILABLE. `{ source: 'MODEL_DERIVED', score }` is a real FinBERT result
   * (genuine near-zero allowed). Numeric `0` is never the missing sentinel.
   */
  sentiment?: BatchSentiment;
  dataStatus: BatchInstrumentDataStatus;
  dataAsOf?: number;
  dataAgeMs?: number;
  provider?: string;
  source?: string;
  seriesProvenance?: SeriesProvenance;
  reasonCode?: string;
  message?: string;
  /** Frozen identity failed universe/ref checks — data-quality only, never analysis. */
  quarantined?: boolean;
  quarantineStatus?: 'IDENTITY_MISMATCH';
  /** Local ENGINE_DERIVED indicators from frozen candles — never TD indicator APIs. */
  technicals?: {
    source: 'ENGINE_DERIVED';
    rsi?: number;
    ema20?: number;
    ema50?: number;
    ema200?: number;
    macd?: number;
    macdSignal?: number;
    macdHistogram?: number;
    atr?: number;
    vwap?: number;
    bollingerUpper?: number;
    bollingerMiddle?: number;
    bollingerLower?: number;
    adx?: number;
    asOf?: number;
  };
}

export type BatchDataReadiness = 'READY' | 'READY_PARTIAL' | 'NOT_READY';

export interface BatchDataReadinessReport {
  readiness: BatchDataReadiness;
  eligible: number;
  processed: number;
  available: number;
  partial: number;
  unavailable: number;
  failed: number;
  pending: number;
  marketDataAvailable: number;
  historicalAvailable: number;
  derivativesAvailable: number;
  requiredCapabilities: string[];
  coveragePct: number;
  minRequiredCoveragePct: number;
  reasons: string[];
}

export interface BatchDataSnapshot {
  schemaVersion: typeof BATCH_DATA_SNAPSHOT_VERSION;
  batchId: string;
  universeId: string;
  universeVersion?: string;
  provider: string;
  providerSelectionReason: string;
  instruments: BatchInstrumentData[];
  dataAsOf: number;
  createdAt: number;
  coverage: BatchDataReadinessReport;
  freshnessPolicyVersion: string;
  dataSnapshotVersion: string;
  frozen: true;
  /** Snapshot-owned Data / Intelligence / Derivatives coverage. */
  capabilityCoverage?: import('./instrument').SnapshotCapabilityCoverageItem[];
  identityCounts?: import('./instrument').BatchIdentityCounts;
  /** Batch-level official macro only — not copied onto each instrument. */
  macro?: BatchMacroSnapshot;
  /** Venue session/calendar from an approved futures feed — never FE clock-derived. */
  marketSession?: import('./instrument').MarketSessionState;
}
