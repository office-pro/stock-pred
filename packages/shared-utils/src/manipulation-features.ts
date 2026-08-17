import type { Candle, ManipulationSnapshot } from '@stockpred/shared-types';
import { analyzeVolume } from './volume';
import { clamp, mean, pctChange, round2, std } from './math';

export const MANIPULATION_MIN_BARS = 61;
const PROFILE_LOOKBACK = 120;
const Z_CAP = 4;

export interface BuildManipulationInput {
  candles: Candle[];
  niftyCandles?: Candle[];
  investigateProbability?: number | null;
  modelVersion?: string | null;
}

export interface StockBehaviorProfile {
  return1dMean: number;
  return1dStd: number;
  rangeMean: number;
  rangeStd: number;
  vol20Mean: number;
  vol20Std: number;
  volumeMean: number;
  volumeStd: number;
  return1dP90: number;
  return1dP95: number;
  return1dP99: number;
  bars: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function zScore(value: number, average: number, deviation: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(average)) return 0;
  const floor = Math.max(Math.abs(average) * 0.001, 1e-6);
  const sigma = Number.isFinite(deviation) && Math.abs(deviation) >= floor ? deviation : floor;
  return (value - average) / sigma;
}

/** Map |z| to 0–100 with |z| >= 4 → 100. */
export function zToAnomaly(z: number): number {
  return round2(clamp((Math.abs(z) / Z_CAP) * 100, 0, 100));
}

function periodReturn(candles: Candle[], bars: number): number {
  if (candles.length < bars + 1) return 0;
  const from = candles[candles.length - 1 - bars].close;
  const to = candles[candles.length - 1].close;
  return pctChange(from, to);
}

function closeReturns(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    out.push(pctChange(candles[i - 1].close, candles[i].close));
  }
  return out;
}

function rangePct(candle: Candle): number {
  if (candle.close <= 0) return 0;
  return ((candle.high - candle.low) / candle.close) * 100;
}

function rollingStd(values: number[], window: number): number {
  if (values.length < 2) return 0;
  return std(values.slice(-window));
}

function alignedTailReturns(stock: Candle[], nifty: Candle[], bars: number): number {
  if (stock.length < bars + 1 || nifty.length < bars + 1) return 0;
  return periodReturn(stock, bars) - periodReturn(nifty, bars);
}

/** Build a per-stock normal profile from history excluding the latest bar. */
export function buildBehaviorProfile(candles: Candle[]): StockBehaviorProfile | null {
  if (candles.length < MANIPULATION_MIN_BARS) return null;
  const history = candles.slice(Math.max(0, candles.length - 1 - PROFILE_LOOKBACK), -1);
  if (history.length < 40) return null;
  const returns = closeReturns(history);
  if (returns.length < 20) return null;
  const absReturns = [...returns].map(Math.abs).sort((a, b) => a - b);
  const ranges = history.map(rangePct);
  const volumes = history.map((c) => c.volume);
  const vol20: number[] = [];
  for (let i = 20; i <= returns.length; i += 1) {
    vol20.push(std(returns.slice(i - 20, i)));
  }
  return {
    return1dMean: mean(returns),
    return1dStd: std(returns),
    rangeMean: mean(ranges),
    rangeStd: std(ranges),
    vol20Mean: vol20.length ? mean(vol20) : 0,
    vol20Std: vol20.length ? std(vol20) : 0,
    volumeMean: mean(volumes),
    volumeStd: std(volumes),
    return1dP90: percentile(absReturns, 90),
    return1dP95: percentile(absReturns, 95),
    return1dP99: percentile(absReturns, 99),
    bars: history.length,
  };
}

function windowZ(values: number[], window: number): number {
  if (values.length < 3) return 0;
  const last = values[values.length - 1];
  const prior = values.slice(Math.max(0, values.length - window - 1), -1);
  if (prior.length < 5) return 0;
  return zScore(last, mean(prior), std(prior));
}

export function manipulationBand(intensity: number): ManipulationSnapshot['band'] {
  if (intensity >= 70) return 'INVESTIGATE';
  if (intensity >= 40) return 'SUSPICIOUS';
  return 'NORMAL';
}

/**
 * Statistical unusual-behavior snapshot for the latest daily bar.
 * Compares today to this stock's own history, not a global % move rule.
 */
