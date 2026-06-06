import { Injectable } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import { Candle, Timeframe } from '@stockpred/shared-types';

const BATCH_SIZE = 500;

/**
 * Postgres-backed cache of REAL candles only (provider data, never
 * simulated). It is what keeps the platform working offline: when the
 * live provider is unreachable, history is served from here.
 */
@Injectable()
export class CandleCache {
  private readonly prisma = getPrismaClient();

  /** Bulk-insert history (immutable rows; duplicates skipped). */
  async saveHistory(candles: Candle[]): Promise<void> {
    try {
      for (let i = 0; i < candles.length; i += BATCH_SIZE) {
        const batch = candles.slice(i, i + BATCH_SIZE);
        await this.prisma.candleRow.createMany({
          data: batch.map((c) => ({
            symbol: c.symbol,
            timeframe: c.timeframe,
            time: BigInt(c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
          skipDuplicates: true,
        });
      }
    } catch (error) {
      console.warn(`[market-data] candle cache write failed: ${(error as Error).message}`);
    }
  }

  /** Upsert today's evolving candle (it changes during the session). */
  async saveToday(candle: Candle): Promise<void> {
    try {
      await this.prisma.candleRow.upsert({
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
        create: {
          symbol: candle.symbol,
          timeframe: candle.timeframe,
          time: BigInt(candle.time),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
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
}
