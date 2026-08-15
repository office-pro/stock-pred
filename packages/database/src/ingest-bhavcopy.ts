/**
 * Ingest NSE cash-market bhavcopy (official EOD, free) into the candles table.
 *
 * Tries uncompressed CSV first, then a zip via Python's stdlib zipfile.
 *
 *   node packages/database/dist/ingest-bhavcopy.js
 *   node packages/database/dist/ingest-bhavcopy.js --days 5
 *   node packages/database/dist/ingest-bhavcopy.js --date 2026-08-14
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Timeframe } from '@stockpred/shared-types';
import { getPrismaClient, disconnectPrisma } from './index';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.nseindia.com/',
};

interface BhavRow {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

function parseArgs(argv: string[]): { days: number; date: string | null } {
  let days = 1;
  let date: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--days') days = Math.max(1, Number(argv[i + 1] ?? 1));
    if (argv[i] === '--date') date = argv[i + 1] ?? null;
  }
  return { days, date };
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
  return dayUtc(fallback.getUTCFullYear(), fallback.getUTCMonth() + 1, fallback.getUTCDate());
}

function parseBhavCsv(text: string, session: Date): BhavRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').toUpperCase());
  const idx = (name: string, aliases: string[] = []): number => {
    const names = [name, ...aliases];
    return headers.findIndex((h) => names.includes(h));
  };

  const iSymbol = idx('SYMBOL', ['TCKRSYMB']);
  const iSeries = idx('SERIES', ['SCTYSRS', 'SCTY_SRS']);
  const iOpen = idx('OPEN_PRICE', ['OPNPRIC', 'OPEN']);
  const iHigh = idx('HIGH_PRICE', ['HGHPRIC', 'HIGH']);
  const iLow = idx('LOW_PRICE', ['LWPRIC', 'LOW']);
  const iClose = idx('CLOSE_PRICE', ['CLSPRIC', 'CLOSE']);
  const iVol = idx('TTL_TRD_QNTY', ['TTLTRADGVOL', 'TOTTRDQTY', 'VOLUME']);
  const iDate = idx('DATE1', ['TRADDT', 'TRADE_DATE']);
  if (iSymbol < 0 || iOpen < 0 || iClose < 0) {
    throw new Error(`Unrecognised bhavcopy header: ${headers.join(',')}`);
  }

  const rows: BhavRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const series = (cols[iSeries] ?? 'EQ').trim().toUpperCase();
    if (series && series !== 'EQ') continue;
    const symbol = (cols[iSymbol] ?? '').trim().toUpperCase();
    if (!symbol) continue;
    const open = num(cols[iOpen]);
    const high = num(cols[iHigh]);
    const low = num(cols[iLow]);
    const close = num(cols[iClose]);
    const volume = num(cols[iVol]) || 0;
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
    rows.push({
      symbol,
      open,
      high,
      low,
      close,
      volume,
      time: parseTradeDate(cols[iDate] ?? '', session),
    });
  }
  return rows;
}

async function fetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
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

async function loadBhavcopy(session: Date): Promise<BhavRow[]> {
  const compact = formatCompact(session);
  const ddmmyyyy = formatDdmmyyyy(session);
  const csvUrls = [
    `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`,
    `https://archives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`,
  ];
  for (const url of csvUrls) {
    try {
      const text = await fetchCsv(url);
      if (text.includes('<html') || text.trim().length < 80) continue;
      const rows = parseBhavCsv(text, session);
      if (rows.length > 0) {
        console.log(`[bhavcopy] ${compact}: ${rows.length} EQ rows from ${url}`);
        return rows;
      }
    } catch (error) {
      console.warn(`[bhavcopy] ${url}: ${(error as Error).message}`);
    }
  }

  const zipUrl = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${compact}_F_0000.csv.zip`;
  const response = await fetch(zipUrl, { headers: BROWSER_HEADERS, redirect: 'follow' });
  if (!response.ok) throw new Error(`${zipUrl} -> HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = unzipWithPython(buffer);
  const rows = parseBhavCsv(text, session);
  console.log(`[bhavcopy] ${compact}: ${rows.length} EQ rows from zip`);
  return rows;
}

async function persist(rows: BhavRow[]): Promise<number> {
  const prisma = getPrismaClient();
  const known = new Set(
    (await prisma.stock.findMany({ select: { symbol: true } })).map((s) => s.symbol),
  );
  const eligible = rows.filter((row) => known.has(row.symbol));
  const missing = rows.length - eligible.length;
  if (missing > 0) {
    console.log(
      `[bhavcopy] skipping ${missing} symbols not in stocks table (run ingest:listings first)`,
    );
  }

  const batchSize = 500;
  let written = 0;
  for (let i = 0; i < eligible.length; i += batchSize) {
    const batch = eligible.slice(i, i + batchSize);
    const result = await prisma.candleRow.createMany({
      data: batch.map((row) => ({
        symbol: row.symbol,
        timeframe: Timeframe.ONE_DAY,
        time: BigInt(row.time),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      })),
      skipDuplicates: true,
    });
    written += result.count;
  }
  return written;
}

function sessionDates(days: number, explicit: string | null): Date[] {
  if (explicit) {
    const [y, m, d] = explicit.split('-').map(Number);
    return [new Date(Date.UTC(y, m - 1, d))];
  }
  const out: Date[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  // NSE files are dated in IST; walk calendar days and skip weekends.
  while (out.length < days) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

async function main(): Promise<void> {
  const { days, date } = parseArgs(process.argv.slice(2));
  let total = 0;
  for (const session of sessionDates(days, date)) {
    try {
      const rows = await loadBhavcopy(session);
      total += await persist(rows);
    } catch (error) {
      console.warn(`[bhavcopy] ${formatCompact(session)} skipped: ${(error as Error).message}`);
    }
  }
  console.log(`[bhavcopy] inserted ${total} new daily candles`);
}

main()
  .catch((error) => {
    console.error('[bhavcopy] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
