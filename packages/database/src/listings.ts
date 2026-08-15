import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Exchange, MarketIndex } from '@stockpred/shared-types';
import type { PrismaClient } from '@prisma/client';
import type { UniverseStock } from './universe';

const NSE_HOME = 'https://www.nseindia.com/';
const NSE_EQUITY_CSV = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';
const NSE_EQUITY_CSV_ALT = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv';
const BSE_SCRIP_API =
  'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?segment=Equity&status=Active';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/csv,application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface ListedEquity {
  symbol: string;
  name: string;
  exchange: Exchange;
  isin: string | null;
  series: string;
  bseCode: string | null;
  yahooSymbol: string;
  sector: string;
  indices: MarketIndex[];
  listingDate: string | null;
}

export interface EquityMasterFile {
  updatedAt: string;
  source: string;
  stocks: ListedEquity[];
}

/** Fake tickers previously generated to pad the universe to 5000+. */
export function isPlaceholderSymbol(symbol: string): boolean {
  return /^(NOM|BSE)\d{3,}$/i.test(symbol);
}

export function equityMasterPath(): string {
  return join(__dirname, '..', 'data', 'equity-master.json');
}

export function loadEquityMaster(): ListedEquity[] {
  const path = equityMasterPath();
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as EquityMasterFile;
  return (parsed.stocks ?? []).filter((row) => !isPlaceholderSymbol(row.symbol));
}

function db(): PrismaClient {
  // Lazy require avoids index.ts <-> listings.ts import cycle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./index').getPrismaClient() as PrismaClient;
}

export function listedToUniverse(row: ListedEquity): UniverseStock {
  return {
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    sector: row.sector || 'Unknown',
    indices: row.indices ?? [],
    basePrice: 0,
    isin: row.isin,
    bseCode: row.bseCode,
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] ?? '';
    });
    return row;
  });
}

async function fetchText(url: string, extra?: Record<string, string>): Promise<string> {
  const response = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...extra },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  return response.text();
}

async function nseCookieHeader(): Promise<string> {
  try {
    const home = await fetch(NSE_HOME, { headers: BROWSER_HEADERS, redirect: 'follow' });
    const cookies =
      typeof home.headers.getSetCookie === 'function' ? home.headers.getSetCookie() : [];
    if (cookies.length > 0) {
      return cookies.map((c) => c.split(';')[0]).join('; ');
    }
    const raw = home.headers.get('set-cookie');
    return raw
      ? raw
          .split(',')
          .map((c) => c.split(';')[0])
          .join('; ')
      : '';
  } catch {
    return '';
  }
}

export async function downloadNseEquityList(): Promise<ListedEquity[]> {
  const cookie = await nseCookieHeader();
  const extra: Record<string, string> = { Referer: NSE_HOME };
  if (cookie) extra.Cookie = cookie;
  let text = '';
  try {
    text = await fetchText(NSE_EQUITY_CSV, extra);
  } catch {
    text = await fetchText(NSE_EQUITY_CSV_ALT, extra);
  }
  const rows = parseCsv(text);
  const listed: ListedEquity[] = [];
  for (const row of rows) {
    const series = (row['SERIES'] ?? row['Series'] ?? '').trim().toUpperCase();
    if (series !== 'EQ') continue;
    const symbol = (row['SYMBOL'] ?? row['Symbol'] ?? '').trim().toUpperCase();
    const name = (row['NAME OF COMPANY'] ?? row['NAME_OF_COMPANY'] ?? symbol).trim();
    const isin = (row['ISIN NUMBER'] ?? row['ISIN'] ?? '').trim() || null;
    if (isin && !isin.startsWith('INE')) continue;
    if (!symbol || isPlaceholderSymbol(symbol)) continue;
    listed.push({
      symbol,
      name,
      exchange: Exchange.NSE,
      isin,
      series: 'EQ',
      bseCode: null,
      yahooSymbol: `${symbol}.NS`,
      sector: 'Unknown',
      indices: [],
      listingDate: (row['DATE OF LISTING'] ?? '').trim() || null,
    });
  }
  return listed;
}

interface BseScripRow {
  SCRIP_CD?: string | number;
  Scrip_Name?: string;
  scrip_id?: string;
  ISIN_NUMBER?: string;
  GROUP?: string;
  Status?: string;
  INDUSTRY?: string;
}

