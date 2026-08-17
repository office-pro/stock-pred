import type { Candle, HorizonForecast } from '@stockpred/shared-types';
import { round2 } from './math';

export interface DirectionProbs {
  up: number;
  down: number;
  sideways: number;
  confidence: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

function forwardReturns(
  closes: number[],
  bars: number,
): { ret: number; cls: 'UP' | 'DOWN' | 'SIDEWAYS' }[] {
  const out: { ret: number; cls: 'UP' | 'DOWN' | 'SIDEWAYS' }[] = [];
  const threshold = bars <= 5 ? 0.02 : bars <= 10 ? 0.03 : 0.04;
  for (let i = 0; i < closes.length - bars; i += 1) {
    const start = closes[i];
    if (start <= 0) continue;
    const ret = closes[i + bars] / start - 1;
    let cls: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';
    if (ret > threshold) cls = 'UP';
    else if (ret < -threshold) cls = 'DOWN';
    out.push({ ret: ret * 100, cls });
  }
  return out;
}

function blend(rows: { ret: number; cls: string }[], probs: DirectionProbs): number {
  const up = rows.filter((r) => r.cls === 'UP').map((r) => r.ret);
  const down = rows.filter((r) => r.cls === 'DOWN').map((r) => r.ret);
  const side = rows.filter((r) => r.cls === 'SIDEWAYS').map((r) => r.ret);
  const pUp = probs.up / 100;
  const pDown = probs.down / 100;
  const pSide = probs.sideways / 100;
  return pUp * median(up) + pDown * median(down) + pSide * median(side);
}

/**
 * 5/10/20-session expected returns from past forward moves, weighted by
 * current UP/DOWN/SIDEWAYS probabilities. No future bars enter the estimate.
 */
export function estimateHorizonForecast(candles: Candle[], probs: DirectionProbs): HorizonForecast {
  const closes = candles.map((c) => c.close);
  const r5 = forwardReturns(closes, 5);
  const r10 = forwardReturns(closes, 10);
  const r20 = forwardReturns(closes, 20);
  const all20 = r20.map((r) => r.ret).sort((a, b) => a - b);
  const samples = Math.min(r5.length, r10.length, r20.length);
  const sampleFactor = Math.min(1, samples / 40);
  return {
    upProbability: round2(probs.up),
    downProbability: round2(probs.down),
    sidewaysProbability: round2(probs.sideways),
    expectedReturn5d: round2(blend(r5, probs)),
    expectedReturn10d: round2(blend(r10, probs)),
    expectedReturn20d: round2(blend(r20, probs)),
    bearCase20d: round2(percentile(all20, 10)),
    baseCase20d: round2(percentile(all20, 50)),
    bullCase20d: round2(percentile(all20, 90)),
    confidence: round2(clamp01(probs.confidence * sampleFactor)),
  };
}

function clamp01(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function defaultProbsFromMove(expectedMove: number, confidence: number): DirectionProbs {
  if (expectedMove > 0.3) {
    const up = Math.min(90, 50 + confidence * 0.4);
    const down = Math.max(5, (100 - up) * 0.35);
    return { up, down, sideways: 100 - up - down, confidence };
  }
  if (expectedMove < -0.3) {
    const down = Math.min(90, 50 + confidence * 0.4);
    const up = Math.max(5, (100 - down) * 0.35);
    return { up, down, sideways: 100 - up - down, confidence };
  }
  return { up: 33, down: 33, sideways: 34, confidence: Math.min(confidence, 50) };
}
