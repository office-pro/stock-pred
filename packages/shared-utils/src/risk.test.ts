import { positionSize, riskRewardRatio } from './risk';

describe('positionSize', () => {
  it('sizes by the 1% risk budget', () => {
    // 1% of 100000 = 1000 risk budget; 5 risk per share -> 200 shares.
    expect(positionSize(100000, 1, 100, 95)).toBe(200);
  });

  it('caps by available capital', () => {
    // Risk math would allow 1000 shares but capital only buys 100.
    expect(positionSize(10000, 1, 100, 99.9)).toBe(100);
  });

  it('returns 0 for degenerate inputs', () => {
    expect(positionSize(100000, 1, 100, 100)).toBe(0);
    expect(positionSize(0, 1, 100, 95)).toBe(0);
    expect(positionSize(100000, 0, 100, 95)).toBe(0);
  });
});

describe('riskRewardRatio', () => {
  it('computes reward over risk', () => {
    expect(riskRewardRatio(100, 110, 95)).toBe(2);
  });

  it('returns 0 when the stop is above the entry', () => {
    expect(riskRewardRatio(100, 110, 105)).toBe(0);
  });
});