export async function downloadBseEquityList(): Promise<ListedEquity[]> {
  const text = await fetchText(BSE_SCRIP_API, { Referer: 'https://www.bseindia.com/' });
  let payload: BseScripRow[] = [];
  try {
    const parsed = JSON.parse(text) as BseScripRow[] | { Table?: BseScripRow[] };
    payload = Array.isArray(parsed) ? parsed : (parsed.Table ?? []);
  } catch {
    throw new Error('BSE scrip API did not return JSON');
  }
  const listed: ListedEquity[] = [];
  for (const row of payload) {
    const group = String(row.GROUP ?? '')
      .trim()
      .toUpperCase();
    if (group && !['A', 'B', 'T', 'X', 'XT', 'Z', 'ZP'].includes(group)) continue;
    const symbol = String(row.scrip_id ?? '')
      .trim()
      .toUpperCase();
    const bseCode = String(row.SCRIP_CD ?? '').trim();
    if (!symbol || isPlaceholderSymbol(symbol)) continue;
    const isin = String(row.ISIN_NUMBER ?? '').trim() || null;
    if (isin && !isin.startsWith('INE')) continue;
    const name = String(row.Scrip_Name ?? symbol).trim();
    if (/\b(FUND|ETF|MUTUAL FUND|SEGREGATED PORTFOLIO)\b/i.test(name)) continue;
    listed.push({
      symbol,
      name,
      exchange: Exchange.BSE,
      isin,
      series: group || 'EQ',
      bseCode: bseCode || null,
      yahooSymbol: `${symbol}.BO`,
      sector: String(row.INDUSTRY ?? 'Unknown').trim() || 'Unknown',
      indices: [],
      listingDate: null,
    });
  }
  return listed;
}

/** NSE is primary; BSE-only names are kept; dual-listed merge by ISIN. */
export function mergeListings(nse: ListedEquity[], bse: ListedEquity[]): ListedEquity[] {
  const byIsin = new Map<string, ListedEquity>();
  const bySymbol = new Map<string, ListedEquity>();

  for (const row of nse) {
    bySymbol.set(row.symbol, row);
    if (row.isin) byIsin.set(row.isin, row);
  }

  for (const row of bse) {
    const existing = (row.isin && byIsin.get(row.isin)) || bySymbol.get(row.symbol);
    if (existing) {
      existing.bseCode = existing.bseCode ?? row.bseCode;
      if (existing.sector === 'Unknown' && row.sector !== 'Unknown') {
        existing.sector = row.sector;
      }
      continue;
    }
    bySymbol.set(row.symbol, row);
    if (row.isin) byIsin.set(row.isin, row);
  }

  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function saveEquityMaster(stocks: ListedEquity[], source: string): string {
  const dir = join(__dirname, '..', 'data');
  mkdirSync(dir, { recursive: true });
  const path = equityMasterPath();
  const payload: EquityMasterFile = {
    updatedAt: new Date().toISOString(),
    source,
    stocks,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
  return path;
}

export async function upsertListings(stocks: ListedEquity[]): Promise<number> {
  const prisma = db();
  let count = 0;
  for (const stock of stocks) {
    await prisma.stock.upsert({
      where: { symbol: stock.symbol },
      update: {
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        isin: stock.isin,
        series: stock.series,
        bseCode: stock.bseCode,
        yahooSymbol: stock.yahooSymbol,
        listed: true,
      },
      create: {
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        indices: stock.indices,
        isin: stock.isin,
        series: stock.series,
        bseCode: stock.bseCode,
        yahooSymbol: stock.yahooSymbol,
        listed: true,
      },
    });
    count += 1;
  }
  return count;
}

export async function deletePlaceholderStocks(): Promise<number> {
  const prisma = db();
  const placeholders = await prisma.stock.findMany({
    where: { OR: [{ symbol: { startsWith: 'NOM' } }, { symbol: { startsWith: 'BSE' } }] },
    select: { symbol: true },
  });
  const symbols = placeholders
    .map((row) => row.symbol)
    .filter((symbol) => isPlaceholderSymbol(symbol));
  if (symbols.length === 0) return 0;

  await prisma.patternOccurrence.deleteMany({ where: { symbol: { in: symbols } } });
  await prisma.pattern.deleteMany({ where: { symbol: { in: symbols } } });
  await prisma.signal.deleteMany({ where: { symbol: { in: symbols } } });
  await prisma.prediction.deleteMany({ where: { symbol: { in: symbols } } });
  await prisma.trade.deleteMany({ where: { symbol: { in: symbols } } });
  const result = await prisma.stock.deleteMany({ where: { symbol: { in: symbols } } });
  return result.count;
}
