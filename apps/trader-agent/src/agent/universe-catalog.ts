/**
 * Universe catalog + coverage preview for batch UI (trader-agent).
 * Predefined universes resolve membership on the backend — never FE symbol lists.
 */

import {
  isPublishableUniverseSnapshot,
  loadActiveUniverseSnapshot,
  resolveGatedCanonicalUniverse,
  resolveNseAllMembership,
  type CanonicalUniverseId,
  type CanonicalUniverseSnapshot,
} from '@stockpred/database';
import type {
  AssetClass,
  UniverseAnalysisOptions,
  UniverseCatalogEntry,
  UniverseCatalogGroup,
} from '@stockpred/shared-types';
import {
  adapterHintFromUniverse,
  canonicalNiftySnapshot,
  resolveAssetAdapter,
} from '@stockpred/shared-utils';

const BASKET_META: Array<{
  id: 'NIFTY50' | 'NIFTY100' | 'NIFTY150' | 'NIFTY500';
  label: string;
}> = [
  { id: 'NIFTY50', label: 'NIFTY 50' },
  { id: 'NIFTY100', label: 'NIFTY 100' },
  { id: 'NIFTY150', label: 'NIFTY 150' },
  { id: 'NIFTY500', label: 'NIFTY 500' },
];

function gatedPreview(
  id: CanonicalUniverseId,
  group: UniverseCatalogGroup,
  label: string,
  scanKind: string,
  adapterHint: string,
  description: string,
): UniverseCatalogEntry {
  const assetClass: AssetClass =
    id === 'COMMODITY_ALL'
      ? 'COMMODITY'
      : id === 'FOREX_ALL'
        ? 'FX'
        : id === 'CRYPTO_FUTURES_ALL'
          ? 'CRYPTO_FUTURE'
          : id === 'MCX_FUTURES_ALL' || id === 'CME_FUTURES_ALL'
            ? 'COMMODITY_FUTURE'
            : adapterHint === 'CRYPTO_SPOT'
              ? 'CRYPTO_SPOT'
              : adapterHint === 'COMMODITY_FUTURE'
                ? 'COMMODITY_FUTURE'
                : adapterHint === 'INDEX_FUTURE'
                  ? 'INDEX_FUTURE'
                  : adapterHint === 'CRYPTO_FUTURE'
                    ? 'CRYPTO_FUTURE'
                    : 'EQUITY';
  const venue = group === 'US' ? 'US' : group === 'FOREX' ? 'TWELVE_DATA' : group;
  const gated = resolveGatedCanonicalUniverse(id);
  if (!gated.supported || !gated.snapshot) {
    return {
      universeId: id,
      group,
      kind: 'PREDEFINED',
      name: label,
      description,
      assetClass,
      venue,
      requiresManualInstruments: false,
      supported: false,
      reasonCode: gated.reasonCode ?? 'UNSUPPORTED_UNIVERSE',
      reason: gated.detail ?? `Canonical ${label} universe source is not currently configured.`,
      scanKind,
      adapterHint,
      analysisOptions: analysisOptions(id),
    };
  }
  return fromSnapshot(gated.snapshot, group, label, scanKind, adapterHint, description);
}

function analysisOptions(universeId: string): UniverseAnalysisOptions {
  const hint = adapterHintFromUniverse(universeId);
  const adapter = hint ? resolveAssetAdapter('', hint) : null;
  const candidates = ['1D', '3D', '5D', '1W', '1M', '3M', '6M', '1Y'];
  const horizons = adapter
    ? candidates.flatMap((id) => {
        try {
          const def = adapter.resolveHorizon(id).definition;
          return def.kind === 'DURATION' ? [def] : [];
        } catch {
          return [];
        }
      })
    : [];
  return {
    timeframes: ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'],
    analysisPeriods: ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'],
    analysisResolutions: ['1D'],
    horizons,
    modes: [{ id: 'HISTORICAL', label: 'Standard' }],
    priorities: [],
  };
}

