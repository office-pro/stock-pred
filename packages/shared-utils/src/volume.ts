import type { Candle } from '@stockpred/shared-types';
import { lastFinite, round2 } from './math';
import { sma } from './indicators';
import { getEnvNumber } from './env';

export function volumeBreakoutMultiplier(): number {
  return getEnvNumber('VOLUME_BREAKOUT_MULTIPLIER', 1.5);
}

export interface VolumeStats {
  avgVolume20: number | null;
  volumeRatio: number;
  volumeTrend: number;
  unusual: boolean;
}

/** Volume vs 20-day average, 5-vs-20 trend, and unusual-volume flag. */
export function analyzeVolume(
  candles: Candle[],
  multiplier = volumeBreakoutMultiplier(),
): VolumeStats {
  const volumes = candles.map((c) => c.volume);
  const avg20 = lastFinite(sma(volumes, 20));
  const last = volumes[volumes.length - 1] ?? 0;
  const ratio = avg20 && avg20 > 0 ? last / avg20 : 1;
  const recent = volumes.slice(-5);
  const prior = volumes.slice(-20, -5);
  const recentMean = recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
  const priorMean = prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : recentMean;
  const trend = priorMean > 0 ? (recentMean - priorMean) / priorMean : 0;
  return {
    avgVolume20: avg20 === null ? null : round2(avg20),
    volumeRatio: round2(ratio),
    volumeTrend: round2(trend * 100),
    unusual: ratio >= multiplier,
  };
}
