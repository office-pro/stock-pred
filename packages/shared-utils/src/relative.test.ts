import { MarketIndex } from '@stockpred/shared-types';
import { compareToBenchmark } from './relative';
import { candlesFromCloses } from './test-helpers';

describe('compareToBenchmark', () => {
  it('measures outperformance against the benchmark', () => {
    const stock = candlesFromCloses([100, 105, 110, 115, 120]); // +20%
    const bench = candlesFromCloses([100, 102, 105, 108, 110]); // +10%
    const result = compareToBenchmark('TEST', MarketIndex.NIFTY_MIDCAP_100, stock, bench, 5);
    expect(result).not.toBeNull();
    expect(result?.relativeStrength).toBeCloseTo(1.2 / 1.1, 1);
    expect(result?.relativePerformancePercent).toBeCloseTo(10, 0);
    expect(result?.benchmark).toBe(MarketIndex.NIFTY_MIDCAP_100);
  });

  it('returns null when there is not enough data', () => {
    expect(
      compareToBenchmark(
        'TEST',
        MarketIndex.NIFTY_50,
        candlesFromCloses([100]),
        candlesFromCloses([100]),
        60,
      ),
    ).toBeNull();
  });
});
