import { BacktestResult } from '@stockpred/shared-types';
import { runBacktest } from './engine';
import { generateCandles } from './sim';

const REQUEST = {
  symbol: 'TEST',
  years: 1 as const,
  initialCapital: 1_000_000,
  riskPerTradePercent: 1,
};

describe('runBacktest', () => {
  let result: BacktestResult;

  beforeAll(() => {
    const candles = generateCandles('TEST', 252 + 210, 1000);
    result = runBacktest(candles, REQUEST);
  });

  it('produces a full equity curve past the warmup', () => {
    expect(result.equityCurve.length).toBe(252);
    for (const point of result.equityCurve) {
      expect(Number.isFinite(point.equity)).toBe(true);
      expect(point.equity).toBeGreaterThan(0);
    }
  });

  it('keeps every metric finite and consistent', () => {
    const m = result.metrics;
    expect(m.totalTrades).toBe(result.trades.length);
    expect(m.winRate).toBeGreaterThanOrEqual(0);
    expect(m.winRate).toBeLessThanOrEqual(100);
    expect(Number.isFinite(m.sharpeRatio)).toBe(true);
    expect(Number.isFinite(m.sortinoRatio)).toBe(true);
    expect(Number.isFinite(m.cagr)).toBe(true);
    expect(m.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(m.profitFactor).toBeGreaterThanOrEqual(0);
  });

  it('books consistent trade accounting', () => {
    for (const trade of result.trades) {
      expect(trade.exitTime).toBeGreaterThanOrEqual(trade.entryTime);
      expect(trade.quantity).toBeGreaterThan(0);
      const expectedPnl = (trade.exitPrice - trade.entryPrice) * trade.quantity;
      expect(trade.pnl).toBeCloseTo(expectedPnl, 0);
    }
  });

  it('reconciles final equity with capital plus total pnl', () => {
    const totalPnl = result.trades.reduce((acc, t) => acc + t.pnl, 0);
    const finalEquity = result.equityCurve[result.equityCurve.length - 1].equity;
    expect(finalEquity).toBeCloseTo(REQUEST.initialCapital + totalPnl, -1);
  });

  it('is deterministic for the same inputs', () => {
    const candles = generateCandles('TEST', 252 + 210, 1000);
    const again = runBacktest(candles, REQUEST);
    expect(again.metrics).toEqual(result.metrics);
    expect(again.trades.length).toBe(result.trades.length);
  });
});
