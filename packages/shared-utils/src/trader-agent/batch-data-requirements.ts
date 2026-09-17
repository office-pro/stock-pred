/**
 * Per-asset Data Requirement Plan for Run Batch hydration.
 * Optional gaps never force NOT_READY by themselves.
 */

import type { AssetClass } from '@stockpred/shared-types';

export interface DataRequirement {
  capability: string;
  required: boolean;
}

export const BATCH_FRESHNESS_POLICY_VERSION = 'batch-hydrate.v1';
export const BATCH_HYDRATE_CONCURRENCY = 8;
export const COINGECKO_BATCH_SIZE = 50;

export function dataRequirementPlan(assetClass: AssetClass): DataRequirement[] {
  switch (assetClass) {
    case 'EQUITY':
    case 'INDEX':
    case 'ETF':
      return [
        { capability: 'marketData', required: true },
        { capability: 'historicalCandles', required: true },
        { capability: 'fundamentals', required: false },
        { capability: 'news', required: false },
        { capability: 'fno', required: false },
      ];
    case 'CRYPTO_SPOT':
      return [
        { capability: 'marketData', required: true },
        { capability: 'historicalCandles', required: true },
      ];
    case 'CRYPTO_FUTURE':
      return [
        { capability: 'marketData', required: true },
        { capability: 'historicalCandles', required: true },
        { capability: 'derivatives', required: true },
        { capability: 'positioning', required: false },
      ];
    case 'COMMODITY':
      return [
        { capability: 'marketData', required: true },
        { capability: 'historicalCandles', required: false },
        { capability: 'fundamentals', required: false },
      ];
    case 'FX':
      return [
        { capability: 'marketData', required: true },
        { capability: 'historicalCandles', required: true },
      ];
    case 'COMMODITY_FUTURE':
    case 'INDEX_FUTURE':
      return [{ capability: 'marketData', required: true }];
    default:
      return [{ capability: 'marketData', required: true }];
  }
}

export function requiredCapabilitiesForUniverse(
  universeId: string,
  assetClasses: Iterable<AssetClass>,
): string[] {
  const id = String(universeId ?? '').toUpperCase();
  if (id === 'MCX_FUTURES_ALL' || id === 'CME_FUTURES_ALL' || id === 'FUTURES_ALL') {
    return ['marketData'];
  }
  const caps = new Set<string>();
  for (const assetClass of assetClasses) {
    for (const row of dataRequirementPlan(assetClass)) {
      if (row.required) caps.add(row.capability);
    }
  }
  if (caps.size === 0) caps.add('marketData');
  return [...caps];
}

export interface ProviderSelection {
  provider: string;
  reason: string;
}

export interface SelectBatchProviderOpts {
  twelveDataAvailable?: boolean;
  approvedFuturesFeedReady?: boolean;
}

export function selectBatchProvider(
  universeId: string,
  instruments: Array<{ assetClass: AssetClass; venue?: string }>,
  opts: SelectBatchProviderOpts = {},
): ProviderSelection {
  const id = String(universeId ?? '').toUpperCase();
  const td = Boolean(opts.twelveDataAvailable);
  if (id === 'FUTURES_ALL') {
    return { provider: 'none', reason: 'GENERIC_FUTURES_UNSUPPORTED' };
  }
  if (id === 'MCX_FUTURES_ALL' || id === 'CME_FUTURES_ALL') {
    if (opts.approvedFuturesFeedReady) {
      return { provider: 'approved-futures-feed', reason: 'APPROVED_MACHINE_READABLE_FEED' };
    }
    return { provider: 'none', reason: 'NO_APPROVED_MACHINE_READABLE_FEED' };
  }
  const classes = new Set(instruments.map((row) => row.assetClass));
  if (classes.has('CRYPTO_FUTURE')) {
    return { provider: 'binance-futures', reason: 'BINANCE_PUBLIC_REST' };
  }
  if (classes.has('CRYPTO_SPOT')) {
    const venues = new Set(instruments.map((row) => String(row.venue ?? '').toUpperCase()));
    if (venues.has('COINGECKO') && !venues.has('BINANCE')) {
      return { provider: 'coingecko', reason: 'COINGECKO_IDENTITY_BATCHED' };
    }
    if (td) return { provider: 'twelve-data', reason: 'TWELVE_DATA_TIME_SERIES' };
    return { provider: 'binance-spot', reason: 'BINANCE_PREFERRED_CRYPTO_SPOT' };
  }
  if (classes.has('COMMODITY')) {
    return { provider: 'keyless-commodity+eia-bulk', reason: 'TWELVE_DATA_REQUIRES_GROW' };
  }
  if (classes.has('FX') || id === 'FOREX_ALL' || id.startsWith('FOREX_')) {
    if (td) return { provider: 'twelve-data', reason: 'TWELVE_DATA_TIME_SERIES' };
    return { provider: 'none', reason: 'TWELVE_DATA_API_KEY_MISSING' };
  }
  const usEquity = instruments.some((row) => {
    const venue = String(row.venue ?? '').toUpperCase();
    return row.assetClass === 'EQUITY' && venue !== 'NSE' && venue !== 'BSE';
  });
  if (usEquity || id.startsWith('US_')) {
    if (td) return { provider: 'twelve-data', reason: 'TWELVE_DATA_TIME_SERIES' };
    return { provider: 'none', reason: 'TWELVE_DATA_API_KEY_MISSING' };
  }
  return { provider: 'mds', reason: 'EXISTING_QUOTE_CANDLES' };
}

export function universeForcesNotReady(
  universeId: string,
  opts: { approvedFuturesFeedReady?: boolean; feedReasonCode?: string | null } = {},
): string | null {
  const id = String(universeId ?? '').toUpperCase();
  if (id === 'FUTURES_ALL') return 'GENERIC_FUTURES_UNSUPPORTED';
  if (id === 'MCX_FUTURES_ALL' || id === 'CME_FUTURES_ALL') {
    if (opts.approvedFuturesFeedReady) return null;
    if (opts.feedReasonCode) return opts.feedReasonCode;
    return id === 'MCX_FUTURES_ALL'
      ? 'MCX_FUTURES_NO_APPROVED_FEED'
      : 'CME_FUTURES_NO_APPROVED_FEED';
  }
  return null;
}
