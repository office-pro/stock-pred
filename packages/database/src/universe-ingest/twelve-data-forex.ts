/**
 * Twelve Data /forex_pairs membership. Never invent FX pairs.
 */

import type { CanonicalUniverseInstrument } from '../canonical-universe-registry';

export const TWELVE_DATA_FOREX_PAIRS_URL = 'https://api.twelvedata.com/forex_pairs';

export interface TwelveDataForexPairRow {
  symbol?: string;
  currency_group?: string;
  currency_base?: string;
  currency_quote?: string;
}

export interface ForexFetchResult {
  source: string;
  sourceUrl: string;
  provider: 'twelve-data';
  rawRecordCount: number;
  instruments: CanonicalUniverseInstrument[];
  rejectedCount: number;
  duplicateCount: number;
  excludedCount: number;
  warnings: string[];
}

function pairParts(symbol: string): { base: string; quote: string } | null {
  const s = String(symbol ?? '')
    .trim()
    .toUpperCase();
  if (!s) return null;
  if (s.includes('/')) {
    const [base, quote] = s.split('/');
    if (!base || !quote) return null;
    return { base, quote };
  }
  if (/^[A-Z]{6}$/.test(s)) return { base: s.slice(0, 3), quote: s.slice(3) };
  return null;
}

export function normalizeTwelveDataForexPairs(payload: {
  data?: TwelveDataForexPairRow[];
}): Omit<ForexFetchResult, 'sourceUrl'> {
  const rows = payload.data ?? [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let rejectedCount = 0;
  const instruments: CanonicalUniverseInstrument[] = [];
  for (const row of rows) {
    const parsed = pairParts(String(row.symbol ?? ''));
    if (!parsed) {
      rejectedCount += 1;
      continue;
    }
    const symbol = `${parsed.base}/${parsed.quote}`;
    if (seen.has(symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(symbol);
    instruments.push({
      symbol,
      name: `${row.currency_base ?? parsed.base} / ${row.currency_quote ?? parsed.quote}`,
      venue: 'TWELVE_DATA',
      series: 'FX',
      isin: null,
      assetClass: 'FX',
      quoteCurrency: parsed.quote,
      canonicalSymbol: symbol,
      provider: 'twelve-data',
      providerAssetId: symbol,
      instrumentType: 'SPOT',
      eligibilityStatus: 'ELIGIBLE',
    });
  }
  return {
    source: 'twelve-data:/forex_pairs',
    provider: 'twelve-data',
    rawRecordCount: rows.length,
    instruments,
    rejectedCount,
    duplicateCount,
    excludedCount: 0,
    warnings: [],
  };
}

export async function fetchForexUniverse(apiKey: string): Promise<ForexFetchResult> {
  const key = String(apiKey ?? '').trim();
  if (!key) {
    throw new Error('TWELVE_DATA_API_KEY is not set');
  }
  const url = `${TWELVE_DATA_FOREX_PAIRS_URL}?apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'stockpred-universe-ingest/1.0' },
  });
  const body = (await res.json().catch(() => null)) as {
    data?: TwelveDataForexPairRow[];
    status?: string;
    message?: string;
  } | null;
  if (!res.ok || body?.status === 'error') {
    throw new Error(
      body?.message ? `forex_pairs failed: ${body.message}` : `forex_pairs HTTP ${res.status}`,
    );
  }
  const normalized = normalizeTwelveDataForexPairs({ data: body?.data ?? [] });
  return { ...normalized, sourceUrl: TWELVE_DATA_FOREX_PAIRS_URL };
}
