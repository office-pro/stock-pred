/**
 * Canonical crypto membership fetchers.
 * CoinGecko = research asset universe. Binance = exchange-tradable spot universe.
 * Never merge the two into one snapshot.
 */

import type { CanonicalUniverseInstrument } from '../canonical-universe-registry';
import {
  classifyCryptoEligibility,
  COINGECKO_QUOTE,
  type CryptoUniverseProvider,
} from './crypto-eligibility';

const BINANCE_EXCHANGE_INFO = 'https://api.binance.com/api/v3/exchangeInfo';
const COINGECKO_MARKETS = 'https://api.coingecko.com/api/v3/coins/markets';
const COINGECKO_PAGE_SIZE = 250;
const COINGECKO_MAX_PAGES = 16;

export interface CryptoFetchResult {
  provider: CryptoUniverseProvider;
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

interface BinanceSymbolRow {
  symbol?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  isSpotTradingAllowed?: boolean;
  permissions?: string[];
}

interface CoinGeckoMarketRow {
  id?: string;
  symbol?: string;
  name?: string;
  current_price?: number | null;
  market_cap?: number | null;
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

export function normalizeBinanceExchangeInfo(payload: {
  symbols?: BinanceSymbolRow[];
}): Omit<CryptoFetchResult, 'sourceUrl'> {
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
    if (!symbol) {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(symbol);
    const spot = row.isSpotTradingAllowed === true || (row.permissions ?? []).includes('SPOT');
    const { status, reason } = classifyCryptoEligibility({
      provider: 'binance',
      providerAssetId: symbol,
      symbol,
      status: row.status,
      tradable: spot,
      baseAsset: row.baseAsset,
      quoteAsset: row.quoteAsset,
    });
    if (status === 'INVALID_IDENTITY') {
      rejectedCount += 1;
      continue;
    }
    if (status !== 'ELIGIBLE') {
      excludedCount += 1;
      continue;
    }
    instruments.push({
      symbol,
      name: `${row.baseAsset}/${row.quoteAsset}`,
      venue: 'BINANCE',
      series: 'SPOT',
      isin: null,
      assetClass: 'CRYPTO_SPOT',
      quoteCurrency: String(row.quoteAsset ?? '').toUpperCase(),
      provider: 'binance',
      providerAssetId: symbol,
      baseAsset: String(row.baseAsset ?? '').toUpperCase(),
      quoteAsset: String(row.quoteAsset ?? '').toUpperCase(),
      instrumentType: 'SPOT',
      eligibilityStatus: 'ELIGIBLE',
      eligibilityReason: reason,
    });
  }
  return {
    provider: 'binance',
    source: 'Binance exchangeInfo spot TRADING USDT/USDC',
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

export function normalizeCoinGeckoMarkets(
  pages: CoinGeckoMarketRow[][],
  opts?: { pageCapReached?: boolean; pageSize?: number },
): Omit<CryptoFetchResult, 'sourceUrl'> {
  const rows = pages.flat();
  const seen = new Set<string>();
  let duplicateCount = 0;
  let rejectedCount = 0;
  let excludedCount = 0;
  const instruments: CanonicalUniverseInstrument[] = [];
  for (const row of rows) {
    const providerAssetId = String(row.id ?? '').trim();
    if (!providerAssetId) {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(providerAssetId)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(providerAssetId);
    const { status, reason } = classifyCryptoEligibility({
      provider: 'coingecko',
      providerAssetId,
      symbol: row.symbol,
      price: row.current_price,
      marketCap: row.market_cap,
    });
    if (status === 'INVALID_IDENTITY') {
      rejectedCount += 1;
      continue;
    }
    if (status !== 'ELIGIBLE') {
      excludedCount += 1;
      continue;
    }
    instruments.push({
      symbol: String(row.symbol ?? providerAssetId).toUpperCase(),
      name: String(row.name ?? providerAssetId),
      venue: 'COINGECKO',
      series: 'SPOT',
      isin: null,
      assetClass: 'CRYPTO_SPOT',
      quoteCurrency: COINGECKO_QUOTE,
      canonicalSymbol: providerAssetId,
      provider: 'coingecko',
      providerAssetId,
      instrumentType: 'SPOT',
      eligibilityStatus: 'ELIGIBLE',
      eligibilityReason: reason,
    });
  }
  const pageSize = opts?.pageSize ?? COINGECKO_PAGE_SIZE;
  const lastPageFull = pages.length > 0 && (pages[pages.length - 1]?.length ?? 0) >= pageSize;
  const incompleteFetch = Boolean(opts?.pageCapReached && lastPageFull);
  return {
    provider: 'coingecko',
    source: 'CoinGecko coins/markets vs_currency=usd (research universe, not broker-tradable)',
    rawRecordCount: rows.length,
    receivedTotal: rows.length,
    pageCount: pages.length,
    providerReportedTotal: incompleteFetch ? rows.length + 1 : rows.length,
    instruments,
    rejectedCount,
    duplicateCount,
    excludedCount,
    warnings: incompleteFetch ? ['coingecko_page_cap_reached'] : [],
    incompleteFetch,
  };
}

export async function fetchCryptoUniverse(
  provider: CryptoUniverseProvider,
): Promise<CryptoFetchResult> {
  if (provider === 'binance') {
    const payload = (await getJson(BINANCE_EXCHANGE_INFO)) as { symbols?: BinanceSymbolRow[] };
    return {
      ...normalizeBinanceExchangeInfo(payload),
      sourceUrl: BINANCE_EXCHANGE_INFO,
    };
  }
  const pages: CoinGeckoMarketRow[][] = [];
  for (let page = 1; page <= COINGECKO_MAX_PAGES; page += 1) {
    const url = `${COINGECKO_MARKETS}?vs_currency=usd&order=market_cap_desc&per_page=${COINGECKO_PAGE_SIZE}&page=${page}&sparkline=false`;
    const rows = (await getJson(url)) as CoinGeckoMarketRow[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    pages.push(rows);
    if (rows.length < COINGECKO_PAGE_SIZE) break;
  }
  return {
    ...normalizeCoinGeckoMarkets(pages, {
      pageCapReached: pages.length >= COINGECKO_MAX_PAGES,
    }),
    sourceUrl: COINGECKO_MARKETS,
  };
}
