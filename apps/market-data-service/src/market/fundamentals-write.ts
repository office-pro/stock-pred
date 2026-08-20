import { getPrismaClient, isPlaceholderSymbol } from '@stockpred/database';
import { isFundamentalsFresh } from './alt-data/ingest-freshness';
import type { YahooSymbolHint } from './providers/yahoo.provider';
import { NseFundamentalsClient } from './providers/nse-fundamentals';
import {
  hasStatementFundamentals,
  YahooFundamentalsClient,
  type FundamentalSnapshotInput,
} from './providers/yahoo-fundamentals';

const yahoo = new YahooFundamentalsClient();
const nse = new NseFundamentalsClient();

const JUNK_SYMBOL = /^(TEXTILETH|TELEIND)\d+$/i;

export function shouldSkipFundamentalsLookup(symbol: string): boolean {
  return isPlaceholderSymbol(symbol) || JUNK_SYMBOL.test(symbol);
}

export async function upsertSnapshots(rows: FundamentalSnapshotInput[]): Promise<number> {
  const prisma = getPrismaClient();
  let written = 0;
  for (const row of rows) {
    await prisma.fundamentalSnapshot.upsert({
      where: { symbol_asOfDate: { symbol: row.symbol, asOfDate: row.asOfDate } },
      create: row,
      update: {
        availableAt: row.availableAt,
        source: row.source,
        sector: row.sector,
        revenue: row.revenue,
        pat: row.pat,
        eps: row.eps,
        ebit: row.ebit,
        ebitda: row.ebitda,
        equity: row.equity,
        totalDebt: row.totalDebt,
        totalAssets: row.totalAssets,
        currentAssets: row.currentAssets,
        currentLiab: row.currentLiab,
        cash: row.cash,
        ocf: row.ocf,
        capex: row.capex,
        fcf: row.fcf,
        revYoy: row.revYoy,
        patYoy: row.patYoy,
        epsYoy: row.epsYoy,
        opMargin: row.opMargin,
        netMargin: row.netMargin,
        grossMargin: row.grossMargin,
        ebitdaMargin: row.ebitdaMargin,
        roe: row.roe,
        roa: row.roa,
        roce: row.roce,
        debtEquity: row.debtEquity,
        currentRatio: row.currentRatio,
        cashRatio: row.cashRatio,
        ocfPat: row.ocfPat,
        fcfGrowth: row.fcfGrowth,
        fcfMargin: row.fcfMargin,
        trailingEps: row.trailingEps,
        bookValue: row.bookValue,
        trailingPe: row.trailingPe,
        priceToBook: row.priceToBook,
        promoterHolding: row.promoterHolding,
        institutionHolding: row.institutionHolding,
        displayScore: row.displayScore,
      },
    });
    written += 1;
  }
  return written;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function refreshSectorMedians(): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.fundamentalSnapshot.findMany({
    select: { symbol: true, sector: true, trailingPe: true, availableAt: true },
    orderBy: [{ symbol: 'asc' }, { availableAt: 'desc' }],
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.symbol)) latest.set(row.symbol, row);
  }
  const bySector = new Map<string, number[]>();
  for (const row of latest.values()) {
    if (!row.sector || row.trailingPe == null || row.trailingPe <= 0) continue;
    const list = bySector.get(row.sector) ?? [];
    list.push(row.trailingPe);
    bySector.set(row.sector, list);
  }
  let updated = 0;
  for (const [sector, pes] of bySector) {
    const sectorMedianPe = median(pes);
    if (sectorMedianPe == null) continue;
    const result = await prisma.fundamentalSnapshot.updateMany({
      where: { sector },
      data: { sectorMedianPe },
    });
    updated += result.count;
  }
  return updated;
}

export async function fetchSnapshotsWithFallback(
  symbol: string,
  hint?: YahooSymbolHint,
): Promise<FundamentalSnapshotInput[]> {
  if (shouldSkipFundamentalsLookup(symbol)) {
    throw new Error(`${symbol} is not a Yahoo/NSE equity (placeholder)`);
  }
  let yahooRows: FundamentalSnapshotInput[] = [];
  let yahooError: Error | null = null;
  try {
    yahooRows = await yahoo.fetchSnapshots(symbol, hint);
  } catch (error) {
    yahooError = error instanceof Error ? error : new Error(String(error));
  }
  if (yahooRows.some(hasStatementFundamentals) && yahooRows.some((row) => row.source === 'yahoo')) {
    return yahooRows;
  }

  let nseRows: FundamentalSnapshotInput[] = [];
  try {
    nseRows = await nse.fetchSnapshots(symbol);
  } catch {
    nseRows = [];
  }
  if (nseRows.some(hasStatementFundamentals)) {
    return nseRows;
  }
  if (yahooRows.length > 0) return yahooRows;
  if (nseRows.length > 0) return nseRows;
  throw yahooError ?? new Error(`No Yahoo or NSE fundamentals for ${symbol}`);
}

export async function ingestSymbol(
  symbol: string,
  hint?: YahooSymbolHint,
  options?: { full?: boolean },
): Promise<{ symbol: string; snapshots: number; cached?: boolean }> {
  const prisma = getPrismaClient();
  if (!options?.full) {
    const latest = await prisma.fundamentalSnapshot.findFirst({
      where: { symbol },
      orderBy: { availableAt: 'desc' },
      select: { availableAt: true },
    });
    if (isFundamentalsFresh(latest?.availableAt)) {
      console.log(`[fundamentals] ${symbol}: cached`);
      return { symbol, snapshots: 0, cached: true };
    }
  }
  const rows = await fetchSnapshotsWithFallback(symbol, hint);
  const snapshots = await upsertSnapshots(rows);
  const source = rows[0]?.source ?? 'yahoo';
  console.log(`[fundamentals] ${symbol}: fetched ${snapshots} snapshots (${source})`);
  return { symbol, snapshots };
}
