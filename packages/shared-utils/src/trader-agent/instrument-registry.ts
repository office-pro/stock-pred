/**
 * Instrument + Provider registries — discover from known repo providers.
 * Provider-specific symbols map only at the boundary; engines use InstrumentRef.
 */

import type {
  AssetClass,
  CapabilityState,
  InstrumentRef,
  ProviderCapability,
  VenueId,
} from '@stockpred/shared-types';
import {
  listRegisteredAdapters,
  resolveAssetAdapter,
  type AdapterAssetHint,
  type AssetAdapter,
} from './asset-adapter';

/** Known MDS providers from apps/market-data-service (do not invent). */
export const DISCOVERED_PROVIDERS: ProviderCapability[] = [
  {
    provider: 'yahoo',
    assetClass: 'EQUITY',
    venue: 'NSE',
    liveQuote: 'PARTIAL',
    historicalCandles: 'AVAILABLE',
    fundamentals: 'PARTIAL',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'yahoo',
    assetClass: 'EQUITY',
    venue: 'BSE',
    liveQuote: 'PARTIAL',
    historicalCandles: 'AVAILABLE',
    fundamentals: 'PARTIAL',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'yahoo',
    assetClass: 'EQUITY',
    venue: 'NASDAQ',
    liveQuote: 'UNAVAILABLE',
    historicalCandles: 'PARTIAL',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'simulated',
    assetClass: 'EQUITY',
    venue: 'NSE',
    /**
     * Dev/test only — never production AVAILABLE.
     * Simulated may fill offline boots and contract tests; it must not satisfy
     * "real provider available" or authorize execution-ready intelligence.
     */
    liveQuote: 'UNAVAILABLE',
    historicalCandles: 'UNAVAILABLE',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'broker-websocket',
    assetClass: 'EQUITY',
    venue: 'NSE',
    liveQuote: 'PARTIAL',
    historicalCandles: 'UNAVAILABLE',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'PARTIAL',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'nse-fundamentals',
    assetClass: 'EQUITY',
    venue: 'NSE',
    liveQuote: 'UNAVAILABLE',
    historicalCandles: 'UNAVAILABLE',
    fundamentals: 'AVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'binance',
    assetClass: 'CRYPTO_SPOT',
    venue: 'BINANCE',
    liveQuote: 'AVAILABLE',
    historicalCandles: 'AVAILABLE',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'binance',
    assetClass: 'CRYPTO_FUTURE',
    venue: 'BINANCE',
    liveQuote: 'AVAILABLE',
    historicalCandles: 'AVAILABLE',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'PARTIAL',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'coingecko',
    assetClass: 'CRYPTO_SPOT',
    venue: 'COINGECKO',
    liveQuote: 'PARTIAL',
    historicalCandles: 'PARTIAL',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'alpha-vantage',
    assetClass: 'COMMODITY',
    venue: 'ALPHA_VANTAGE',
    liveQuote: 'PARTIAL',
    historicalCandles: 'PARTIAL',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'PARTIAL',
  },
  {
    provider: 'eia',
    assetClass: 'COMMODITY',
    venue: 'EIA',
    liveQuote: 'UNAVAILABLE',
    historicalCandles: 'PARTIAL',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'PARTIAL',
  },
  {
    provider: 'mcx',
    assetClass: 'COMMODITY_FUTURE',
    venue: 'MCX',
    liveQuote: 'UNAVAILABLE',
    historicalCandles: 'UNAVAILABLE',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
  {
    provider: 'cme',
    assetClass: 'COMMODITY_FUTURE',
    venue: 'CME',
    liveQuote: 'UNAVAILABLE',
    historicalCandles: 'UNAVAILABLE',
    fundamentals: 'UNAVAILABLE',
    derivatives: 'UNAVAILABLE',
    news: 'UNAVAILABLE',
    macro: 'UNAVAILABLE',
  },
];

export function listProviderCapabilities(filter?: {
  assetClass?: AssetClass;
  venue?: VenueId;
}): ProviderCapability[] {
  return DISCOVERED_PROVIDERS.filter((p) => {
    if (filter?.assetClass && p.assetClass !== filter.assetClass) return false;
    if (filter?.venue && p.venue !== filter.venue) return false;
    return true;
  });
}

export function providerSupports(
  provider: string,
  field: keyof Omit<ProviderCapability, 'provider' | 'assetClass' | 'venue'>,
): CapabilityState {
  const rows = DISCOVERED_PROVIDERS.filter((p) => p.provider === provider);
  if (!rows.length) return 'UNAVAILABLE';
  const states = rows.map((r) => r[field]);
  if (states.every((s) => s === 'AVAILABLE')) return 'AVAILABLE';
  if (states.every((s) => s === 'UNAVAILABLE')) return 'UNAVAILABLE';
  return 'PARTIAL';
}

/** Providers that may exist for offline boots / tests — never production truth. */
export const NON_PRODUCTION_PROVIDERS = new Set(['simulated']);

export function isProductionMarketDataProvider(provider: string): boolean {
  const name = String(provider ?? '')
    .trim()
    .toLowerCase();
  if (!name || NON_PRODUCTION_PROVIDERS.has(name)) return false;
  return DISCOVERED_PROVIDERS.some((p) => p.provider === name);
}

/**
 * Simulated (and other non-production) sources must never establish production
 * DataCapability.AVAILABLE for market/historical/bull-run intelligence.
 */
export function providerMayEstablishProductionCapability(provider: string): boolean {
  return isProductionMarketDataProvider(provider);
}

/** Auth isolation: provider choice never authorizes execution. */
export function providerAuthorizesExecution(_provider: string): false {
  return false;
}

/** Strip Yahoo/provider suffixes at boundary → canonical InstrumentRef. */
export function mapProviderSymbolToInstrument(
  providerSymbol: string,
  hint?: AdapterAssetHint | string | null,
): InstrumentRef {
  const raw = String(providerSymbol ?? '').trim();
  let venueHint: VenueId | undefined;
  let cleaned = raw;
  if (/\.NS$/i.test(raw)) {
    cleaned = raw.replace(/\.NS$/i, '');
    venueHint = 'NSE';
  } else if (/\.BO$/i.test(raw)) {
    cleaned = raw.replace(/\.BO$/i, '');
    venueHint = 'BSE';
  } else if (/\.(US|O|N)$/i.test(raw)) {
    cleaned = raw.replace(/\.(US|O|N)$/i, '');
    hint = hint ?? 'US_EQUITY';
  }
  const adapter = resolveAssetAdapter(cleaned, hint);
  const ref = adapter.resolveInstrument(cleaned, venueHint);
  return { ...ref, canonicalSymbol: ref.canonicalSymbol ?? ref.symbol };
}

/** Identity key for joins — never ticker-only across venues. */
export function instrumentIdentityKey(ref: InstrumentRef): string {
  const month = String(ref.contractMonth ?? ref.expiry ?? '')
    .trim()
    .toUpperCase();
  const contractType = String(ref.contractType ?? '')
    .trim()
    .toUpperCase();
  const providerAssetId = String(ref.providerAssetId ?? ref.canonicalSymbol ?? ref.symbol)
    .trim()
    .toUpperCase();
  return `${ref.venue}|${ref.assetClass}|${providerAssetId}|${contractType}|${month}|${ref.quoteCurrency}`;
}

export function resolveInstrumentWithAdapter(
  symbol: string,
  hint?: AdapterAssetHint | string | null,
): { instrument: InstrumentRef; adapter: AssetAdapter } {
  const adapter = resolveAssetAdapter(symbol, hint);
  const instrument = adapter.resolveInstrument(symbol);
  return { instrument, adapter };
}

export function listInstrumentAdapters(): AssetAdapter[] {
  return listRegisteredAdapters();
}

const NSE_EQUITY_UNIVERSES = new Set([
  'NIFTY50',
  'NIFTY100',
  'NIFTY150',
  'NIFTY500',
  'ALL',
  'NSE_ALL',
  'SECTOR',
]);

/** Adapter hint from frozen InstrumentRef — never default NSE for unknown venues. */
export function adapterHintFromInstrumentRef(ref: InstrumentRef): AdapterAssetHint | null {
  const assetClass = String(ref?.assetClass ?? '')
    .trim()
    .toUpperCase();
  const venue = String(ref?.venue ?? '')
    .trim()
    .toUpperCase();
  if (assetClass === 'CRYPTO_SPOT') return 'CRYPTO_SPOT';
  if (assetClass === 'CRYPTO_FUTURE') return 'CRYPTO_FUTURE';
  if (assetClass === 'COMMODITY') return 'COMMODITY';
  if (assetClass === 'COMMODITY_FUTURE') return 'COMMODITY_FUTURE';
  if (assetClass === 'INDEX_FUTURE') return 'INDEX_FUTURE';
  if (assetClass === 'FX') return 'FOREX';
  if (assetClass === 'OPTION') return null;
  if (assetClass === 'EQUITY' || assetClass === 'INDEX' || assetClass === 'ETF') {
    if (venue === 'NSE') return 'NSE_EQUITY';
    if (venue === 'BSE') return 'BSE_EQUITY';
    if (venue === 'NASDAQ' || venue === 'NYSE' || venue === 'AMEX' || venue === 'US') {
      return 'US_EQUITY';
    }
    return null;
  }
  return null;
}

/** Adapter from frozen InstrumentRef. Null when mapping is unknown — never NSE default. */
export function resolveAdapterFromInstrumentRef(ref: InstrumentRef): AssetAdapter | null {
  const hint = adapterHintFromInstrumentRef(ref);
  if (!hint) return null;
  return resolveAssetAdapter(ref.symbol, hint);
}

/**
 * Adapter hint from multi-asset universe id.
 * Unknown / CUSTOM / SINGLE_STOCK return null — frozen InstrumentRef is required.
 * NSE equity is an explicit universe mapping, not a catch-all default.
 */
export function adapterHintFromUniverse(universe: string): AdapterAssetHint | null {
  const u = String(universe ?? '')
    .trim()
    .toUpperCase();
  if (!u) return null;
  if (u === 'FOREX_ALL' || u.startsWith('FOREX_')) return 'FOREX';
  if (u.startsWith('US_')) return 'US_EQUITY';
  if (u === 'CRYPTO_FUTURES_ALL' || u === 'CRYPTO_FUTURE') return 'CRYPTO_FUTURE';
  if (u.startsWith('CRYPTO_')) return 'CRYPTO_SPOT';
  if (u === 'COMMODITY_ALL') return 'COMMODITY';
  if (u.startsWith('COMMODIT')) return 'COMMODITY_FUTURE';
  if (u === 'MCX_FUTURES_ALL' || u === 'CME_FUTURES_ALL' || u.startsWith('FUTURES_')) {
    return u === 'MCX_FUTURES_ALL' || u === 'CME_FUTURES_ALL' ? 'COMMODITY_FUTURE' : 'INDEX_FUTURE';
  }
  if (u === 'BSE' || u === 'BSE_EQUITY') return 'BSE_EQUITY';
  if (NSE_EQUITY_UNIVERSES.has(u) || u.startsWith('NIFTY')) return 'NSE_EQUITY';
  return null;
}
