import { PredictionHorizon, SignalType } from '@stockpred/shared-types';
import { composeTradeAdvisory } from './advisory';
import { candlesFromCloses, uptrendCloses } from './test-helpers';

describe('composeTradeAdvisory', () => {
  it('holds when there are fewer than 40 bars even if ML votes UP', () => {
    const candles = candlesFromCloses(uptrendCloses(20));
    const result = composeTradeAdvisory({
      candles,
      direction: 'UP',
      confidence: 80,
      expectedMove: 2,
    });
    expect(result.action).toBe('HOLD');
    expect(result.quantity).toBe(0);
    expect(result.target).toBeNull();
  });

  it('holds when there is no ML direction', () => {
    const candles = candlesFromCloses(uptrendCloses(50));
    const result = composeTradeAdvisory({ candles, direction: null, confidence: 80 });
    expect(result.action).toBe('HOLD');
    expect(result.target).toBeNull();
    expect(result.quantity).toBe(0);
  });

  it('holds when confidence is below the floor', () => {
    const candles = candlesFromCloses(uptrendCloses(50));
    const result = composeTradeAdvisory({
      candles,
      direction: 'UP',
      confidence: 40,
      expectedMove: 1.5,
    });
    expect(result.action).toBe('HOLD');
  });

  it('builds a BUY advisory with entry, target, stop and size', () => {
    const candles = candlesFromCloses(uptrendCloses(80));
    const result = composeTradeAdvisory({
      candles,
      direction: 'UP',
      confidence: 62,
      expectedMove: 1.8,
      horizon: PredictionHorizon.NEXT_DAY,
      capital: 1_000_000,
    });
    expect(result.action).toBe(SignalType.BUY);
    expect(result.entry).toBeGreaterThan(0);
    expect(result.target as number).toBeGreaterThan(result.entry as number);
    expect(result.stopLoss as number).toBeLessThan(result.entry as number);
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.confidence).toBe(62);
  });

  it('builds a SELL advisory with target below entry', () => {
    const candles = candlesFromCloses(uptrendCloses(80));
    const result = composeTradeAdvisory({
      candles,
      direction: 'DOWN',
      confidence: 60,
      expectedMove: -2,
    });
    expect(result.action).toBe('SELL');
    expect(result.target as number).toBeLessThan(result.entry as number);
    expect(result.stopLoss as number).toBeGreaterThan(result.entry as number);
  });
});
