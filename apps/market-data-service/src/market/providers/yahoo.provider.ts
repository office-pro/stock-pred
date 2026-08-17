import axios from 'axios';
import { Candle, Timeframe } from '@stockpred/shared-types';
import { round2, withRetry } from '@stockpred/shared-utils';
import type { MarketDataProvider } from './provider.interface';

interface YahooChartResponse {
  chart: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        previousClose?: number;
        chartPreviousClose?: number;
      };
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
/** A browser-like UA avoids Yahoo's bot filtering. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const INDEX_TICKERS: Record<string, string> = {
  NIFTY_50: '^NSEI',
  NIFTY_MIDCAP_100: 'NIFTY_MIDCAP_100.NS',
  NIFTY_SMALLCAP_100: 'SML100CASE.NS',
  INDIA_VIX: '^INDIAVIX',
};

export interface YahooSymbolHint {
  exchange?: string;
  bseCode?: string | null;
  yahooSymbol?: string | null;
}

/** Last trade: price plus the exchange timestamp of that print. */
export interface TodayPrint {
  candle: Candle;
  listedAt: number;
  previousClose?: number;
}

/** NSE, BSE, and scrip-code tickers so newly listed / BSE-primary names still resolve. */
export function yahooTickerCandidates(symbol: string, hint?: YahooSymbolHint): string[] {
  if (INDEX_TICKERS[symbol]) return [INDEX_TICKERS[symbol]];
  const out: string[] = [];
  const add = (ticker?: string | null): void => {
    if (!ticker) return;
    if (!out.includes(ticker)) out.push(ticker);
  };
  add(hint?.yahooSymbol);
  const exchange = hint?.exchange?.toUpperCase();
  if (exchange === 'BSE') {
    if (hint?.bseCode) add(`${hint.bseCode}.BO`);
    add(`${symbol}.BO`);
    add(`${symbol}.NS`);
  } else {
    add(`${symbol}.NS`);
    add(`${symbol}.BO`);
    if (hint?.bseCode) add(`${hint.bseCode}.BO`);
  }
  return out;
}

/**
 * Real candles from Yahoo Finance.
 * Unofficial endpoint: throttled and retried. Failures THROW - the
 * fallback chain (database cache, then simulation as a clearly-flagged
 * last resort) is owned by the MarketService, never hidden in here.
 */
export class YahooProvider implements MarketDataProvider {
  readonly name = 'yahoo';
  /** Serialization chain: one in-flight Yahoo request at a time. */
  private chain: Promise<void> = Promise.resolve();

  async getDailyHistory(
    symbol: string,
    days: number,
    _basePrice: number,
    hint?: YahooSymbolHint,
  ): Promise<Candle[]> {
    const range = days > 1825 ? '10y' : days > 1095 ? '5y' : days > 365 ? '3y' : '1y';
    const tickers = yahooTickerCandidates(symbol, hint);
    let lastError: Error | null = null;
    for (const yahooSymbol of tickers) {
      try {
        const candles = await this.scheduled(() => this.fetchChart(symbol, yahooSymbol, range));
        if (candles.length === 0) {
          lastError = new Error(`${yahooSymbol} returned 0 candles`);
          continue;
        }
        console.log(
          `[market-data] yahoo: ${symbol} via ${yahooSymbol} -> ${candles.length} candles`,
        );
        return candles;
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[market-data] yahoo: ${symbol} via ${yahooSymbol} failed (${lastError.message})`,
        );
      }
    }
    throw lastError ?? new Error(`No Yahoo ticker resolved for ${symbol}`);
  }

  /**
   * Today's evolving daily candle, aggregated from real 5-minute intraday
   * rows. Returns null outside trading hours / when no intraday data exists.
   */
  async getTodayCandle(symbol: string, hint?: YahooSymbolHint): Promise<Candle | null> {
    const print = await this.getTodayPrint(symbol, hint);
    return print?.candle ?? null;
  }

  /**
   * Last listed print: last trade from chart meta (price + exchange time),
   * with 1-minute bars filling today's OHLC. Not the server clock.
   * Skips the daily-history queue so a viewed symbol is not stuck behind a sweep.
   */
  async getTodayPrint(symbol: string, hint?: YahooSymbolHint): Promise<TodayPrint | null> {
    return this.getLastTrade(symbol, hint);
  }

  async getLastTrade(symbol: string, hint?: YahooSymbolHint): Promise<TodayPrint | null> {
    const tickers = yahooTickerCandidates(symbol, hint);
    for (const yahooSymbol of tickers) {
      try {
        const print = await this.fetchLastTrade(symbol, yahooSymbol);
        if (print) return print;
      } catch (error) {
        console.warn(
          `[market-data] last-trade ${symbol} via ${yahooSymbol}: ${(error as Error).message}`,
        );
      }
    }
    return null;
  }

  private async fetchLastTrade(symbol: string, yahooSymbol: string): Promise<TodayPrint | null> {
    const response = await axios.get<YahooChartResponse>(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
      {
        params: { range: '1d', interval: '1m' },
        timeout: 12_000,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      },
    );
    const result = response.data.chart.result?.[0];
    const quote = result?.indicators.quote[0];
    const meta = result?.meta;
    let open: number | null = null;
    let high = -Infinity;
    let low = Infinity;
    let close: number | null = null;
    let volume = 0;
    let lastBarTime = 0;
    if (result?.timestamp && quote) {
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
        lastBarTime = result.timestamp[i] * 1000;
      }
    }
    const listedAt = (meta?.regularMarketTime ?? 0) * 1000 || lastBarTime;
    const lastPrice = meta?.regularMarketPrice ?? close;
    if (lastPrice == null || !Number.isFinite(lastPrice) || listedAt <= 0) return null;
    if (open === null) open = lastPrice;
    if (!Number.isFinite(high) || high === -Infinity) high = lastPrice;
    if (!Number.isFinite(low) || low === Infinity) low = lastPrice;
    if (lastPrice > high) high = lastPrice;
    if (lastPrice < low) low = lastPrice;
    const dayStart = new Date(listedAt);
    dayStart.setUTCHours(0, 0, 0, 0);
    return {
      listedAt,
      previousClose:
        meta?.previousClose && meta.previousClose > 0
          ? round2(meta.previousClose)
          : meta?.chartPreviousClose && meta.chartPreviousClose > 0
            ? round2(meta.chartPreviousClose)
            : undefined,
      candle: {
        symbol,
        timeframe: Timeframe.ONE_DAY,
        time: dayStart.getTime(),
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(lastPrice),
        volume,
      },
    };
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
      async () => {
        try {
          return await axios.get<YahooChartResponse>(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`,
            {
              params: { range, interval: '1d' },
              timeout: 8_000,
              headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            },
          );
        } catch (error: unknown) {
          // Fail fast on 404 - don't retry invalid tickers
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            throw new Error(`Request failed with status code 404`);
          }
          throw error;
        }
      },
      { retries: 1, delayMs: 500, backoff: 1 },
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
    if (candles.length === 0) {
      throw new Error(`${yahooSymbol} returned 0 usable candles`);
    }
    return candles;
  }
}
