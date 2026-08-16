import type { BreakoutFlags, Candle } from '@stockpred/shared-types';
import { analyzeVolume, volumeBreakoutMultiplier } from './volume';

function priorHigh(candles: Candle[], lookback: number): number | null {
  if (candles.length < lookback + 1) return null;
  const window = candles.slice(-(lookback + 1), -1);
  return Math.max(...window.map((c) => c.high));
}

/** 20/50/200-day and 52-week high breakouts with optional volume confirmation. */
export function detectBreakouts(
  candles: Candle[],
  multiplier = volumeBreakoutMultiplier(),
): BreakoutFlags {
  const last = candles[candles.length - 1];
  const lastHigh = last?.high ?? 0;
  const high20 = priorHigh(candles, 20);
  const high50 = priorHigh(candles, 50);
  const high200 = priorHigh(candles, 200);
  const yearWindow = candles.slice(-252, -1);
  const high52w = yearWindow.length >= 60 ? Math.max(...yearWindow.map((c) => c.high)) : null;
  const volume = analyzeVolume(candles, multiplier);
  const broke20 = high20 !== null && lastHigh > high20;
  const broke50 = high50 !== null && lastHigh > high50;
  const broke200 = high200 !== null && lastHigh > high200;
  const broke52 = high52w !== null && lastHigh > high52w;
  const anyBreak = broke20 || broke50 || broke200 || broke52;
  return {
    high20: broke20,
    high50: broke50,
    high200: broke200,
    high52w: broke52,
    volumeConfirmed: anyBreak && volume.unusual,
    volumeRatio: volume.volumeRatio,
  };
}
