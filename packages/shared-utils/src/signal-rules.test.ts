import { SignalType } from '@stockpred/shared-types';
import { evaluateSignal } from './signal-rules';
import { candlesFromCloses, downtrendCloses, uptrendCloses } from './test-helpers';

describe('evaluateSignal', () => {
  it('returns HOLD when there is not enough data', () => {
    const result = evaluateSignal(candlesFromCloses([100, 101, 102]));
    expect(result.type).toBe(SignalType.HOLD);
    expect(result.confidence).toBe(0);
  });

  it('returns HOLD for a flat market', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + 0.2 * Math.sin(i));
    const result = evaluateSignal(candlesFromCloses(closes));
    expect(result.type).toBe(SignalType.HOLD);
  });

  it('emits BUY on an uptrend breakout with volume', () => {
    const closes = uptrendCloses(259);
    // Final bar: 3% breakout above the prior 20-bar high on 5x volume.
    closes.push(closes[closes.length - 1] * 1.03);
    const volumes = closes.map(() => 1000);
    volumes[volumes.length - 1] = 5000;
    const result = evaluateSignal(candlesFromCloses(closes, { volumes }));
    expect(result.type).toBe(SignalType.BUY);
    expect(result.confidence).toBeGreaterThanOrEqual(70);
    expect(result.target).not.toBeNull();
    expect(result.stopLoss).not.toBeNull();
    expect(result.target as number).toBeGreaterThan(result.price);
    expect(result.stopLoss as number).toBeLessThan(result.price);
    expect(result.riskReward as number).toBeGreaterThan(0);
    expect(result.rules.emaShortAboveMid).toBe(true);
    expect(result.rules.macdBullish).toBe(true);
  });

  it('emits SELL on a downtrend breakdown', () => {
    const closes = downtrendCloses(259);
    closes.push(closes[closes.length - 1] * 0.97);
    const result = evaluateSignal(candlesFromCloses(closes));
    expect(result.type).toBe(SignalType.SELL);
    expect(result.confidence).toBeGreaterThanOrEqual(70);
    expect(result.target as number).toBeLessThan(result.price);
    expect(result.stopLoss as number).toBeGreaterThan(result.price);
    expect(result.rules.emaShortBelowMid).toBe(true);
    expect(result.rules.macdBearish).toBe(true);
  });

  it('never emits a BUY without the mandatory trend/momentum core', () => {
    // Strong downtrend: BUY core rules must fail.
    const result = evaluateSignal(candlesFromCloses(downtrendCloses(90)));
    expect(result.type).not.toBe(SignalType.BUY);
  });
});
