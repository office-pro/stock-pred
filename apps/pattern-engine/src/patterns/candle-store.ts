import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { Candle, Timeframe } from '@stockpred/shared-types';
import { getEnv, withRetry } from '@stockpred/shared-utils';

const MAX_DAILY_CANDLES = 5000;

/** Daily candle buffers warmed over REST and kept fresh from Kafka. */
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
    await withRetry(
      () =>
        axios.get(`${this.marketDataUrl}/stocks`, {
          params: { page: 1, limit: 1 },
          timeout: 10_000,
        }),
      { retries: 12, delayMs: 2500, backoff: 1.2 },
    );
    console.log('[pattern-engine] market-data is up; history loads per symbol on the detail page');
  }

  async refreshFromRest(symbol: string): Promise<void> {
    const existing = this.candles.get(symbol) ?? [];
    const limit = Math.min(Math.max(existing.length, 300), MAX_DAILY_CANDLES);
    const { data } = await axios.get<Candle[]>(`${this.marketDataUrl}/stocks/${symbol}/candles`, {
      params: { timeframe: Timeframe.ONE_DAY, limit },
      timeout: 15_000,
    });
    if (data.length >= existing.length) {
      this.candles.set(symbol, data);
    }
  }

  /** Pull the longest daily series market-data will serve (detail page / analog). */
  async ensureHistory(symbol: string): Promise<Candle[]> {
    const existing = this.candles.get(symbol) ?? [];
    if (existing.length >= 500) return existing;
    try {
      const { data } = await axios.get<Candle[]>(`${this.marketDataUrl}/stocks/${symbol}/candles`, {
        params: { timeframe: Timeframe.ONE_DAY, limit: MAX_DAILY_CANDLES },
        timeout: 55_000,
      });
      if (data.length >= existing.length) {
        this.candles.set(symbol, data);
        return data;
      }
    } catch (error) {
      console.warn(
        `[pattern-engine] full-history fetch failed for ${symbol}: ${(error as Error).message}`,
      );
    }
    return existing;
  }
}
