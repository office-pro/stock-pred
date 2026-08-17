import type { Candle, MarketStructure, TrendStructure } from '@stockpred/shared-types';
import { round2 } from './math';
import { findSwingPoints } from './support-resistance';

function consecutiveRising(values: number[]): number {
  let count = 0;
  for (let i = values.length - 1; i > 0; i -= 1) {
    if (values[i] > values[i - 1]) count += 1;
    else break;
  }
  return count;
}

function consecutiveFalling(values: number[]): number {
  let count = 0;
  for (let i = values.length - 1; i > 0; i -= 1) {
    if (values[i] < values[i - 1]) count += 1;
    else break;
  }
  return count;
}

function pairCounts(values: number[]): { higher: number; lower: number } {
  let higher = 0;
  let lower = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[i - 1]) higher += 1;
    else if (values[i] < values[i - 1]) lower += 1;
  }
  return { higher, lower };
}

function closeSlope(candles: Candle[], bars = 20): number {
  const window = candles.slice(-bars);
  if (window.length < 5) return 0;
  const n = window.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += window[i].close;
    sumXY += i * window[i].close;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const first = window[0].close;
  return first > 0 ? (slope / first) * 100 : 0;
}

/** Higher-high / higher-low (and inverse) structure from swing points. */
export function detectMarketStructure(candles: Candle[], lookback = 3): MarketStructure {
  const empty: MarketStructure = {
    higherHighs: 0,
    higherLows: 0,
    lowerHighs: 0,
    lowerLows: 0,
    consecutiveHH: 0,
    consecutiveHL: 0,
    consecutiveLH: 0,
    consecutiveLL: 0,
    trend: 'INSUFFICIENT',
    slope: round2(closeSlope(candles)),
  };
  if (candles.length < lookback * 8) return empty;
  const { highs, lows } = findSwingPoints(candles, lookback);
  const recentHighs = highs.slice(-8).map((s) => s.price);
  const recentLows = lows.slice(-8).map((s) => s.price);
  if (recentHighs.length < 3 || recentLows.length < 3) return empty;

  const highPairs = pairCounts(recentHighs);
  const lowPairs = pairCounts(recentLows);
  const consecutiveHH = consecutiveRising(recentHighs);
  const consecutiveHL = consecutiveRising(recentLows);
  const consecutiveLH = consecutiveFalling(recentHighs);
  const consecutiveLL = consecutiveFalling(recentLows);

  let trend: TrendStructure = 'MIXED';
  if (consecutiveHH >= 2 && consecutiveHL >= 2) trend = 'HH_HL';
  else if (consecutiveLH >= 2 && consecutiveLL >= 2) trend = 'LH_LL';

  return {
    higherHighs: highPairs.higher,
    higherLows: lowPairs.higher,
    lowerHighs: highPairs.lower,
    lowerLows: lowPairs.lower,
    consecutiveHH,
    consecutiveHL,
    consecutiveLH,
    consecutiveLL,
    trend,
    slope: round2(closeSlope(candles)),
  };
}