function fromSnapshot(
  snapshot: CanonicalUniverseSnapshot,
  group: UniverseCatalogGroup,
  name: string,
  scanKind: string,
  adapterHint: string,
  description?: string,
): UniverseCatalogEntry {
  const universeProvider = snapshot.ingestionRun?.provider ?? snapshot.instruments[0]?.provider;
  return {
    universeId: snapshot.universeId,
    group,
    kind: 'PREDEFINED',
    name,
    description: description ?? `All eligible instruments from the canonical ${name} universe`,
    assetClass:
      snapshot.universeId === 'COMMODITY_ALL'
        ? 'COMMODITY'
        : snapshot.universeId === 'FOREX_ALL' || adapterHint === 'FOREX'
          ? 'FX'
          : snapshot.universeId === 'CRYPTO_FUTURES_ALL' || adapterHint === 'CRYPTO_FUTURE'
            ? 'CRYPTO_FUTURE'
            : adapterHint === 'CRYPTO_SPOT'
              ? 'CRYPTO_SPOT'
              : adapterHint === 'COMMODITY_FUTURE'
                ? 'COMMODITY_FUTURE'
                : adapterHint.includes('FUTURE')
                  ? 'INDEX_FUTURE'
                  : 'EQUITY',
    venue: snapshot.instruments[0]?.venue ?? group,
    requiresManualInstruments: false,
    supported: true,
    instrumentCount: snapshot.eligibleRecordCount,
    sourceCount: snapshot.sourceCount,
    rejectedCount: snapshot.validation.rejectedCount,
    duplicateCount: snapshot.validation.duplicateCount,
    excludedCount: snapshot.validation.excludedCount,
    membershipSource: snapshot.source,
    universeProvider,
    universeVersion: snapshot.version,
    effectiveDate: snapshot.effectiveDate,
    fetchedAt: snapshot.fetchedAt,
    lifecycle: snapshot.lifecycle,
    validationStatus: snapshot.validationStatus,
    ingestionRunId: snapshot.ingestionRun?.runId,
    warnings: snapshot.validation.warnings,
    errors: snapshot.validation.errors,
    validation: snapshot.validation,
    scanKind,
    adapterHint,
    analysisOptions: analysisOptions(snapshot.universeId),
  };
}

function nseAllPreview(): UniverseCatalogEntry {
  try {
    const active = loadActiveUniverseSnapshot('NSE_ALL');
    const snapshot = active ?? resolveNseAllMembership().snapshot;
    if (!isPublishableUniverseSnapshot(snapshot)) {
      throw new Error('Active NSE_ALL snapshot is not PUBLISH/COMPLETE');
    }
    return fromSnapshot(snapshot, 'INDIA', 'NSE ALL', 'FULL_MARKET', 'NSE_EQUITY');
  } catch (err) {
    return {
      universeId: 'NSE_ALL',
      group: 'INDIA',
      kind: 'PREDEFINED',
      name: 'NSE ALL',
      description: 'All eligible NSE equity instruments',
      assetClass: 'EQUITY',
      venue: 'NSE',
      requiresManualInstruments: false,
      supported: false,
      reasonCode: 'UNIVERSE_REFRESH_FAILED',
      reason:
        err instanceof Error
          ? err.message
          : 'Canonical NSE universe source is not currently configured.',
      scanKind: 'FULL_MARKET',
      adapterHint: 'NSE_EQUITY',
    };
  }
}

