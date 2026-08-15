import type {
  Candle,
  IndicatorSnapshot,
  MarketDataSource,
  StockInfo,
  Tick,
} from '@stockpred/shared-types';

/** In-memory state for one instrument. */
export interface SymbolState {
  info: StockInfo;
  /** Daily history including today's evolving candle as the last element. */
  daily: Candle[];
  /** Closed 1-minute candles (ring buffer). */
  intraday: Candle[];
  /** Current open 1-minute candle. */
  currentMinute: Candle | null;
  lastTick: Tick | null;
  previousClose: number;
  dayVolume: number;
  indicators: IndicatorSnapshot | null;
  /** Provenance: live provider, cached real data, or simulated fallback. */
  dataSource: MarketDataSource;
  isin?: string | null;
  bseCode?: string | null;
}

export const INTRADAY_BUFFER = 500;

export interface IndexState {
  name: string;
  displayName: string;
  daily: Candle[];
  value: number;
  previousClose: number;
  dataSource: MarketDataSource;
}
