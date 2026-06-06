import axios from 'axios';
import { Candle, Timeframe } from '@stockpred/shared-types';
import { round2, withRetry } from '@stockpred/shared-utils';
import type { MarketDataProvider } from './provider.interface';

interface YahooChartResponse {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: {
        quote: {
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }[];
      };
    }[];
    error?: { description?: string } | null;
  };
}

/** Yahoo rate-limits bursts hard; requests are serialized with this gap. */
const REQUEST_GAP_MS = 350;
/** Stale tickers can return a handful of rows; treat them as failures. */
const MIN_USABLE_CANDLES = 60;
/** A browser-like UA avoids Yahoo's bot filtering. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Real candles from Yahoo Finance (NSE symbols use the .NS suffix).
 * Unofficial endpoint: throttled and retried. Failures THROW - the
 * fallback chain (database cache, then simulation as a clearly-flagged
 * last resort) is owned by the MarketService, never hidden in here.
 */
export class YahooProvider implements MarketDataProvider {
  readonly name = 'yahoo';
  /** Serialization chain: one in-flight Yahoo request at a time. */
  private chain: Promise<void> = Promise.resolve();

  async getDailyHistory(symbol: string, days: number, _basePrice: number): Promise<Candle[]> {
    const range = days > 1825 ? '10y' : days > 1095 ? '5y' : days > 365 ? '3y' : '1y';
    const yahooSymbol = this.toYahooSymbol(symbol);
    const candles = await this.scheduled(() => this.fetchChart(symbol, yahooSymbol, range));
    console.log(`[market-data] yahoo: ${symbol} -> ${candles.length} candles`);
    return candles;
  }

  /**
   * Today's evolving daily candle, aggregated from real 5-minute intraday
   * rows. Returns null outside trading hours / when no intraday data exists.
   */
  async getTodayCandle(symbol: string): Promise<Candle | null> {
    const yahooSymbol = this.toYahooSymbol(symbol);
    return this.scheduled(async () => {
      const response = await axios.get<YahooChartResponse>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
        {
          params: { range: '1d', interval: '5m' },
          timeout: 15_000,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        },
      );
      const result = response.data.chart.result?.[0];
      const quote = result?.indicators.quote[0];
      if (!result?.timestamp || !quote || result.timestamp.length === 0) return null;

      let open: number | null = null;
      let high = -Infinity;
      let low = Infinity;
      let close: number | null = null;
      let volume = 0;
      let lastTime = 0;
      for (let i = 0; i < result.timestamp.length; i += 1) {
        const o = quote.open[i];
        const h = quote.high[i];
        const l = quote.low[i];
        const c = quote.close[i];
        if (o == null || h == null || l == null || c == null) continue;
        if (open === null) open = o;
        if (h > high) high = h;
        if (l < low) low = l;
        close = c;
        volume += quote.volume[i] ?? 0;
        lastTime = result.timestamp[i] * 1000;
      }
      if (open === null || close === null) return null;
      const dayStart = new Date(lastTime);
      dayStart.setUTCHours(0, 0, 0, 0);
      return {
        symbol,
        timeframe: Timeframe.ONE_DAY,
        time: dayStart.getTime(),
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume,
      };
    });
  }

  /** Queue a task behind all previous ones, with a politeness gap. */
  private scheduled<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)),
      () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)),
    );
    return result;
  }

  private async fetchChart(symbol: string, yahooSymbol: string, range: string): Promise<Candle[]> {
    const response = await withRetry(
      () =>
        axios.get<YahooChartResponse>(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
          {
            params: { range, interval: '1d' },
            timeout: 15_000,
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          },
        ),
      { retries: 3, delayMs: 1500, backoff: 2 },
    );
    const result = response.data.chart.result?.[0];
    const quote = result?.indicators.quote[0];
    if (!result?.timestamp || !quote) {
      throw new Error(response.data.chart.error?.description ?? 'Empty Yahoo response');
    }
    const candles: Candle[] = [];
    for (let i = 0; i < result.timestamp.length; i += 1) {
      const open = quote.open[i];
      const high = quote.high[i];
      const low = quote.low[i];
      const close = quote.close[i];
      if (open == null || high == null || low == null || close == null) continue;
      candles.push({
        symbol,
        timeframe: Timeframe.ONE_DAY,
        time: result.timestamp[i] * 1000,
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume: quote.volume[i] ?? 0,
      });
    }
    if (candles.length < MIN_USABLE_CANDLES) {
      throw new Error(`Yahoo returned only ${candles.length} candles`);
    }
    return candles;
  }

  private toYahooSymbol(symbol: string): string {
    const indexMap: Record<string, string> = {
      NIFTY_50: '^NSEI',
      NIFTY_MIDCAP_100: 'NIFTY_MIDCAP_100.NS',
      // Yahoo's smallcap index tickers (^CNXSC, NIFTY_SMLCAP_100.NS) are
      // stale; the Zerodha Smallcap-100 ETF tracks the index and trades live.
      NIFTY_SMALLCAP_100: 'SML100CASE.NS',
      INDIA_VIX: '^INDIAVIX',
    };
    return indexMap[symbol] ?? `${symbol}.NS`;
  }
}
