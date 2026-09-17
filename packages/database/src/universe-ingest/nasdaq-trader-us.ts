/**
 * NASDAQ Trader official symbol directories — machine-readable listing files.
 * Source of US_ALL membership. Not EDGAR fundamentals. Not an invented ticker list.
 *
 * https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt
 * https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt
 */

import type { CanonicalUniverseInstrument } from '../canonical-universe-registry';

export const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
export const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

export interface UsListingFetchResult {
  source: string;
  sourceUrl: string;
  rawRecordCount: number;
  instruments: CanonicalUniverseInstrument[];
  rejectedCount: number;
  duplicateCount: number;
  excludedCount: number;
  warnings: string[];
}

function parsePipeTable(text: string): Record<string, string>[] {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, '').trimEnd())
    .filter((line) => line.length > 0 && !/^File Creation Time/i.test(line));
  if (lines.length < 2) return [];
  const headers = lines[0]!.split('|').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('|');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cols[index] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function yes(value: string | undefined): boolean {
  return (
    String(value ?? '')
      .trim()
      .toUpperCase() === 'Y'
  );
}

function classifyUsRow(input: { symbol: string; testIssue: string; etf: string }): {
  status: 'ELIGIBLE' | 'EXCLUDED' | 'INVALID_IDENTITY';
  reason: string;
} {
  if (!input.symbol || !/^[A-Z][A-Z0-9./-]{0,14}$/.test(input.symbol)) {
    return { status: 'INVALID_IDENTITY', reason: 'invalid_us_symbol' };
  }
  if (yes(input.testIssue)) {
    return { status: 'EXCLUDED', reason: 'test_issue' };
  }
  if (yes(input.etf)) {
    return { status: 'ELIGIBLE', reason: 'listed_etf' };
  }
  return { status: 'ELIGIBLE', reason: 'listed_equity' };
}

function venueFromOtherExchange(code: string): string {
  const c = code.trim().toUpperCase();
  if (c === 'N') return 'NYSE';
  if (c === 'A') return 'AMEX';
  if (c === 'P') return 'NYSE_ARCA';
  if (c === 'Z') return 'BATS';
  if (c === 'V') return 'IEX';
  return c || 'US';
}

export function normalizeNasdaqListed(text: string): Omit<UsListingFetchResult, 'sourceUrl'> {
  const rows = parsePipeTable(text);
  const seen = new Set<string>();
  let duplicateCount = 0;
  let rejectedCount = 0;
  let excludedCount = 0;
  const instruments: CanonicalUniverseInstrument[] = [];
  for (const row of rows) {
    const symbol = String(row.Symbol ?? '')
      .trim()
      .toUpperCase();
    const etf = row.ETF ?? '';
    const testIssue = row['Test Issue'] ?? '';
    const cls = classifyUsRow({ symbol, testIssue, etf });
    if (cls.status === 'INVALID_IDENTITY') {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(symbol);
    if (cls.status !== 'ELIGIBLE') {
      excludedCount += 1;
      continue;
    }
    instruments.push({
      symbol,
      name: String(row['Security Name'] ?? symbol).trim(),
      venue: 'NASDAQ',
      series: yes(etf) ? 'ETF' : 'EQ',
      isin: null,
      assetClass: yes(etf) ? 'ETF' : 'EQUITY',
      quoteCurrency: 'USD',
      provider: 'nasdaq-trader',
      providerAssetId: symbol,
      canonicalSymbol: symbol,
      instrumentType: 'EQUITY',
      eligibilityStatus: 'ELIGIBLE',
      eligibilityReason: cls.reason,
    });
  }
  return {
    source: 'nasdaq-trader-nasdaqlisted',
    rawRecordCount: rows.length,
    instruments,
    rejectedCount,
    duplicateCount,
    excludedCount,
    warnings: rows.length === 0 ? ['nasdaqlisted_empty'] : [],
  };
}

export function normalizeOtherListed(text: string): Omit<UsListingFetchResult, 'sourceUrl'> {
  const rows = parsePipeTable(text);
  const seen = new Set<string>();
  let duplicateCount = 0;
  let rejectedCount = 0;
  let excludedCount = 0;
  const instruments: CanonicalUniverseInstrument[] = [];
  for (const row of rows) {
    const symbol = String(row['ACT Symbol'] ?? row['NASDAQ Symbol'] ?? '')
      .trim()
      .toUpperCase();
    const etf = row.ETF ?? '';
    const testIssue = row['Test Issue'] ?? '';
    const cls = classifyUsRow({ symbol, testIssue, etf });
    if (cls.status === 'INVALID_IDENTITY') {
      rejectedCount += 1;
      continue;
    }
    if (seen.has(symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(symbol);
    if (cls.status !== 'ELIGIBLE') {
      excludedCount += 1;
      continue;
    }
    instruments.push({
      symbol,
      name: String(row['Security Name'] ?? symbol).trim(),
      venue: venueFromOtherExchange(row.Exchange ?? ''),
      series: yes(etf) ? 'ETF' : 'EQ',
      isin: null,
      assetClass: yes(etf) ? 'ETF' : 'EQUITY',
      quoteCurrency: 'USD',
      provider: 'nasdaq-trader',
      providerAssetId: symbol,
      canonicalSymbol: symbol,
      instrumentType: 'EQUITY',
      eligibilityStatus: 'ELIGIBLE',
      eligibilityReason: cls.reason,
    });
  }
  return {
    source: 'nasdaq-trader-otherlisted',
    rawRecordCount: rows.length,
    instruments,
    rejectedCount,
    duplicateCount,
    excludedCount,
    warnings: rows.length === 0 ? ['otherlisted_empty'] : [],
  };
}

export function mergeUsListings(
  nasdaq: ReturnType<typeof normalizeNasdaqListed>,
  other: ReturnType<typeof normalizeOtherListed>,
): Omit<UsListingFetchResult, 'sourceUrl'> {
  const seen = new Set<string>();
  const instruments: CanonicalUniverseInstrument[] = [];
  let duplicateCount = nasdaq.duplicateCount + other.duplicateCount;
  for (const row of [...nasdaq.instruments, ...other.instruments]) {
    if (seen.has(row.symbol)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(row.symbol);
    instruments.push(row);
  }
  instruments.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    source: 'nasdaq-trader-symbol-directory',
    rawRecordCount: nasdaq.rawRecordCount + other.rawRecordCount,
    instruments,
    rejectedCount: nasdaq.rejectedCount + other.rejectedCount,
    duplicateCount,
    excludedCount: nasdaq.excludedCount + other.excludedCount,
    warnings: [...nasdaq.warnings, ...other.warnings],
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain,*/*',
      'User-Agent': 'stockpred-universe-ingest/1.0',
    },
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return response.text();
}

export async function fetchUsEquityUniverse(): Promise<UsListingFetchResult> {
  const [nasdaqText, otherText] = await Promise.all([
    fetchText(NASDAQ_LISTED_URL),
    fetchText(OTHER_LISTED_URL),
  ]);
  const nasdaq = normalizeNasdaqListed(nasdaqText);
  const other = normalizeOtherListed(otherText);
  const merged = mergeUsListings(nasdaq, other);
  return {
    ...merged,
    sourceUrl: `${NASDAQ_LISTED_URL} + ${OTHER_LISTED_URL}`,
  };
}