/** Full catalog for Multi-Asset / Batch Center UI — never invents membership. */
export function listUniverseCatalog(): UniverseCatalogEntry[] {
  const indiaBaskets: UniverseCatalogEntry[] = BASKET_META.map((b) => {
    const snapshot = canonicalNiftySnapshot(b.id);
    return {
      universeId: snapshot.universeId,
      group: 'INDIA' as const,
      kind: 'PREDEFINED' as const,
      name: b.label,
      description: `${b.label} index constituents`,
      assetClass: 'EQUITY' as AssetClass,
      venue: 'NSE',
      requiresManualInstruments: false,
      supported: true,
      instrumentCount: snapshot.symbols.length,
      sourceCount: snapshot.symbols.length,
      membershipSource: snapshot.membershipSource,
      universeVersion: snapshot.version,
      lifecycle: 'PUBLISH',
      validationStatus: 'COMPLETE',
      scanKind: 'FULL_MARKET',
      adapterHint: 'NSE_EQUITY',
      analysisOptions: analysisOptions(b.id),
    };
  });

  return [
    ...indiaBaskets,
    nseAllPreview(),
    {
      universeId: 'SECTOR',
      group: 'INDIA',
      kind: 'SECTOR',
      name: 'Sector',
      description: 'All eligible instruments in a canonical sector snapshot',
      assetClass: 'EQUITY',
      venue: 'NSE',
      requiresManualInstruments: false,
      supported: true,
      reason: 'Choose a backend-provided sector to preview membership.',
      scanKind: 'SECTOR',
      adapterHint: 'NSE_EQUITY',
      analysisOptions: analysisOptions('NIFTY50'),
    },
    {
      universeId: 'SINGLE_STOCK',
      group: 'INDIA',
      kind: 'SINGLE_STOCK',
      name: 'Single Stock',
      description: 'One canonical instrument',
      assetClass: 'EQUITY',
      venue: 'NSE',
      requiresManualInstruments: true,
      supported: true,
      reason: 'Requires exactly one canonical InstrumentRef.',
      scanKind: 'SINGLE_STOCK',
      adapterHint: 'NSE_EQUITY',
      analysisOptions: analysisOptions('NIFTY50'),
    },
    gatedPreview(
      'US_SP500',
      'US',
      'S&P 500',
      'US_SCAN',
      'US_EQUITY',
      'All eligible supported S&P 500 constituents from a versioned source',
    ),
    gatedPreview(
      'US_ALL',
      'US',
      'US All',
      'US_SCAN',
      'US_EQUITY',
      'All eligible supported US instruments from an approved exchange/reference universe',
    ),
    gatedPreview(
      'FOREX_ALL',
      'FOREX',
      'Forex All',
      'FOREX_SCAN',
      'FOREX',
      'FOREX_ALL = eligible FX pairs from Twelve Data /forex_pairs. Membership is not invented.',
    ),
    {
      universeId: 'US_CUSTOM',
      group: 'US',
      kind: 'CUSTOM',
      name: 'US Custom',
      description: 'Legacy custom mode',
      assetClass: 'EQUITY',
      venue: 'US',
      requiresManualInstruments: true,
      supported: true,
      reason: 'Legacy API compatibility only.',
      scanKind: 'US_SCAN',
      adapterHint: 'US_EQUITY',
      analysisOptions: analysisOptions('US_CUSTOM'),
    },
    gatedPreview(
      'CRYPTO_SPOT_ALL',
      'CRYPTO',
      'All eligible supported instruments',
      'CRYPTO_SCAN',
      'CRYPTO_SPOT',
      'CRYPTO_SPOT_ALL (alias CRYPTO_ALL) = eligible crypto spot from one configured provider (Binance or CoinGecko, never merged).',
    ),
    gatedPreview(
      'CRYPTO_FUTURES_ALL',
      'CRYPTO',
      'All eligible supported crypto futures',
      'CRYPTO_SCAN',
      'CRYPTO_FUTURE',
      'CRYPTO_FUTURES_ALL = Binance Futures contracts. BTCUSDT spot ≠ BTCUSDT perpetual ≠ BTCUSD quarterly.',
    ),
    {
      universeId: 'CRYPTO_CUSTOM',
      group: 'CRYPTO',
      kind: 'CUSTOM',
      name: 'Crypto Custom',
      description: 'Legacy custom mode',
      assetClass: 'CRYPTO_SPOT',
      venue: 'CRYPTO',
      requiresManualInstruments: true,
      supported: true,
      reason: 'Legacy API compatibility only.',
      scanKind: 'CRYPTO_SCAN',
      adapterHint: 'CRYPTO_SPOT',
      analysisOptions: analysisOptions('CRYPTO_CUSTOM'),
    },
    gatedPreview(
      'COMMODITY_ALL',
      'COMMODITIES',
      'All eligible supported commodity products',
      'COMMODITIES_SCAN',
      'COMMODITY',
      'COMMODITY_ALL = commodity products/underlyings from a validated Alpha Vantage catalog (EIA for energy history), not NSE companies and not MCX/CME contract months.',
    ),
    {
      universeId: 'COMMODITIES_CUSTOM',
      group: 'COMMODITIES',
      kind: 'CUSTOM',
      name: 'Commodities Custom',
      description: 'Legacy custom mode',
      assetClass: 'COMMODITY',
      venue: 'COMMODITY',
      requiresManualInstruments: true,
      supported: true,
      reason: 'Legacy API compatibility only.',
      scanKind: 'COMMODITIES_SCAN',
      adapterHint: 'COMMODITY',
      analysisOptions: analysisOptions('COMMODITIES_CUSTOM'),
    },
    gatedPreview(
      'MCX_FUTURES_ALL',
      'FUTURES',
      'All eligible supported MCX futures',
      'FUTURES_SCAN',
      'COMMODITY_FUTURE',
      'MCX_FUTURES_ALL is gated until an approved machine-readable delayed feed is verified. Delayed webpages are not scraped.',
    ),
    gatedPreview(
      'CME_FUTURES_ALL',
      'FUTURES',
      'All eligible supported CME futures',
      'FUTURES_SCAN',
      'COMMODITY_FUTURE',
      'CME_FUTURES_ALL is gated until an approved machine-readable delayed/reference source is verified. CME website quotes are reference-only.',
    ),
    gatedPreview(
      'FUTURES_ALL',
      'FUTURES',
      'Generic futures mega-list (unsupported)',
      'FUTURES_SCAN',
      'INDEX_FUTURE',
      'FUTURES_ALL is unsupported. Use CRYPTO_FUTURES_ALL, MCX_FUTURES_ALL, or CME_FUTURES_ALL.',
    ),
    {
      universeId: 'FUTURES_CUSTOM',
      group: 'FUTURES',
      kind: 'CUSTOM',
      name: 'Futures Custom',
      description: 'Legacy custom mode',
      assetClass: 'INDEX_FUTURE',
      venue: 'FUTURES',
      requiresManualInstruments: true,
      supported: true,
      reason: 'Legacy API compatibility only.',
      scanKind: 'FUTURES_SCAN',
      adapterHint: 'INDEX_FUTURE',
      analysisOptions: analysisOptions('FUTURES_CUSTOM'),
    },
    {
      universeId: 'CUSTOM',
      group: 'CUSTOM',
      kind: 'CUSTOM',
      name: 'Custom',
      description: 'User-selected canonical InstrumentRefs',
      assetClass: 'EQUITY',
      venue: 'MULTI',
      requiresManualInstruments: true,
      supported: true,
      reason: 'Select instruments from canonical search results.',
      scanKind: 'CUSTOM',
      adapterHint: 'NSE_EQUITY',
      analysisOptions: analysisOptions('NIFTY50'),
    },
  ];
}

export function getUniverseCoveragePreview(universeId: string): UniverseCatalogEntry | null {
  const id = String(universeId ?? '')
    .trim()
    .toUpperCase();
  const resolved = id === 'CRYPTO_ALL' ? 'CRYPTO_SPOT_ALL' : id;
  return listUniverseCatalog().find((u) => u.universeId === resolved) ?? null;
}
