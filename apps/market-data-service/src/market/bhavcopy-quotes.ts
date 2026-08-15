/**
 * Official NSE/BSE cash-market bhavcopy (free EOD). Used to fill Price /
 * Change / Volume in memory without waiting for Postgres ingest or Yahoo.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import axios from 'axios';
import { Exchange, MarketIndex, Timeframe, type Candle } from '@stockpred/shared-types';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface BhavQuote {
  symbol: string;
  isin: string | null;
  bseCode: string | null;
  exchange: Exchange;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  volume: number;
  time: number;
}

export interface OfficialIndexClose {
  index: MarketIndex;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  time: number;
}

const INDEX_NAMES: { index: MarketIndex; names: string[] }[] = [
  { index: MarketIndex.NIFTY_50, names: ['NIFTY 50'] },
  { index: MarketIndex.NIFTY_MIDCAP_100, names: ['NIFTY MIDCAP 100'] },
  { index: MarketIndex.NIFTY_SMALLCAP_100, names: ['NIFTY SMALLCAP 100'] },
  { index: MarketIndex.INDIA_VIX, names: ['INDIA VIX'] },
];

export function quoteToCandle(row: BhavQuote): Candle {
  return {
    symbol: row.symbol,
    timeframe: Timeframe.ONE_DAY,
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  };
}

function formatCompact(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatDdmmyyyy(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${d}${m}${y}`;
}

function formatDdmmyy(date: Date): string {
  const y = String(date.getUTCFullYear()).slice(-2);
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${d}${m}${y}`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
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

function num(value: string | undefined): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function dayUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

function parseTradeDate(raw: string, fallback: Date): number {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return dayUtc(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(raw);
  if (dmy) {
    const months: Record<string, number> = {
      JAN: 1,
      FEB: 2,
      MAR: 3,
      APR: 4,
      MAY: 5,
      JUN: 6,
      JUL: 7,
      AUG: 8,
      SEP: 9,
      OCT: 10,
      NOV: 11,
      DEC: 12,
    };
    const month = months[dmy[2].toUpperCase()];
    if (month) return dayUtc(Number(dmy[3]), month, Number(dmy[1]));
  }
  const compact = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(raw);
  if (compact) return dayUtc(Number(compact[3]), Number(compact[2]), Number(compact[1]));
  return dayUtc(fallback.getUTCFullYear(), fallback.getUTCMonth() + 1, fallback.getUTCDate());
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 200).toLowerCase();
  return head.includes('<html') || head.includes('<!doctype');
}

export function parseBhavCsv(text: string, session: Date): BhavQuote[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').toUpperCase());
  const idx = (name: string, aliases: string[] = []): number => {
    const names = [name, ...aliases];
    return headers.findIndex((h) => names.includes(h));
  };

  const iSymbol = idx('SYMBOL', ['TCKRSYMB', 'SCRIP_ID', 'TCKR_SYMB']);
  const iCode = idx('SC_CODE', ['SCRIP_CD', 'FININSTRMIDSCRIPID']);
  const iSeries = idx('SERIES', ['SCTYSRS', 'SCTY_SRS', 'SC_TYPE']);
  const iOpen = idx('OPEN_PRICE', ['OPNPRM', 'OPNPRIC', 'OPEN']);
  const iHigh = idx('HIGH_PRICE', ['HGHPRIC', 'HIGH']);
  const iLow = idx('LOW_PRICE', ['LWPRIC', 'LOW']);
  const iClose = idx('CLOSE_PRICE', ['CLSPRIC', 'CLOSE']);
  const iPrev = idx('PREV_CLOSE', ['PREVCLOSE', 'PRVCLSPRIC', 'PREV_CL', 'PREV CLOSE']);
  const iVol = idx('TTL_TRD_QNTY', ['TTLTRADGVOL', 'TOTTRDQTY', 'NO_OF_SHRS', 'VOLUME']);
  const iDate = idx('DATE1', ['TRADDT', 'TRADE_DATE', 'TRADINGDATE']);
  const iIsin = idx('ISIN', ['ISIN_CODE', 'ISINCODE']);
  const iGroup = idx('SC_GROUP', ['GROUP']);

  if (iOpen < 0 || iClose < 0 || (iSymbol < 0 && iCode < 0)) {
    throw new Error(`Unrecognised bhavcopy header: ${headers.join(',')}`);
  }

  const rows: BhavQuote[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const series = (cols[iSeries] ?? '').trim().toUpperCase();
    // NSE cash EQ; BSE equity type Q / groups A B T X. Empty series is allowed.
    if (series && !['EQ', 'Q', 'A', 'B', 'T', 'X'].includes(series)) {
      continue;
    }
    if (iGroup >= 0) {
      const group = (cols[iGroup] ?? '').trim().toUpperCase();
      if (group && ['F', 'G', 'I', 'M'].includes(group)) continue;
    }
    const symbol = (cols[iSymbol] ?? '').trim().toUpperCase().replace(/\s+/g, '');
    const bseCode = iCode >= 0 ? (cols[iCode] ?? '').trim() : '';
    if (!symbol && !bseCode) continue;
    const open = num(cols[iOpen]);
    const high = num(cols[iHigh]);
    const low = num(cols[iLow]);
    const close = num(cols[iClose]);
    const prevClose = num(cols[iPrev]);
    const volume = num(cols[iVol]) || 0;
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
    rows.push({
      symbol,
      isin: iIsin >= 0 ? (cols[iIsin] ?? '').trim().toUpperCase() || null : null,
      bseCode: bseCode || null,
      exchange: Exchange.NSE,
      open,
      high,
      low,
      close,
      prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : open,
      volume,
      time: parseTradeDate(cols[iDate] ?? '', session),
    });
  }
  return rows;
}

async function fetchText(url: string, referer: string): Promise<string> {
  const response = await axios.get<string>(url, {
    headers: { ...BROWSER_HEADERS, Referer: referer },
    timeout: 25_000,
    responseType: 'text',
    transformResponse: [(data) => data],
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return String(response.data ?? '');
}

async function fetchBuffer(url: string, referer: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    headers: { ...BROWSER_HEADERS, Referer: referer },
    timeout: 25_000,
    responseType: 'arraybuffer',
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return Buffer.from(response.data);
}

function unzipWithPython(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'bhav-'));
  const zipPath = join(dir, 'bhav.zip');
  writeFileSync(zipPath, buffer);
  const zipPosix = zipPath.replace(/\\/g, '/');
  const script = `import zipfile,sys;z=zipfile.ZipFile(r"${zipPosix}");name=next(n for n in z.namelist() if n.lower().endswith(".csv"));sys.stdout.buffer.write(z.read(name))`;
  const result = spawnSync('python', ['-c', script], { maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString() || 'python unzip failed');
  }
  return Buffer.from(result.stdout ?? []).toString('utf8');
}

async function loadNseSession(session: Date): Promise<BhavQuote[]> {
  const compact = formatCompact(session);
  const ddmmyyyy = formatDdmmyyyy(session);
  const csvUrls = [
    `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`,
    `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`,
  ];
  for (const url of csvUrls) {
    try {
      const text = await fetchText(url, 'https://www.nseindia.com/');
      if (looksLikeHtml(text) || text.trim().length < 80) continue;
      const rows = parseBhavCsv(text, session).map((row) => ({ ...row, exchange: Exchange.NSE }));
      if (rows.length > 0) return rows;
    } catch {
      /* try next URL */
    }
  }

  const zipUrl = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${compact}_F_0000.csv.zip`;
  const buffer = await fetchBuffer(zipUrl, 'https://www.nseindia.com/');
  const text = unzipWithPython(buffer);
  return parseBhavCsv(text, session).map((row) => ({ ...row, exchange: Exchange.NSE }));
}

async function loadBseSession(session: Date): Promise<BhavQuote[]> {
  const compact = formatCompact(session);
  const ddmmyy = formatDdmmyy(session);
  const csvUrls = [
    `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${compact}_F_0000.CSV`,
    `https://www.bseindia.com/download/BhavCopy/Equity/EQ${ddmmyy}.CSV`,
  ];
  for (const url of csvUrls) {
    try {
      const text = await fetchText(url, 'https://www.bseindia.com/');
      if (looksLikeHtml(text) || text.trim().length < 80) continue;
      const rows = parseBhavCsv(text, session).map((row) => ({ ...row, exchange: Exchange.BSE }));
      if (rows.length > 0) return rows;
    } catch {
      /* try zip */
    }
  }

  const zipUrls = [
    `https://www.bseindia.com/download/BhavCopy/Equity/EQ${ddmmyy}_CSV.ZIP`,
    `https://www.bseindia.com/download/BhavCopy/Equity/EQ_ISINCODE_${ddmmyy}.zip`,
  ];
  for (const url of zipUrls) {
    try {
      const buffer = await fetchBuffer(url, 'https://www.bseindia.com/');
      const text = unzipWithPython(buffer);
      const rows = parseBhavCsv(text, session).map((row) => ({ ...row, exchange: Exchange.BSE }));
      if (rows.length > 0) return rows;
    } catch {
      /* try next */
    }
  }
  return [];
}

