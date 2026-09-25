import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import { Candle, Timeframe } from '@stockpred/shared-types';
import { getEnvNumber } from '@stockpred/shared-utils';
import { CandleWriteLimiter, type CandleWriteMetricsSnapshot } from './candle-write-limiter';
import {
  DEFAULT_CANDLE_HISTORY_CHUNK,
  persistHistoryChunked,
  persistTodayUpsert,
} from './candle-persist';
import {
  DbWritePressureTracker,
  type PressureSnapshot,
  type WritePriority,
} from './db-write-pressure';

/**
 * Postgres-backed cache of REAL candles only (provider data, never
 * simulated). It is what keeps the platform working offline: when the
 * live provider is unreachable, history is served from here.
 *
 * All Prisma candle writes go through a shared limiter so Yahoo fetch
 * concurrency does not become unbounded DB write concurrency.
 * Phase 4: low-priority (bootstrap) writes adaptively back off under DB pressure.
 * Phase 5: history uses chunked createMany(skipDuplicates); today remains upsert.
 */
@Injectable()
export class CandleCache {
  private readonly prisma = getPrismaClient();
  private readonly pressure = new DbWritePressureTracker();
  private readonly writeLimiter = new CandleWriteLimiter(2, {
    onSuccess: () => this.pressure.recordWriteSuccess(),
    onPoolPressureFailure: () => this.pressure.recordPoolPressureFailure(),
  });
  private pressureSimStarted = false;
  private readonly historyChunkSize = Math.max(
    1,
    getEnvNumber('MDS_CANDLE_WRITE_CHUNK', DEFAULT_CANDLE_HISTORY_CHUNK),
  );

  /** Observability snapshot for bootstrap / ops diagnosis. */
  getWriteMetrics(): CandleWriteMetricsSnapshot {
    return this.writeLimiter.getMetrics();
  }

  getPressureSnapshot(): PressureSnapshot {
    return this.pressure.snapshot();
  }

  /** Bootstrap loop: pause/slow between batches when DB is under pressure. */
  async awaitBootstrapCapacity(): Promise<void> {
    await this.maybeStartPressureSimulation();
    await this.pressure.awaitBootstrapGate();
  }

  /**
   * Bulk-insert history (immutable rows; duplicates skipped — never updated).
   * Contract: createMany + skipDuplicates on @@unique([symbol, timeframe, time]).
   */
  async saveHistory(candles: Candle[], opts?: { priority?: WritePriority }): Promise<void> {
    if (candles.length === 0) return;
    await this.maybeStartPressureSimulation();
    const priority = opts?.priority ?? 'high';
    if (priority === 'low') {
      const gate = await this.pressure.beforeLowPriorityWrite();
      if (gate === 'skip') {
        console.log(
          `[CANDLE-CACHE] write_skipped op=saveHistory priority=low reason=BOOTSTRAP_PAUSED ` +
            `level=${this.pressure.getLevel()}`,
        );
        return;
      }
    }
    try {
      await this.writeLimiter.run('saveHistory', async () => {
        const metrics = await persistHistoryChunked(this.prisma, candles, this.historyChunkSize);
        const opsReduced = Math.max(0, metrics.naiveDbOpsEstimate - metrics.dbOps);
        console.log(
          `[CANDLE-CACHE] history_persist chunks=${metrics.chunksWritten} ` +
            `rowsInput=${metrics.rowsInput} rowsAttempted=${metrics.rowsAttempted} ` +
            `rowsWritten=${metrics.rowsWritten} rowsSkippedDup=${metrics.rowsSkippedDuplicates} ` +
            `dbOps=${metrics.dbOps} naiveDbOps=${metrics.naiveDbOpsEstimate} ` +
            `opsReduced=${opsReduced} durationMs=${metrics.durationMs} chunkSize=${this.historyChunkSize}`,
        );
      });
    } catch (error) {
      console.warn(`[market-data] candle cache write failed: ${(error as Error).message}`);
    }
  }

  /**
   * Upsert today's evolving candle (session bar changes intraday).
   * Contract: upsert on @@unique([symbol, timeframe, time]) — updates OHLC/volume.
   */
  async saveToday(candle: Candle): Promise<void> {
    await this.maybeStartPressureSimulation();
    try {
      await this.writeLimiter.run('saveToday', async () => {
        const metrics = await persistTodayUpsert(this.prisma, candle);
        console.log(
          `[CANDLE-CACHE] today_persist rowsAttempted=${metrics.rowsAttempted} ` +
            `rowsWritten=${metrics.rowsWritten} dbOps=${metrics.dbOps} durationMs=${metrics.durationMs}`,
        );
      });
    } catch (error) {
      console.warn(`[market-data] candle cache upsert failed: ${(error as Error).message}`);
    }
  }

  /** Load cached real history, oldest first. Returns [] when unavailable. */
  async load(symbol: string, limit: number): Promise<Candle[]> {
    try {
      const rows = await this.prisma.candleRow.findMany({
        where: { symbol, timeframe: Timeframe.ONE_DAY },
        orderBy: { time: 'desc' },
        take: limit,
      });
      return rows.reverse().map((row) => ({
        symbol: row.symbol,
        timeframe: row.timeframe as Timeframe,
        time: Number(row.time),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }));
    } catch (error) {
      console.warn(`[market-data] candle cache read failed: ${(error as Error).message}`);
      return [];
    }
  }

  private async maybeStartPressureSimulation(): Promise<void> {
    if (this.pressureSimStarted) return;
    this.pressureSimStarted = true;
    const simulateMs = getEnvNumber('MDS_DB_PRESSURE_SIMULATE_MS', 0);
    if (simulateMs > 0) {
      console.log(
        `[DB-PRESSURE] simulate_start duration_ms=${simulateMs} (validation only; bootstrap pauses)`,
      );
      void this.pressure.simulatePressure(simulateMs).then(() => {
        console.log(`[DB-PRESSURE] simulate_end duration_ms=${simulateMs}`);
      });
    }
  }
}
