import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { Candle, Timeframe } from '@stockpred/shared-types';
import { getEnv, withRetry } from '@stockpred/shared-utils';

const MAX_DAILY_CANDLES = 3000;

/**
 * Per-symbol daily candle buffers. Warmed up over REST from the
 * market-data-service, then kept current from Kafka candle events
 * (or REST polling when Kafka is down).
 */
@Injectable()
export class CandleStore {
  private readonly candles = new Map<string, Candle[]>();
  private readonly marketDataUrl = getEnv('MARKET_DATA_SERVICE_URL', 'http://localhost:3002');

  symbols(): string[] {
    return [...this.candles.keys()];
  }

  get(symbol: string): Candle[] {
    return this.candles.get(symbol) ?? [];
  }

  /** Apply a daily candle: replace today's evolving bar or append a new session. */
  apply(candle: Candle): void {
    if (candle.timeframe !== Timeframe.ONE_DAY) return;
    const series = this.candles.get(candle.symbol);
    if (!series) {
      this.candles.set(candle.symbol, [candle]);
      return;
    }
    const last = series[series.length - 1];
    if (last && last.time === candle.time) {
      series[series.length - 1] = candle;
    } else if (!last || candle.time > last.time) {
      series.push(candle);
      if (series.length > MAX_DAILY_CANDLES) series.shift();
    }
  }

  async warmup(): Promise<void> {
    const { data: stocks } = await withRetry(
      () => axios.get<{ symbol: string }[]>(`${this.marketDataUrl}/stocks`, { timeout: 10_000 }),
      { retries: 12, delayMs: 2500, backoff: 1.2 },
    );
    await Promise.all(
      stocks.map(async ({ symbol }) => {
        try {
          const { data } = await axios.get<Candle[]>(
            `${this.marketDataUrl}/stocks/${symbol}/candles`,
            { params: { timeframe: Timeframe.ONE_DAY, limit: 600 }, timeout: 10_000 },
          );
          this.candles.set(symbol, data);
        } catch (error) {
          console.warn(`[signal-engine] warmup failed for ${symbol}: ${(error as Error).message}`);
        }
      }),
    );
    console.log(`[signal-engine] warmed up ${this.candles.size} symbols`);
  }

  async refreshFromRest(symbol: string): Promise<void> {
    const { data } = await axios.get<Candle[]>(`${this.marketDataUrl}/stocks/${symbol}/candles`, {
      params: { timeframe: Timeframe.ONE_DAY, limit: 600 },
      timeout: 10_000,
    });
    this.candles.set(symbol, data);
  }
}
