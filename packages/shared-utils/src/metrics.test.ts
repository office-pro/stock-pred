import {
  cagr,
  maxDrawdown,
  periodicReturns,
  profitFactor,
  sharpeRatio,
  sortinoRatio,
  winRate,
} from './metrics';

describe('periodicReturns', () => {
  it('computes simple returns', () => {
    const returns = periodicReturns([100, 110, 99]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.1, 10);
    expect(returns[1]).toBeCloseTo(-0.1, 10);
  });
});

describe('sharpeRatio', () => {
  it('is 0 for constant returns', () => {
    expect(sharpeRatio([0.01, 0.01, 0.01])).toBe(0);
  });

  it('is positive for consistently positive, varying returns', () => {
    expect(sharpeRatio([0.01, 0.02, 0.015, 0.012, 0.018])).toBeGreaterThan(0);
  });

  it('returns 0 with insufficient data', () => {
    expect(sharpeRatio([0.01])).toBe(0);
  });
});

describe('sortinoRatio', () => {
  it('caps when there is no downside', () => {
    expect(sortinoRatio([0.01, 0.02, 0.03])).toBe(999);
  });

  it('is finite with mixed returns', () => {
    const value = sortinoRatio([0.02, -0.01, 0.03, -0.02, 0.01]);
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe('cagr', () => {
  it('matches doubling in one year', () => {
    expect(cagr(100, 200, 1)).toBeCloseTo(100, 6);
  });

  it('matches compounding over two years', () => {
    expect(cagr(100, 400, 2)).toBeCloseTo(100, 6);
  });

  it('guards invalid inputs', () => {
    expect(cagr(0, 100, 1)).toBe(0);
    expect(cagr(100, 0, 1)).toBe(-100);
  });
});

describe('maxDrawdown', () => {
  it('finds the deepest peak-to-trough fall', () => {
    expect(maxDrawdown([100, 120, 60, 130])).toBeCloseTo(50, 6);
  });

  it('is 0 for a monotonic rise', () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });
});

describe('profitFactor', () => {
  it('divides gross profit by gross loss', () => {
    expect(profitFactor([10, -5])).toBe(2);
  });

  it('caps when there are no losses', () => {
    expect(profitFactor([5, 10])).toBe(999);
  });

  it('is 0 with no profits', () => {
    expect(profitFactor([-5])).toBe(0);
    expect(profitFactor([])).toBe(0);
  });
});

describe('winRate', () => {
  it('computes the percentage of winning trades', () => {
    expect(winRate([1, -1, 2, 3])).toBe(75);
    expect(winRate([])).toBe(0);
  });
});
