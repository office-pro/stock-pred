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
  /** SOURCE_REPORTED network stats — never PE/ROE. */
  provider?: 'mempool' | 'defillama';
  chain?: string;
  hashrate?: number;
  difficulty?: number;
  tvlUsd?: number;
  fees24h?: number;
  asOf?: number;
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
  /** Mapped perpetual identity — required when overlay/futures evidence is attached. */
  sourceInstrument?: string;
  contractType?: string;
  oiTrend?: string;
  fundingExtreme?: boolean;
  basisExpansion?: boolean;
  basisCompression?: boolean;
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

/**
 * On-chain analytics — never a substitute for Binance/CoinGecko/TD spot price.
 * Missing stays UNAVAILABLE; numeric `0` is not the missing sentinel.
 */
export interface IntelligenceOnchainBlock {
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  source: EvidenceSourceKind;
  provider?: 'defillama';
  chain?: string;
  geckoId?: string;
  tvlUsd?: number;
  asOf?: number;
  reasonCode?: string;
}

/**
 * Reddit/social evidence — not truth, not a volume BUY/SELL.
 * Missing stays UNAVAILABLE; numeric `0` is not the missing sentinel.
 * MODEL_DERIVED score only from an injected scorer; unmatched aliases are dropped.
 */
export interface IntelligenceSocialBlock {
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  source: EvidenceSourceKind;
  provider?: 'reddit';
  mentionCount?: number;
  score?: number;
  asOf?: number;
  reasonCode?: string;
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
  provider: 'bls' | 'fed' | 'treasury';
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

/** Observe-only copy of the batch-level macro object onto IntelligenceSnapshot. */
export interface IntelligenceMacroBlock {
  seriesId?: string;
  asOf?: number;
  reasonCode?: string;
  source?: EvidenceSourceKind;
  requestedCount?: number;
  requestedSeries?: string[];
  series?: BatchMacroSeriesPoint[];
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
  /** Copied from MDS at hydrate — never recomputed after freeze. */
  relativeStrengthNifty50?: number | null;
  sector?: string;
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
  /** e.g. BINANCE_FUTURES:BTCUSDT — not the spot instrumentRef. */
  sourceInstrument?: string;
  contractType?: string;
  oiTrend?: string;
  fundingExtreme?: boolean;
  basisExpansion?: boolean;
  basisCompression?: boolean;
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
  /** On-chain analytics. Distinct from quote/candles. Omit or UNAVAILABLE — never fill 0. */
  onchain?: IntelligenceOnchainBlock;
  /** Reddit/social evidence. Distinct from news FinBERT `sentiment`. Omit or UNAVAILABLE — never fill 0. */
  social?: IntelligenceSocialBlock;
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
  /**
   * Batch-global + shared-but-asset-specific reference data.
   * Immutable after freeze. Instruments must map provenance before consume.
   */
  shared?: BatchSharedData;
  /** Observe-only hydrate/finalize timings. Not a trading input. */
  performance?: BatchPerformanceCounters;
}

/** Shared-but-asset-specific series (NIFTY, BTC index). Not owned by every instrument. */
export interface BatchBenchmarkSeries {
  symbol: string;
  timeframe: string;
  candles: BatchCandle[];
  dataAsOf: number;
  source: string;
  provider: string;
}

/**
 * Batch-global vs shared-but-asset-specific reference.
 * `macro` / session / shared GDELT are batch-global.
 * Benchmarks and derivatives reference require identity mapping per instrument.
 */
export interface BatchSharedData {
  benchmarks?: Record<string, BatchBenchmarkSeries>;
  macro?: BatchMacroSnapshot;
  marketReference?: {
    session?: import('./instrument').MarketSessionState;
  };
  derivativesReference?: {
    provider?: string;
    source?: string;
  };
  newsReference?: {
    source?: string;
    queryCount?: number;
    articleCount?: number;
  };
  networkReference?: {
    source?: string;
  };
  providerSnapshots?: Record<string, { source: string; asOf: number }>;
}

export interface BatchPerformanceCounters {
  totalTimeMs?: number;
  requestCount?: number;
  cacheHitCount?: number;
  cacheMissCount?: number;
  timeoutCount?: number;
  retryCount?: number;
  duplicateRequestsPrevented?: number;
  /** Must be 0 after snapshot.frozen. External provider HTTP only. */
  postFreezeProviderRequestCount?: number;
  benchmarkFetchMs?: number;
  macroFetchMs?: number;
  newsFetchMs?: number;
}
