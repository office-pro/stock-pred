import { PredictionHorizon } from './ml';
import type { BullRunSnapshot } from './scanner';

/** Exchanges supported by the platform. */
export enum Exchange {
  NSE = 'NSE',
  BSE = 'BSE',
}

/** Index universes tracked on the dashboard. */
export enum MarketIndex {
  NIFTY_50 = 'NIFTY_50',
  NIFTY_MIDCAP_100 = 'NIFTY_MIDCAP_100',
  NIFTY_SMALLCAP_100 = 'NIFTY_SMALLCAP_100',
  INDIA_VIX = 'INDIA_VIX',
}

export enum Timeframe {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  ONE_HOUR = '1h',
  ONE_DAY = '1d',
}

/** A single OHLCV candle. `time` is epoch milliseconds (UTC). */
export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A live market tick. */
export interface Tick {
  symbol: string;
  exchange: Exchange;
  price: number;
  volume: number;
  time: number;
}

/** One level of the order book. */
export interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

/** Five-level market depth snapshot. */
export interface MarketDepth {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  time: number;
}

/** Technical indicator snapshot computed on candle close. */
export interface IndicatorSnapshot {
  symbol: string;
  time: number;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  vwap: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  avgVolume20: number | null;
}

/** A tradable instrument. */
export interface StockInfo {
  symbol: string;
  name: string;
  exchange: Exchange;
  sector: string;
  indices: MarketIndex[];
}

/**
 * Provenance of a symbol's data:
 *  - live: real provider data, refreshed this session
 *  - cached: real data served from the database (offline mode)
 *  - listed: in the official NSE/BSE master, candles not loaded yet
 *  - simulated: synthetic fallback (fresh install with no network/cache)
 */
export type MarketDataSource = 'live' | 'cached' | 'listed' | 'simulated';

export type TradeSuggestion = 'BUY' | 'SELL' | 'HOLD';

/** Actionable paper-trading levels derived from ML + ATR. */
export interface TradeAdvisory {
  action: TradeSuggestion;
  horizon: PredictionHorizon;
  entry: number | null;
  target: number | null;
  stopLoss: number | null;
  quantity: number;
  confidence: number;
  expectedMove: number;
  modelVersion: string | null;
}

/** Live quote merged with indicator snapshot for dashboard rows. */
export interface StockQuote extends StockInfo {
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  indicators: IndicatorSnapshot | null;
  dataSource: MarketDataSource;
  /** BUY/SELL/HOLD from blended ML confidence + stock/Nifty trend. */
  suggestion: TradeSuggestion;
  horizon: PredictionHorizon;
  entry: number | null;
  target: number | null;
  stopLoss: number | null;
  quantity: number;
  confidence: number;
  expectedMove: number;
  modelVersion: string | null;
  /** NIFTY 50 relative strength over ~60 sessions; > 1 outperforms. */
  relativeStrengthNifty50?: number | null;
  scanner?: BullRunSnapshot | null;
  updatedAt: number;
}

/** Index quote for the dashboard header. */
export interface IndexQuote {
  index: MarketIndex;
  name: string;
  value: number;
  change: number;
  changePercent: number;
  updatedAt: number;
}

/** Relative comparison of a stock against a benchmark index. */
export interface RelativeComparison {
  symbol: string;
  benchmark: MarketIndex;
  /** Ratio of cumulative returns: > 1 means the stock outperforms. */
  relativeStrength: number;
  /** Outperformance in percentage points over the window. */
  relativePerformancePercent: number;
  windowDays: number;
}
