/**
 * Binance USD-M futures universe — contract identity, not ticker-alone.
 * PERPETUAL ≠ MONTHLY ≠ QUARTERLY. Spot BTCUSDT is a different instrument.
 */

import type { CanonicalUniverseInstrument } from '../canonical-universe-registry';
import type { ContractType } from '@stockpred/shared-types';

const BINANCE_FUTURES_EXCHANGE_INFO = 'https://fapi.binance.com/fapi/v1/exchangeInfo';

export interface CryptoFuturesFetchResult {
  provider: 'binance-futures';
  source: string;
  sourceUrl: string;
  rawRecordCount: number;
  providerReportedTotal?: number;
  receivedTotal: number;
  pageCount: number;
  instruments: CanonicalUniverseInstrument[];
  rejectedCount: number;
  duplicateCount: number;
  excludedCount: number;
  warnings: string[];
  incompleteFetch: boolean;
}

interface BinanceFuturesSymbolRow {
  symbol?: string;
  pair?: string;
  contractType?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  marginAsset?: string;
  deliveryDate?: number;
  onboardDate?: number;
  contractSize?: number;
}

export function mapBinanceFuturesContractType(raw?: string): ContractType | null {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (value === 'PERPETUAL') return 'PERPETUAL';
  if (value.includes('QUARTER')) return 'QUARTERLY';
  if (value.includes('MONTH')) return 'MONTHLY';
  return null;
}

export function deliveryMonth(deliveryDateMs?: number): string | undefined {
  if (deliveryDateMs == null || !Number.isFinite(deliveryDateMs) || deliveryDateMs <= 0) {
    return undefined;
  }
  if (deliveryDateMs >= 253402300799000) return undefined; // Binance perpetual sentinel
  const d = new Date(deliveryDateMs);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() >= 2100) return undefined;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function normalizeBinanceFuturesExchangeInfo(payload: {
  symbols?: BinanceFuturesSymbolRow[];
}): Omit<CryptoFuturesFetchResult, 'sourceUrl'> {
  const rows = payload.symbols ?? [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let rejectedCount = 0;
  let excludedCount = 0;
  const instruments: CanonicalUniverseInstrument[] = [];
  for (const row of rows) {
    const symbol = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    const contractType = mapBinanceFuturesContractType(row.contractType);
    if (!symbol || !row.baseAsset) {
      rejectedCount += 1;
      continue;
    }
    if (!contractType) {
      excludedCount += 1;
      continue;
    }
    if (String(row.status ?? '').toUpperCase() !== 'TRADING') {
      excludedCount += 1;
      continue;
    }
    const month = deliveryMonth(row.deliveryDate);
    const providerAssetId = `${symbol}:${contractType}${month ? `:${month}` : ''}`;
    if (seen.has(providerAssetId)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(providerAssetId);
    instruments.push({
      symbol,
      name: `${row.baseAsset}/${row.quoteAsset} ${contractType}`,
      venue: 'BINANCE',
      series: contractType,
      isin: null,
      assetClass: 'CRYPTO_FUTURE',
      quoteCurrency: String(row.quoteAsset ?? row.marginAsset ?? 'USDT').toUpperCase(),
      provider: 'binance-futures',
      providerAssetId,
      canonicalSymbol: providerAssetId,
      baseAsset: String(row.baseAsset).toUpperCase(),
      quoteAsset: String(row.quoteAsset ?? '').toUpperCase(),
      underlying: String(row.baseAsset).toUpperCase(),
      contractType,
      contractMonth: month,
      expiry: month,
      contractMultiplier: row.contractSize,
      instrumentType: 'FUTURES_CONTRACT',
      eligibilityStatus: 'ELIGIBLE',
      eligibilityReason: 'ACTIVE|BINANCE_FUTURES_TRADING',
    });
  }
  return {
    provider: 'binance-futures',
    source: 'Binance USD-M futures exchangeInfo TRADING contracts',
    rawRecordCount: rows.length,
    receivedTotal: rows.length,
    providerReportedTotal: rows.length,
    pageCount: 1,
    instruments,
    rejectedCount,
    duplicateCount,
    excludedCount,
    warnings: [],
    incompleteFetch: false,
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'stockpred-universe-ingest/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchCryptoFuturesUniverse(): Promise<CryptoFuturesFetchResult> {
  const payload = (await getJson(BINANCE_FUTURES_EXCHANGE_INFO)) as {
    symbols?: BinanceFuturesSymbolRow[];
  };
  return {
    ...normalizeBinanceFuturesExchangeInfo(payload),
    sourceUrl: BINANCE_FUTURES_EXCHANGE_INFO,
  };
}
