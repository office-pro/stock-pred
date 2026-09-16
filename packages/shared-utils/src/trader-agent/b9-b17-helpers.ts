/**
 * Shared helpers for B9–B17 advisory engines.
 * Deterministic. Never invents scores when history is insufficient.
 */
import type {
  IntelligenceProvenance,
  IntelligenceUnavailableReason,
} from '@stockpred/shared-types';

export const B9_B17_ENGINE_VERSION = 'b9-b17.intelligence.v1';
export const B9_B17_FEATURE_VERSION = 'features.b9-b17.v1';

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function provenance(
  source: string,
  extras: Partial<IntelligenceProvenance> = {},
  now: Date = new Date(),
): IntelligenceProvenance {
  return {
    analysisAt: nowIso(now),
    source,
    engineVersion: B9_B17_ENGINE_VERSION,
    featureVersion: B9_B17_FEATURE_VERSION,
    ...extras,
  };
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export function closesFromCandles(candles: Array<{ close?: number } | null | undefined>): number[] {
  return candles
    .map((c) => (c && typeof c.close === 'number' ? c.close : NaN))
    .filter((c) => Number.isFinite(c) && c > 0);
}

export function returnsFromCloses(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev > 0 && cur > 0) out.push(cur / prev - 1);
  }
  return out;
}

export function periodReturn(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const start = closes[closes.length - 1 - days];
  const end = closes[closes.length - 1];
  if (!(start > 0) || !(end > 0)) return null;
  return round4(end / start - 1);
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return round4(Math.sqrt(v));
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 10) return null;
  const a = xs.slice(-n);
  const b = ys.slice(-n);
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA <= 0 || denB <= 0) return null;
  return round4(num / Math.sqrt(denA * denB));
}

export function spearman(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 10) return null;
  const rank = (arr: number[]) => {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
    const ranks = new Array(arr.length);
    for (let r = 0; r < sorted.length; r++) ranks[sorted[r].i] = r + 1;
    return ranks as number[];
  };
  return pearson(rank(xs.slice(-n)), rank(ys.slice(-n)));
}

export function beta(assetReturns: number[], benchReturns: number[]): number | null {
  const n = Math.min(assetReturns.length, benchReturns.length);
  if (n < 10) return null;
  const a = assetReturns.slice(-n);
  const b = benchReturns.slice(-n);
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
    varB += (b[i] - meanB) ** 2;
  }
  if (varB <= 0) return null;
  return round4(cov / varB);
}

export function stabilityFromAbsCorr(
  absCorr: number | null,
  sampleSize: number,
): 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' {
  if (absCorr == null || !Number.isFinite(absCorr) || sampleSize < 20) return 'UNKNOWN';
  if (sampleSize >= 60 && absCorr >= 0.55) return 'HIGH';
  if (sampleSize >= 30 && absCorr >= 0.35) return 'MEDIUM';
  if (absCorr >= 0.2) return 'LOW';
  return 'UNKNOWN';
}

export function alignReturns(left: number[], right: number[]): { left: number[]; right: number[] } {
  const n = Math.min(left.length, right.length);
  return { left: left.slice(-n), right: right.slice(-n) };
}

export function insufficient(reason: IntelligenceUnavailableReason = 'INSUFFICIENT_HISTORY'): {
  status: 'UNAVAILABLE';
  reason: IntelligenceUnavailableReason;
} {
  return { status: 'UNAVAILABLE', reason };
}
