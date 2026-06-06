/** Round to 2 decimals (price precision used across the platform). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Population standard deviation. */
export function std(values: number[]): number {
  if (values.length === 0) return NaN;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

/** Last finite value of a series, or null. */
export function lastFinite(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
