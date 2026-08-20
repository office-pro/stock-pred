import { Candle, Timeframe } from '@stockpred/shared-types';

const MINUTE_MS = 60_000;

/** Bucket size in ms for intraday timeframes. Daily is not aggregated here. */
export function timeframeBucketMs(timeframe: Timeframe): number | null {
  switch (timeframe) {
    case Timeframe.ONE_MINUTE:
      return MINUTE_MS;
    case Timeframe.FIVE_MINUTES:
      return 5 * MINUTE_MS;
    case Timeframe.FIFTEEN_MINUTES:
      return 15 * MINUTE_MS;
    case Timeframe.ONE_HOUR:
      return 60 * MINUTE_MS;
    case Timeframe.ONE_DAY:
      return null;
    default:
      return null;
  }
}

/**
 * Resample 1-minute (or finer) OHLCV bars into a coarser intraday timeframe.
 * Source bars should be sorted ascending by `time`.
 */
export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  if (candles.length === 0) return [];
  const bucketMs = timeframeBucketMs(timeframe);
  if (bucketMs == null) return candles.slice();
  if (timeframe === Timeframe.ONE_MINUTE) {
    return candles.map((c) => ({ ...c, timeframe: Timeframe.ONE_MINUTE }));
  }

  const out: Candle[] = [];
  let bucketStart = Number.NaN;
  let open = 0;
  let high = 0;
  let low = 0;
  let close = 0;
  let volume = 0;
  let symbol = candles[0].symbol;

  const flush = () => {
    if (!Number.isFinite(bucketStart)) return;
    out.push({
      symbol,
      timeframe,
      time: bucketStart,
      open,
      high,
      low,
      close,
      volume,
    });
  };

  for (const candle of candles) {
    const start = Math.floor(candle.time / bucketMs) * bucketMs;
    if (start !== bucketStart) {
      flush();
      bucketStart = start;
      symbol = candle.symbol;
      open = candle.open;
      high = candle.high;
      low = candle.low;
      close = candle.close;
      volume = candle.volume;
    } else {
      high = Math.max(high, candle.high);
      low = Math.min(low, candle.low);
      close = candle.close;
      volume += candle.volume;
    }
  }
  flush();
  return out;
}
