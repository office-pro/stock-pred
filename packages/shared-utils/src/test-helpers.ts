import { Candle, Timeframe } from '@stockpred/shared-types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build a deterministic daily candle series from a close-price path. */
export function candlesFromCloses(
  closes: number[],
  options: { symbol?: string; volumes?: number[]; startTime?: number } = {},
): Candle[] {
  const symbol = options.symbol ?? 'TEST';
  const startTime = options.startTime ?? Date.UTC(2024, 0, 1);
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.995;
    return {
      symbol,
      timeframe: Timeframe.ONE_DAY,
      time: startTime + i * DAY_MS,
      open,
      high,
      low,
      close,
      volume: options.volumes?.[i] ?? 1000,
    };
  });
}

/**
 * Accelerating exponential uptrend: the rising growth rate keeps the MACD
 * line expanding above its signal line (histogram > 0) so trend rules are
 * deterministically bullish at the end of the series.
 */
export function uptrendCloses(bars: number, base = 100): number[] {
  const closes: number[] = [];
  let price = base;
  for (let i = 0; i < bars; i += 1) {
    const rate = 0.0008 + 0.003 * (i / bars);
    price *= Math.exp(rate);
    closes.push(price);
  }
  return closes;
}

/** Accelerating exponential downtrend (deterministically bearish MACD). */
export function downtrendCloses(bars: number, base = 200): number[] {
  const closes: number[] = [];
  let price = base;
  for (let i = 0; i < bars; i += 1) {
    const rate = 0.0008 + 0.003 * (i / bars);
    price *= Math.exp(-rate);
    closes.push(price);
  }
  return closes;
}
