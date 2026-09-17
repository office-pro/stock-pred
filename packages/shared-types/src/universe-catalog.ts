import type {
  AssetClass,
  CompletenessStatus,
  DataCapability,
  HorizonDefinition,
  InstrumentRef,
  MultiAssetDataStatus,
  ProviderAuthorityRole,
  UniverseValidationResult,
  VenueId,
} from './instrument';
import type { IntelligenceBatchMode, IntelligenceUniverseId } from './intelligence-batch';

export type UniverseCatalogGroup =
  | 'INDIA'
  | 'US'
  | 'FOREX'
  | 'CRYPTO'
  | 'COMMODITIES'
  | 'FUTURES'
  | 'CUSTOM';
export type UniverseCatalogKind = 'PREDEFINED' | 'CUSTOM' | 'SINGLE_STOCK' | 'SECTOR';

export interface UniverseAnalysisOptions {
  /** Lookback periods (1W/1M/3M/6M/1Y/CUSTOM) — not candle intervals. */
  timeframes: string[];
  analysisPeriods?: import('./instrument').AnalysisPeriod[];
  analysisResolutions?: import('./instrument').AnalysisResolution[];
  horizons: HorizonDefinition[];
  modes: Array<{ id: IntelligenceBatchMode; label: string }>;
  priorities: Array<{ id: string; label: string }>;
}

export interface UniverseAvailability {
  totalEligible: number;
  marketDataAvailable: number;
  live: number;
  delayed: number;
  stale: number;
  historical: number;
  missing: number;
  /** Candle-history coverage when measured; omit when unknown. 0 means none. */
  historicalCandlesAvailable?: number | null;
  historicalAnaloguesAvailable?: number | null;
  bullRunAvailable?: number | null;
  dataAsOf?: number | null;
  dataStatus: MultiAssetDataStatus;
  source?: string;
  universeProvider?: string;
}

export interface UniverseCatalogEntry {
  universeId: IntelligenceUniverseId;
  name: string;
  /** @deprecated use name */
  label?: string;
  description: string;
  group: UniverseCatalogGroup;
  kind: UniverseCatalogKind;
  assetClass: AssetClass;
  venue: VenueId;
  supported: boolean;
  requiresManualInstruments: boolean;
  instrumentCount?: number;
  /** @deprecated use instrumentCount */
  eligibleCount?: number;
  sourceCount?: number;
  rejectedCount?: number;
  duplicateCount?: number;
  excludedCount?: number;
  universeVersion?: string;
  /** @deprecated use universeVersion */
  version?: string;
  membershipSource?: string;
  /** @deprecated use membershipSource */
  source?: string;
  effectiveDate?: string;
  fetchedAt?: number;
  lifecycle?: string;
  validationStatus?: CompletenessStatus;
  ingestionRunId?: string;
  warnings?: string[];
  errors?: string[];
  reasonCode?: string;
  reason?: string;
  /** @deprecated use reason */
  detail?: string;
  scanKind?: string;
  adapterHint?: string;
  capability?: DataCapability;
  dataStatus?: MultiAssetDataStatus;
  availability?: UniverseAvailability;
  analysisOptions?: UniverseAnalysisOptions;
  validation?: UniverseValidationResult;
  universeProvider?: string;
}

export interface CanonicalInstrumentSearchResult {
  instrument: InstrumentRef;
  name: string;
  source: string;
  identityKey: string;
  eligibilityStatus: 'ELIGIBLE';
}

export interface DataSourceStatus {
  id: string;
  label: string;
  capability: string;
  capabilityState: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  dataStatus: MultiAssetDataStatus;
  provider?: string;
  source?: string;
  dataAsOf?: number | string | null;
  dataAgeMs?: number | null;
  authorityRole?: ProviderAuthorityRole;
  fallbackUsed?: boolean;
  productionCertified: boolean;
  runtimeHealthy?: boolean;
  reasonCode?: string;
  reason?: string;
}

export interface MultiAssetReadiness {
  universe: UniverseCatalogEntry;
  dataSources: DataSourceStatus[];
  generatedAt: number;
}