export function buildManipulationSnapshot(
  input: BuildManipulationInput,
): ManipulationSnapshot | null {
  const candles = input.candles;
  if (candles.length < MANIPULATION_MIN_BARS) return null;
  const profile = buildBehaviorProfile(candles);
  if (!profile) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const nifty = input.niftyCandles ?? [];
  const volume = analyzeVolume(candles);
  const returns = closeReturns(candles);
  const lastReturn = returns[returns.length - 1] ?? 0;
  const prevReturn = returns[returns.length - 2] ?? 0;
  const return5 = periodReturn(candles, 5);
  const gap = prev.close > 0 ? pctChange(prev.close, last.open) : 0;
  const range = rangePct(last);
  const rollingVol14 = rollingStd(returns, 14);
  const high20 = Math.max(...candles.slice(-20).map((c) => c.high));
  const drawdown = high20 > 0 ? pctChange(high20, last.close) : 0;
  const acceleration = lastReturn - prevReturn;
  const volumes = candles.map((c) => c.volume);
  const volumeZ20 = windowZ(volumes, 20);
  const volumeZ60 = windowZ(volumes, 60);
  const rel1 = alignedTailReturns(candles, nifty, 1);

  const idio: number[] = [];
  if (nifty.length >= 2) {
    const n = Math.min(candles.length, nifty.length);
    const stockTail = candles.slice(-n);
    const niftyTail = nifty.slice(-n);
    const stockR = closeReturns(stockTail);
    const niftyR = closeReturns(niftyTail);
    const m = Math.min(stockR.length, niftyR.length);
    for (let i = 0; i < m; i += 1) {
      idio.push(stockR[stockR.length - m + i] - niftyR[niftyR.length - m + i]);
    }
  }
  const idioLast = idio[idio.length - 1] ?? rel1;
  const idioPrior = idio.slice(0, -1);
  const idioZ = idioPrior.length >= 20 ? zScore(idioLast, mean(idioPrior), std(idioPrior)) : 0;

  const priceZ = zScore(lastReturn, profile.return1dMean, profile.return1dStd);
  const rangeZ = zScore(range, profile.rangeMean, profile.rangeStd);
  const vol20Z = zScore(rollingVol14, profile.vol20Mean, profile.vol20Std);

  const priceAnomaly = zToAnomaly(priceZ);
  const volumeAnomaly = round2(Math.max(zToAnomaly(volumeZ20), zToAnomaly(volumeZ60)));
  const volatilityAnomaly = round2(Math.max(zToAnomaly(rangeZ), zToAnomaly(vol20Z)));
  const marketRelativeAnomaly = round2(
    Math.max(zToAnomaly(idioZ), zToAnomaly(rel1 / Math.max(profile.return1dStd, 0.25))),
  );

  const weighted =
    0.3 * priceAnomaly +
    0.3 * volumeAnomaly +
    0.2 * volatilityAnomaly +
    0.2 * marketRelativeAnomaly;
  const peak = Math.max(priceAnomaly, volumeAnomaly, volatilityAnomaly, marketRelativeAnomaly);
  const investigateIntensity = round2(clamp(0.7 * weighted + 0.3 * peak, 0, 100));

  const accumulation =
    Math.abs(return5) < 3 && volume.volumeTrend > 20 && Math.abs(lastReturn) < 1.5;
  const expansion = lastReturn > 1 && acceleration > 0 && volumeZ20 > 1.5;
  const dump = lastReturn < -3 && return5 > 4 && volumeZ20 > 1.5;

  const evidence: string[] = [];
  if (volume.volumeRatio >= 1.5) {
    evidence.push(`volume ${volume.volumeRatio.toFixed(1)}× 20d avg`);
  }
  if (Math.abs(lastReturn) >= Math.max(profile.return1dP90, 2)) {
    const zLabel = priceZ >= 0 ? `z=${priceZ.toFixed(1)}` : `z=${priceZ.toFixed(1)}`;
    evidence.push(
      `1d ${lastReturn >= 0 ? '+' : ''}${lastReturn.toFixed(1)}% (${zLabel} vs this stock)`,
    );
  }
  if (nifty.length >= 2 && Math.abs(rel1) >= 1.5) {
    const nifty1 = periodReturn(nifty, 1);
    evidence.push(
      `${lastReturn >= 0 ? '+' : ''}${lastReturn.toFixed(1)}% vs Nifty ${nifty1 >= 0 ? '+' : ''}${nifty1.toFixed(1)}%`,
    );
  }
  if (Math.abs(gap) >= 2) {
    evidence.push(`gap ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%`);
  }
  if (dump) evidence.push('sharp reversal on elevated volume');
  if (expansion) evidence.push('price and volume accelerating');
  if (accumulation) evidence.push('stable price with rising volume');
  if (drawdown <= -8) evidence.push(`drawdown ${drawdown.toFixed(1)}% from 20d high`);
  if (evidence.length === 0) {
    evidence.push("in line with this stock's typical daily range");
  }

  const mlProb =
    input.investigateProbability != null && Number.isFinite(input.investigateProbability)
      ? clamp(input.investigateProbability, 0, 1)
      : null;

  return {
    band: manipulationBand(investigateIntensity),
    investigateIntensity,
    investigateProbability: mlProb,
    priceAnomaly,
    volumeAnomaly,
    volatilityAnomaly,
    marketRelativeAnomaly,
    evidence: evidence.slice(0, 6),
    flags: { accumulation, expansion, dump },
    modelVersion: input.modelVersion ?? 'statistical-v1',
  };
}

/** Last-bar feature vector for tests / debugging (percent units). */
export function lastManipulationFeatures(candles: Candle[], niftyCandles: Candle[] = []) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const returns = closeReturns(candles);
  const volumes = candles.map((c) => c.volume);
  return {
    return1d: returns[returns.length - 1] ?? 0,
    return5d: periodReturn(candles, 5),
    return10d: periodReturn(candles, 10),
    return20d: periodReturn(candles, 20),
    gap: prev ? pctChange(prev.close, last.open) : 0,
    range: rangePct(last),
    closeLocation: last.high > last.low ? (last.close - last.low) / (last.high - last.low) : 0.5,
    rollingVol7: rollingStd(returns, 7),
    rollingVol14: rollingStd(returns, 14),
    rollingVol30: rollingStd(returns, 30),
    acceleration: (returns[returns.length - 1] ?? 0) - (returns[returns.length - 2] ?? 0),
    volumeZ20: windowZ(volumes, 20),
    volumeZ60: windowZ(volumes, 60),
    relReturn1d: alignedTailReturns(candles, niftyCandles, 1),
    relReturn5d: alignedTailReturns(candles, niftyCandles, 5),
    relReturn20d: alignedTailReturns(candles, niftyCandles, 20),
    signedReturnVolumeZ: (returns[returns.length - 1] ?? 0) * windowZ(volumes, 20),
  };
}
