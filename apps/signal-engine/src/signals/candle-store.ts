import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { Candle, Timeframe } from '@stockpred/shared-types';
import { getEnv } from '@stockpred/shared-utils';

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
    try {
      // Collect all stocks (market-data-service paginate, so fetch all pages)
      const allStocks: Array<{ symbol: string }> = [];
      let page = 1;
      let hasMore = true;
      let attempts = 0;
      const MAX_RETRIES = 20; // 50 seconds with 2.5s delay per page

      while (hasMore && attempts < MAX_RETRIES) {
        try {
          const response = await axios.get<{
            data: Array<{ symbol: string }>;
            total: number;
            hasMore: boolean;
          }>(`${this.marketDataUrl}/stocks`, {
            params: { page, limit: 1000 },
            timeout: 10_000,
          });

          const pageStocks = response.data.data || [];
          if (pageStocks.length === 0) {
            // No stocks loaded yet - wait and retry
            if (page === 1 && allStocks.length === 0) {
              console.log(
                `[signal-engine] waiting for market-data-service to load stocks... (attempt ${attempts + 1}/${MAX_RETRIES})`,
              );
              await new Promise((resolve) => setTimeout(resolve, 2500));
              attempts++;
              continue;
            }
            hasMore = false;
          } else {
            allStocks.push(...pageStocks);
            hasMore = response.data.hasMore ?? false;
            page++;
            attempts = 0; // Reset attempts on success
          }
        } catch (error) {
          attempts++;
          if (attempts >= MAX_RETRIES) throw error;
          console.warn(
            `[signal-engine] fetch stocks failed (attempt ${attempts}/${MAX_RETRIES}): ${(error as Error).message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
      }

      if (allStocks.length === 0) {
        console.warn(
          `[signal-engine] no stocks available from market-data-service after ${MAX_RETRIES} attempts; warmup incomplete`,
        );
        return;
      }

      console.log(`[signal-engine] warming up ${allStocks.length} symbols...`);

      // Load candles in batches with per-symbol error handling
      const BATCH_SIZE = 10;
      let loaded = 0;
      for (let i = 0; i < allStocks.length; i += BATCH_SIZE) {
        const batch = allStocks.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async ({ symbol }) => {
            try {
              const { data } = await axios.get<Candle[]>(
                `${this.marketDataUrl}/stocks/${symbol}/candles`,
                { params: { timeframe: Timeframe.ONE_DAY, limit: 600 }, timeout: 10_000 },
              );
              if (data && data.length > 0) {
                this.candles.set(symbol, data);
                loaded++;
              }
            } catch (error) {
              // Silently skip symbols that fail to load
              if (process.env.DEBUG_WARMUP === 'true') {
                console.warn(
                  `[signal-engine] warmup failed for ${symbol}: ${(error as Error).message}`,
                );
              }
            }
          }),
        );
        if (loaded % 20 === 0 || loaded === allStocks.length) {
          console.log(`[signal-engine] warmed up ${loaded}/${allStocks.length} symbols`);
        }
      }
      console.log(
        `[signal-engine] warmup complete: ${this.candles.size}/${allStocks.length} symbols ready`,
      );
    } catch (error) {
      console.warn(`[signal-engine] warmup failed: ${(error as Error).message}`);
    }
  }

  async refreshFromRest(symbol: string): Promise<void> {
    const { data } = await axios.get<Candle[]>(`${this.marketDataUrl}/stocks/${symbol}/candles`, {
      params: { timeframe: Timeframe.ONE_DAY, limit: 600 },
      timeout: 10_000,
    });
    this.candles.set(symbol, data);
  }
}
