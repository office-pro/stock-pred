import type { Candle } from '@stockpred/shared-types';

/** Default rows per createMany — fewer round-trips than 500, safe for Postgres params. */
export const DEFAULT_CANDLE_HISTORY_CHUNK = 1000;

export type CandlePersistClient = {
  candleRow: {
    createMany: (args: {
      data: Array<{
        symbol: string;
        timeframe: string;
        time: bigint;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
      skipDuplicates: boolean;
    }) => Promise<{ count: number }>;
    upsert: (args: {
      where: {
        symbol_timeframe_time: { symbol: string; timeframe: string; time: bigint };
      };
      update: {
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      };
      create: {
        symbol: string;
        timeframe: string;
        time: bigint;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      };
    }) => Promise<unknown>;
  };
};

export type HistoryPersistMetrics = {
  rowsInput: number;
  rowsAttempted: number;
  rowsWritten: number;
  rowsSkippedDuplicates: number;
  chunksWritten: number;
  dbOps: number;
  /** Hypothetical 1-op-per-candle baseline (for "ops reduced" observability). */
  naiveDbOpsEstimate: number;
  durationMs: number;
};

export type TodayPersistMetrics = {
  rowsAttempted: number;
  rowsWritten: number;
  dbOps: number;
  durationMs: number;
};

/** Collapse duplicate (symbol, timeframe, time); last write wins within the batch. */
export function dedupeCandlesByKey(candles: Candle[]): Candle[] {
  const map = new Map<string, Candle>();
  for (const c of candles) {
    map.set(`${c.symbol}\0${c.timeframe}\0${c.time}`, c);
  }
  return [...map.values()];
}

export function candleRowData(c: Candle) {
  return {
    symbol: c.symbol,
    timeframe: c.timeframe,
    time: BigInt(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  };
}

/**
 * History persistence contract (unchanged):
 * - Immutable inserts via createMany
 * - skipDuplicates: true → existing (symbol,timeframe,time) rows are NOT updated
 * - Chunked to bound statement size
 */
export async function persistHistoryChunked(
  prisma: CandlePersistClient,
  candles: Candle[],
  chunkSize: number = DEFAULT_CANDLE_HISTORY_CHUNK,
): Promise<HistoryPersistMetrics> {
  const size = Math.max(1, Math.floor(chunkSize));
  const deduped = dedupeCandlesByKey(candles);
  const started = Date.now();
  let rowsWritten = 0;
  let chunksWritten = 0;
  let dbOps = 0;

  for (let i = 0; i < deduped.length; i += size) {
    const batch = deduped.slice(i, i + size);
    chunksWritten += 1;
    dbOps += 1;
    const result = await prisma.candleRow.createMany({
      data: batch.map(candleRowData),
      skipDuplicates: true,
    });
    rowsWritten += result.count;
  }

  return {
    rowsInput: candles.length,
    rowsAttempted: deduped.length,
    rowsWritten,
    rowsSkippedDuplicates: Math.max(0, deduped.length - rowsWritten),
    chunksWritten,
    dbOps,
    naiveDbOpsEstimate: candles.length,
    durationMs: Date.now() - started,
  };
}

/**
 * Today persistence contract (unchanged):
 * - Single-row upsert on @@unique([symbol, timeframe, time])
 * - Existing evolving session candle is UPDATED
 */
export async function persistTodayUpsert(
  prisma: CandlePersistClient,
  candle: Candle,
): Promise<TodayPersistMetrics> {
  const started = Date.now();
  await prisma.candleRow.upsert({
    where: {
      symbol_timeframe_time: {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        time: BigInt(candle.time),
      },
    },
    update: {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    },
    create: candleRowData(candle),
  });
  return {
    rowsAttempted: 1,
    rowsWritten: 1,
    dbOps: 1,
    durationMs: Date.now() - started,
  };
}
