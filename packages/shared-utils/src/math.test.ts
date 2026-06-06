import { clamp, lastFinite, mean, pctChange, round2, std } from './math';

describe('math helpers', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(1.005)).toBeCloseTo(1.0, 1);
    expect(round2(123.456)).toBe(123.46);
  });

  it('computes mean and std', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(std([2, 2, 2])).toBe(0);
    expect(std([1, 3])).toBe(1);
    expect(Number.isNaN(mean([]))).toBe(true);
    expect(Number.isNaN(std([]))).toBe(true);
  });

  it('computes percent change', () => {
    expect(pctChange(100, 110)).toBe(10);
    expect(pctChange(0, 50)).toBe(0);
  });

  it('finds the last finite value', () => {
    expect(lastFinite([1, 2, NaN])).toBe(2);
    expect(lastFinite([NaN, NaN])).toBeNull();
  });

  it('clamps values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
