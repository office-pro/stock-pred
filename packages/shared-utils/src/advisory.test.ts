import { PredictionHorizon, SignalType } from '@stockpred/shared-types';
import { composeTradeAdvisory } from './advisory';
import { candlesFromCloses, downtrendCloses, uptrendCloses } from './test-helpers';

function fallingMarket(bars = 10): ReturnType<typeof candlesFromCloses> {
  const closes: number[] = [];
  let price = 25000;
  for (let i = 0; i < bars; i += 1) {
    price *= 0.985;
    closes.push(price);
  }
  return candlesFromCloses(closes);
}

function risingMarket(bars = 10): ReturnType<typeof candlesFromCloses> {
  const closes: number[] = [];
  let price = 24000;
  for (let i = 0; i < bars; i += 1) {
    price *= 1.015;
    closes.push(price);
  }
  return candlesFromCloses(closes);
}

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

  it('uses the technical trend as a Buy/Sell focus when ML is not trained', () => {
    const candles = candlesFromCloses(uptrendCloses(80));
    const result = composeTradeAdvisory({ candles, direction: null, confidence: 0 });
    expect(result.action).toBe('BUY');
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.modelVersion).toBe('trend-v1');
  });

  it('holds a flat tape when ML is not trained', () => {
    const candles = candlesFromCloses(Array.from({ length: 80 }, () => 100));
    const result = composeTradeAdvisory({ candles, direction: null, confidence: 0 });
    expect(result.action).toBe('HOLD');
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

  it('holds a BUY when the stock trend is down', () => {
    const result = composeTradeAdvisory({
      candles: candlesFromCloses(downtrendCloses(80)),
      direction: 'UP',
      confidence: 80,
      expectedMove: 2,
    });
    expect(result.action).toBe('HOLD');
    expect(result.quantity).toBe(0);
  });

  it('holds a SELL when the stock trend is up', () => {
    const result = composeTradeAdvisory({
      candles: candlesFromCloses(uptrendCloses(80)),
      direction: 'DOWN',
      confidence: 80,
      expectedMove: -2,
    });
    expect(result.action).toBe('HOLD');
    expect(result.quantity).toBe(0);
  });

  it('holds a BUY when Nifty is falling even if the stock is in an uptrend', () => {
    const result = composeTradeAdvisory({
      candles: candlesFromCloses(uptrendCloses(80)),
      direction: 'UP',
      confidence: 70,
      expectedMove: 1.5,
      marketCandles: fallingMarket(),
    });
    expect(result.action).toBe('HOLD');
  });

  it('holds a SELL when Nifty is rising even if the stock is in a downtrend', () => {
    const result = composeTradeAdvisory({
      candles: candlesFromCloses(downtrendCloses(80)),
      direction: 'DOWN',
      confidence: 70,
      expectedMove: -1.5,
      marketCandles: risingMarket(),
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
    expect(result.confidence).toBe(72);
  });

  it('lets a strong ML BUY through on a flat stock', () => {
    const candles = candlesFromCloses(Array.from({ length: 80 }, () => 100));
    const result = composeTradeAdvisory({
      candles,
      direction: 'UP',
      confidence: 80,
      expectedMove: 1.2,
    });
    expect(result.action).toBe('BUY');
    expect(result.confidence).toBe(68);
    expect(result.quantity).toBeGreaterThan(0);
  });

  it('holds a weak ML BUY on a flat stock', () => {
    const candles = candlesFromCloses(Array.from({ length: 80 }, () => 100));
    const result = composeTradeAdvisory({
      candles,
      direction: 'UP',
      confidence: 55,
      expectedMove: 1,
    });
    expect(result.action).toBe('HOLD');
  });

  it('boosts confidence when ML, stock trend and Nifty all agree', () => {
    const result = composeTradeAdvisory({
      candles: candlesFromCloses(uptrendCloses(80)),
      direction: 'UP',
      confidence: 60,
      expectedMove: 1.5,
      marketCandles: risingMarket(),
    });
    expect(result.action).toBe('BUY');
    expect(result.confidence).toBe(78);
  });

  it('builds a SELL advisory with target below entry', () => {
    const candles = candlesFromCloses(downtrendCloses(80));
    const result = composeTradeAdvisory({
      candles,
      direction: 'DOWN',
      confidence: 60,
      expectedMove: -2,
    });
    expect(result.action).toBe('SELL');
    expect(result.target as number).toBeLessThan(result.entry as number);
    expect(result.stopLoss as number).toBeGreaterThan(result.entry as number);
    expect(result.confidence).toBe(70);
  });
});
