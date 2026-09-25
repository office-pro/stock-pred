import type { Candle } from '@stockpred/shared-types';
import { Timeframe } from '@stockpred/shared-types';
import {
  DEFAULT_CANDLE_HISTORY_CHUNK,
  dedupeCandlesByKey,
  persistHistoryChunked,
  persistTodayUpsert,
  type CandlePersistClient,
} from './candle-persist';

function candle(
  symbol: string,
  time: number,
  close = 100,
  overrides: Partial<Candle> = {},
): Candle {
  return {
    symbol,
    timeframe: Timeframe.ONE_DAY,
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    ...overrides,
  };
}

function mockPrisma(opts?: {
  createManyImpl?: CandlePersistClient['candleRow']['createMany'];
  upsertImpl?: CandlePersistClient['candleRow']['upsert'];
}): CandlePersistClient & {
  createManyCalls: number;
  upsertCalls: number;
  lastCreateManySkipDuplicates?: boolean;
} {
  let createManyCalls = 0;
  let upsertCalls = 0;
  let lastCreateManySkipDuplicates: boolean | undefined;
  const client = {
    get createManyCalls() {
      return createManyCalls;
    },
    get upsertCalls() {
      return upsertCalls;
    },
    get lastCreateManySkipDuplicates() {
      return lastCreateManySkipDuplicates;
    },
    candleRow: {
      createMany: async (args: { data: unknown[]; skipDuplicates: boolean }) => {
        createManyCalls += 1;
        lastCreateManySkipDuplicates = args.skipDuplicates;
        if (opts?.createManyImpl) {
          return opts.createManyImpl(args as never);
        }
        return { count: args.data.length };
      },
      upsert: async (args: never) => {
        upsertCalls += 1;
        if (opts?.upsertImpl) return opts.upsertImpl(args);
        return {};
      },
    },
  };
  return client as never;
}

describe('dedupeCandlesByKey', () => {
  it('collapses duplicate candles keeping the last value', () => {
    const rows = [candle('TCS', 1, 100), candle('TCS', 1, 105), candle('INFY', 1, 50)];
    const out = dedupeCandlesByKey(rows);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.symbol === 'TCS')?.close).toBe(105);
  });
});

describe('persistHistoryChunked', () => {
  it('uses createMany with skipDuplicates (immutable history contract)', async () => {
    const prisma = mockPrisma();
    await persistHistoryChunked(prisma, [candle('TCS', 1)], 500);
    expect(prisma.createManyCalls).toBe(1);
    expect(prisma.lastCreateManySkipDuplicates).toBe(true);
    expect(prisma.upsertCalls).toBe(0);
  });

  it('chunks large histories and reduces db ops vs naive per-candle', async () => {
    const prisma = mockPrisma();
    const rows = Array.from({ length: 2500 }, (_, i) => candle('TCS', i + 1));
    const metrics = await persistHistoryChunked(prisma, rows, 1000);
    expect(metrics.chunksWritten).toBe(3);
    expect(metrics.dbOps).toBe(3);
    expect(metrics.naiveDbOpsEstimate).toBe(2500);
    expect(metrics.dbOps).toBeLessThan(metrics.naiveDbOpsEstimate);
    expect(metrics.rowsAttempted).toBe(2500);
    expect(metrics.rowsWritten).toBe(2500);
  });

  it('dedupes input before write (duplicate candles)', async () => {
    const prisma = mockPrisma();
    const metrics = await persistHistoryChunked(
      prisma,
      [candle('TCS', 1, 100), candle('TCS', 1, 101), candle('TCS', 2, 102)],
      500,
    );
    expect(metrics.rowsInput).toBe(3);
    expect(metrics.rowsAttempted).toBe(2);
    expect(metrics.rowsWritten).toBe(2);
    expect(prisma.createManyCalls).toBe(1);
  });

  it('reports skipped duplicates when createMany inserts fewer rows (existing candles)', async () => {
    const prisma = mockPrisma({
      createManyImpl: async ({ data }) => ({ count: Math.max(0, data.length - 1) }),
    });
    const metrics = await persistHistoryChunked(
      prisma,
      [candle('TCS', 1), candle('TCS', 2), candle('INFY', 1)],
      500,
    );
    expect(metrics.rowsAttempted).toBe(3);
    expect(metrics.rowsWritten).toBe(2);
    expect(metrics.rowsSkippedDuplicates).toBe(1);
  });

  it('handles mixed existing/new across chunk boundaries', async () => {
    let call = 0;
    const prisma = mockPrisma({
      createManyImpl: async ({ data }) => {
        call += 1;
        // first chunk: half existing; second: all new
        if (call === 1) return { count: Math.floor(data.length / 2) };
        return { count: data.length };
      },
    });
    const rows = Array.from({ length: 1500 }, (_, i) => candle('TCS', i + 1));
    const metrics = await persistHistoryChunked(prisma, rows, 1000);
    expect(metrics.chunksWritten).toBe(2);
    expect(metrics.dbOps).toBe(2);
    expect(metrics.rowsWritten).toBe(500 + 500);
  });

  it('propagates createMany failure (partial/failing persistence)', async () => {
    const prisma = mockPrisma({
      createManyImpl: async () => {
        throw new Error('connection pool timeout');
      },
    });
    await expect(
      persistHistoryChunked(prisma, [candle('TCS', 1), candle('TCS', 2)], 500),
    ).rejects.toThrow(/connection pool/);
  });

  it('uses DEFAULT_CANDLE_HISTORY_CHUNK when size omitted', async () => {
    expect(DEFAULT_CANDLE_HISTORY_CHUNK).toBe(1000);
    const prisma = mockPrisma();
    const rows = Array.from({ length: 1000 }, (_, i) => candle('TCS', i + 1));
    const metrics = await persistHistoryChunked(prisma, rows);
    expect(metrics.chunksWritten).toBe(1);
  });
});

describe('persistTodayUpsert', () => {
  it('upserts a single evolving candle (update path)', async () => {
    const prisma = mockPrisma();
    const metrics = await persistTodayUpsert(prisma, candle('TCS', 99, 200));
    expect(prisma.upsertCalls).toBe(1);
    expect(prisma.createManyCalls).toBe(0);
    expect(metrics.dbOps).toBe(1);
    expect(metrics.rowsWritten).toBe(1);
  });

  it('propagates upsert failure', async () => {
    const prisma = mockPrisma({
      upsertImpl: async () => {
        throw new Error('unique constraint');
      },
    });
    await expect(persistTodayUpsert(prisma, candle('TCS', 1))).rejects.toThrow(/unique constraint/);
  });
});
