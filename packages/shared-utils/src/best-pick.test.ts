import {
  BEST_PICK_MAX_PER_SIDE,
  bestPickScore,
  expectedProfitPct,
  maxProfitAmong,
  selectBestPicks,
  sortQuotesBy,
} from './best-pick';

function row(
  overrides: Partial<Parameters<typeof selectBestPicks>[0][number]> & { symbol: string },
): Parameters<typeof selectBestPicks>[0][number] {
  return {
    suggestion: 'BUY',
    confidence: 90,
    entry: 100,
    target: 110,
    expectedMove: 4,
    ...overrides,
  };
}

describe('expectedProfitPct', () => {
  it('uses |target − entry| / entry when levels exist', () => {
    expect(expectedProfitPct({ entry: 100, target: 112, expectedMove: 1 })).toBeCloseTo(12);
    expect(expectedProfitPct({ entry: 200, target: 170, expectedMove: -2 })).toBeCloseTo(15);
  });

  it('falls back to |expectedMove| when target is missing', () => {
    expect(expectedProfitPct({ entry: 100, target: null, expectedMove: -3.5 })).toBeCloseTo(3.5);
  });
});

describe('selectBestPicks', () => {
  it('drops Holds, weak confidence, and thin profit', () => {
    const picked = selectBestPicks([
      row({ symbol: 'HOLDME', suggestion: 'HOLD', confidence: 99, target: 130 }),
      row({ symbol: 'WEAK', confidence: 60, target: 120 }),
      row({ symbol: 'THIN', confidence: 95, target: 101 }),
      row({ symbol: 'KEPT', confidence: 88, target: 108 }),
    ]);
    expect(picked.map((item) => item.symbol)).toEqual(['KEPT']);
  });

  it('keeps high-confidence high-profit names on both Buy and Sell', () => {
    const picked = selectBestPicks([
      row({ symbol: 'BUY1', suggestion: 'BUY', confidence: 92, entry: 100, target: 110 }),
      row({ symbol: 'SELL1', suggestion: 'SELL', confidence: 90, entry: 200, target: 170 }),
      row({ symbol: 'BUY2', suggestion: 'BUY', confidence: 80, entry: 50, target: 52 }),
    ]);
    expect(picked.map((item) => item.symbol)).toEqual(['SELL1', 'BUY1', 'BUY2']);
    expect(picked.some((item) => item.suggestion === 'BUY')).toBe(true);
    expect(picked.some((item) => item.suggestion === 'SELL')).toBe(true);
  });

  it('ranks by confidence × profit, not confidence alone', () => {
    const highConfLowProfit = row({
      symbol: 'SAFE',
      confidence: 99,
      entry: 100,
      target: 103,
    });
    const lowerConfHighProfit = row({
      symbol: 'JUICY',
      confidence: 80,
      entry: 100,
      target: 120,
    });
    expect(bestPickScore(lowerConfHighProfit)).toBeGreaterThan(bestPickScore(highConfLowProfit));
    expect(selectBestPicks([highConfLowProfit, lowerConfHighProfit])[0].symbol).toBe('JUICY');
  });

  it('filters to one side when asked', () => {
    const picked = selectBestPicks(
      [
        row({ symbol: 'BUY1', suggestion: 'BUY', target: 112 }),
        row({ symbol: 'SELL1', suggestion: 'SELL', entry: 100, target: 85 }),
      ],
      'SELL',
    );
    expect(picked.map((item) => item.symbol)).toEqual(['SELL1']);
  });

  it('caps each side', () => {
    const buys = Array.from({ length: BEST_PICK_MAX_PER_SIDE + 5 }, (_, index) =>
      row({ symbol: `B${index}`, suggestion: 'BUY', target: 110 + index }),
    );
    const picked = selectBestPicks(buys, 'BUY');
    expect(picked).toHaveLength(BEST_PICK_MAX_PER_SIDE);
  });
});

describe('sortQuotesBy and maxProfitAmong', () => {
  const juicier = row({ symbol: 'JUICY', confidence: 80, entry: 100, target: 120 });
  const safer = row({ symbol: 'SAFE', confidence: 99, entry: 100, target: 103 });

  it('sorts max profit first', () => {
    expect(sortQuotesBy([safer, juicier], 'profit')[0].symbol).toBe('JUICY');
  });

  it('sorts max confidence first', () => {
    expect(sortQuotesBy([juicier, safer], 'confidence')[0].symbol).toBe('SAFE');
  });

  it('reports the max profit percentage and symbol', () => {
    expect(maxProfitAmong([safer, juicier])).toEqual({ pct: 20, symbol: 'JUICY' });
  });
});
