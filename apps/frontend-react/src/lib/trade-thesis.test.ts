import { buildTradeThesis } from './trade-thesis';
import type { StockQuote } from '@stockpred/shared-types';

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol: 'TCS',
    name: 'Tata Consultancy',
    exchange: 'NSE',
    sector: 'Technology',
    indices: [],
    price: 3600,
    change: 20,
    changePercent: 0.6,
    volume: 1,
    dayHigh: 3620,
    dayLow: 3550,
    previousClose: 3580,
    indicators: {
      symbol: 'TCS',
      time: 1,
      rsi: 48,
      macd: null,
      macdSignal: null,
      macdHistogram: null,
      atr: 40,
      ema20: 3550,
      ema50: 3500,
      ema200: 3200,
      vwap: null,
      bollingerUpper: null,
      bollingerMiddle: null,
      bollingerLower: null,
      avgVolume20: null,
    },
    dataSource: 'live',
    suggestion: 'BUY',
    horizon: 'NEXT_DAY',
    entry: 3600,
    target: 3900,
    stopLoss: 3400,
    quantity: 10,
    confidence: 72,
    expectedMove: 4,
    modelVersion: 'test',
    relativeStrengthNifty50: 1.12,
    updatedAt: 1,
    ...overrides,
  } as StockQuote;
}

describe('buildTradeThesis', () => {
  it('lists buy supports and levels for a BUY lean', () => {
    const thesis = buildTradeThesis({
      stock: quote(),
      paperAction: 'BUY',
      fundamentals: {
        symbol: 'TCS',
        asOfDate: 1,
        availableAt: 1,
        sector: 'Technology',
        pe: 22,
        pb: 8,
        roe: 0.28,
        debtEquity: 0.1,
        revYoy: 0.1,
        patYoy: 0.12,
        netMargin: 0.2,
        currentRatio: 2,
        displayScore: 78,
        missing: false,
      },
      peer: {
        symbol: 'TCS',
        sector: 'Technology',
        pe: 22,
        pb: 8,
        sectorMedianPe: 28,
        sectorMedianPb: 4,
        peerCount: 40,
        peVsMedianPct: -21,
        pbVsMedianPct: 100,
        missing: false,
      },
      predictions: [{ horizon: 'NEXT_DAY', direction: 'UP', confidence: 70 }],
      patternOutlook: 'GROW',
    });

    expect(thesis.action).toBe('BUY');
    expect(thesis.headline).toMatch(/buying/i);
    expect(thesis.levels[0]).toMatch(/entry/);
    expect(thesis.whyBuy.some((line) => /R:R|reward/i.test(line) || /BUY/i.test(line))).toBe(true);
    expect(thesis.whyBuy.some((line) => /PE/i.test(line))).toBe(true);
  });
});