export function recentWeekdays(count: number): Date[] {
  const out: Date[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (out.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

/** Latest available NSE (and BSE) bhavcopy, walking back a few sessions. */
export async function loadLatestBhavcopy(maxLookback = 8): Promise<BhavQuote[]> {
  const sessions = recentWeekdays(maxLookback);
  let nse: BhavQuote[] = [];
  let nseSession: Date | null = null;
  for (const session of sessions) {
    try {
      nse = await loadNseSession(session);
      if (nse.length > 0) {
        nseSession = session;
        console.log(`[bhavcopy] NSE ${formatCompact(session)}: ${nse.length} rows`);
        break;
      }
    } catch (error) {
      console.warn(`[bhavcopy] NSE ${formatCompact(session)}: ${(error as Error).message}`);
    }
  }

  let bse: BhavQuote[] = [];
  const bseSessions = nseSession
    ? [nseSession, ...sessions.filter((s) => s !== nseSession)]
    : sessions;
  for (const session of bseSessions) {
    try {
      bse = await loadBseSession(session);
      if (bse.length > 0) {
        console.log(`[bhavcopy] BSE ${formatCompact(session)}: ${bse.length} rows`);
        break;
      }
    } catch (error) {
      console.warn(`[bhavcopy] BSE ${formatCompact(session)}: ${(error as Error).message}`);
    }
  }

  return [...nse, ...bse];
}

/** Extra historical sessions after the latest day is already applied (NSE only). */
export async function loadBhavcopySession(session: Date): Promise<BhavQuote[]> {
  return loadNseSession(session).catch(() => [] as BhavQuote[]);
}

export function parseIndexCloseCsv(text: string, session: Date): OfficialIndexClose[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const out: OfficialIndexClose[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const name = (cols[0] ?? '').trim().toUpperCase();
    const matched = INDEX_NAMES.find((entry) => entry.names.includes(name));
    if (!matched) continue;
    const open = num(cols[2]);
    const high = num(cols[3]);
    const low = num(cols[4]);
    const close = num(cols[5]);
    const points = num(cols[6]);
    if (!Number.isFinite(close) || close <= 0) continue;
    const prevClose = Number.isFinite(points)
      ? close - points
      : Number.isFinite(open) && open > 0
        ? open
        : close;
    out.push({
      index: matched.index,
      open: Number.isFinite(open) && open > 0 ? open : close,
      high: Number.isFinite(high) && high > 0 ? high : close,
      low: Number.isFinite(low) && low > 0 ? low : close,
      close,
      prevClose: prevClose > 0 ? prevClose : close,
      time: parseTradeDate(cols[1] ?? '', session),
    });
  }
  return out;
}

async function loadIndexSession(session: Date): Promise<OfficialIndexClose[]> {
  const ddmmyyyy = formatDdmmyyyy(session);
  const csvUrls = [
    `https://nsearchives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy}.csv`,
    `https://archives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy}.csv`,
  ];
  for (const url of csvUrls) {
    try {
      const text = await fetchText(url, 'https://www.nseindia.com/');
      if (looksLikeHtml(text) || text.trim().length < 80) continue;
      const rows = parseIndexCloseCsv(text, session);
      if (rows.length > 0) return rows;
    } catch {
      /* try next */
    }
  }
  return [];
}

/** Official NSE index EOD (same session walk-back as bhavcopy). */
export async function loadLatestIndexCloses(maxLookback = 8): Promise<OfficialIndexClose[]> {
  for (const session of recentWeekdays(maxLookback)) {
    try {
      const rows = await loadIndexSession(session);
      if (rows.length > 0) {
        console.log(
          `[bhavcopy] indices ${formatCompact(session)}: ${rows.map((r) => r.index).join(', ')}`,
        );
        return rows;
      }
    } catch (error) {
      console.warn(`[bhavcopy] indices ${formatCompact(session)}: ${(error as Error).message}`);
    }
  }
  return [];
}
