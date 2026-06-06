import type { Candle } from '@stockpred/shared-types';

/**
 * Market data provider port (hexagonal architecture).
 * Implementations: SimulatedProvider (default, offline-friendly) and
 * YahooProvider (real historical candles). A licensed NSE/broker feed
 * (Zerodha Kite, Upstox, ...) plugs in behind this same interface.
 */
export interface MarketDataProvider {
  readonly name: string;
  /** Daily history, oldest first. */
  getDailyHistory(symbol: string, days: number, basePrice: number): Promise<Candle[]>;
}
