/**
 * Scan cached daily candles for named patterns and store analog outcomes.
 *
 * Default: every symbol in the official full universe (equity-master.json).
 *
 *   node apps/pattern-engine/dist/scan-history.js
 *   node apps/pattern-engine/dist/scan-history.js --symbol RELIANCE
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import {
  disconnectPrisma,
  getPrismaClient,
  getStockUniverse,
  type PrismaClient,
  type UniverseStock,
} from '@stockpred/database';
import { Candle, Timeframe } from '@stockpred/shared-types';
import { scanHistory, type ScannedOccurrence } from './patterns/history-scan';

const MARKET_DATA_URL = process.env.MARKET_DATA_SERVICE_URL || 'http://localhost:3002';
const MIN_BARS = 40;

function loadRootEnv(): void {
  const envPath = join(__dirname, '..', '..', '..', '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf('=');
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}

async function connectPrisma(): Promise<PrismaClient | null> {
  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    return prisma;
  } catch (error) {
    console.warn(
      `[scan-patterns] Postgres unavailable (${firstLine(error)}); using market-data candles.`,
    );
    await disconnectPrisma().catch(() => undefined);
    return null;
  }
}

async function candlesFromDb(prisma: PrismaClient, symbol: string): Promise<Candle[]> {
  const rows = await prisma.candleRow.findMany({
    where: { symbol, timeframe: Timeframe.ONE_DAY },
    orderBy: { time: 'asc' },
  });
  return rows.map((row) => ({
    symbol: row.symbol,
    timeframe: Timeframe.ONE_DAY,
    time: Number(row.time),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }));
}

async function candlesFromMarketData(symbol: string): Promise<Candle[]> {
  const { data } = await axios.get<Candle[]>(`${MARKET_DATA_URL}/stocks/${symbol}/candles`, {
    params: { timeframe: Timeframe.ONE_DAY, limit: 5000 },
    timeout: 15_000,
  });
  return Array.isArray(data) ? data : [];
}

async function loadCandles(prisma: PrismaClient | null, symbol: string): Promise<Candle[]> {
  if (prisma) {
    try {
      const fromDb = await candlesFromDb(prisma, symbol);
      if (fromDb.length >= MIN_BARS) return fromDb;
    } catch (error) {
      console.warn(`[scan-patterns] ${symbol}: db candles failed (${firstLine(error)})`);
    }
  }
  try {
    return await candlesFromMarketData(symbol);
  } catch {
    return [];
  }
}

async function persistHits(
  prisma: PrismaClient,
  meta: UniverseStock | undefined,
  hits: ScannedOccurrence[],
): Promise<number> {
  if (hits.length === 0) return 0;
  const symbol = hits[0].symbol;
  await prisma.stock.upsert({
    where: { symbol },
    update: {},
    create: {
      symbol,
      name: meta?.name ?? symbol,
      exchange: meta?.exchange ?? 'NSE',
      sector: meta?.sector ?? 'Unknown',
      indices: meta?.indices ?? [],
    },
  });

  let stored = 0;
  for (const hit of hits) {
    await prisma.patternOccurrence.upsert({
      where: {
        symbol_pattern_timeframe_confirmedAt: {
          symbol: hit.symbol,
          pattern: hit.pattern,
          timeframe: '1d',
          confirmedAt: BigInt(hit.confirmedAt),
        },
      },
      update: {
        confidence: hit.confidence,
        price: hit.price,
        direction: hit.direction,
        return5: hit.return5,
        return10: hit.return10,
        return20: hit.return20,
        maxFavorable: hit.maxFavorable,
        maxAdverse: hit.maxAdverse,
      },
      create: {
        symbol: hit.symbol,
        pattern: hit.pattern,
        timeframe: '1d',
        direction: hit.direction,
        confidence: hit.confidence,
        price: hit.price,
        confirmedAt: BigInt(hit.confirmedAt),
        return5: hit.return5,
        return10: hit.return10,
        return20: hit.return20,
        maxFavorable: hit.maxFavorable,
        maxAdverse: hit.maxAdverse,
      },
    });
    stored += 1;
  }
  return stored;
}

async function main(): Promise<void> {
  loadRootEnv();
  const prisma = await connectPrisma();
  const only = argValue('--symbol')?.toUpperCase();
  const universe = getStockUniverse('full-universe');
  const bySymbol = new Map(universe.map((stock) => [stock.symbol, stock]));
  const symbols = only ? [only] : universe.map((stock) => stock.symbol);

  if (symbols.length === 0) {
    throw new Error(
      'No symbols to scan. Run `npm run ingest:listings` so packages/database/data/equity-master.json exists.',
    );
  }

  console.log(
    `[scan-patterns] scanning ${symbols.length} symbol${symbols.length === 1 ? '' : 's'}` +
      (only ? ` (${only})` : ' (full listed universe)'),
  );

  let stored = 0;
  let scanned = 0;
  let skipped = 0;
  let persistFailed = false;

  for (let i = 0; i < symbols.length; i += 1) {
    const symbol = symbols[i];
    const candles = await loadCandles(prisma, symbol);
    if (candles.length < MIN_BARS) {
      skipped += 1;
      continue;
    }
    const hits = scanHistory(symbol, candles);
    scanned += 1;
    if (prisma && hits.length > 0) {
      try {
        stored += await persistHits(prisma, bySymbol.get(symbol), hits);
      } catch (error) {
        if (!persistFailed) {
          persistFailed = true;
          console.warn(`[scan-patterns] persist failed (${firstLine(error)}); continuing scan`);
        }
      }
    }
    if ((i + 1) % 25 === 0 || i + 1 === symbols.length) {
      console.log(
        `[scan-patterns] ${i + 1}/${symbols.length} looked up, ${scanned} scanned, ${skipped} skipped (<${MIN_BARS} bars), ${stored} occurrences`,
      );
    }
  }

  if (!prisma) {
    console.warn(
      '[scan-patterns] occurrences were not saved (Postgres is down). Fix DATABASE_URL and re-run to persist analogs.',
    );
  }
  console.log(
    `[scan-patterns] done: ${scanned} symbols scanned, ${skipped} skipped, ${stored} pattern occurrences upserted`,
  );
}

main()
  .catch((error) => {
    console.error('[scan-patterns] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
