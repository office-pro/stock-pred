import type { StockQuote } from '@stockpred/shared-types';
import { rankQuotes } from './quote-rank';

function quote(overrides: Partial<StockQuote> & { symbol: string }): StockQuote {
  return {
    name: overrides.symbol,
    exchange: 'NSE',
    sector: 'Unknown',
    indices: [],
    price: 100,
    change: 0,
    changePercent: 0,
    volume: 1,
    dayHigh: 100,
    dayLow: 100,
    previousClose: 100,
    indicators: null,
    dataSource: 'cached',
    suggestion: 'BUY',
    horizon: 'NEXT_DAY',
    entry: 100,
    target: 110,
    stopLoss: 95,
    quantity: 10,
    confidence: 80,
    expectedMove: 4,
    modelVersion: 'test',
    updatedAt: 1,
    ...overrides,
  } as StockQuote;
}

describe('rankQuotes', () => {
  const low = quote({ symbol: 'LOW', entry: 100, target: 101, confidence: 99 });
  const mid = quote({ symbol: 'MID', entry: 100, target: 105, confidence: 80 });
  const high = quote({ symbol: 'HIGH', entry: 100, target: 120, confidence: 76 });

  it('puts the highest profit percentage first when Max profit is on', () => {
    const ranked = rankQuotes([low, mid, high], {
      bestPick: false,
      suggestion: 'ALL',
      filters: ['PROFIT'],
    });
    expect(ranked.map((row) => row.symbol)).toEqual(['HIGH', 'MID', 'LOW']);
  });

  it('still puts max profit first when Max confidence is also selected', () => {
    const ranked = rankQuotes([low, high], {
      bestPick: false,
      suggestion: 'ALL',
      filters: ['PROFIT', 'CONFIDENCE'],
    });
    expect(ranked[0].symbol).toBe('HIGH');
  });

  it('keeps only Nifty 50 constituents when that universe is set', () => {
    const ranked = rankQuotes(
      [quote({ symbol: 'RELIANCE' }), quote({ symbol: 'LOW' }), quote({ symbol: 'HDFCBANK' })],
      { bestPick: false, suggestion: 'ALL', filters: [], universe: 'nifty50' },
    );
    expect(ranked.map((row) => row.symbol)).toEqual(['HDFCBANK', 'RELIANCE']);
  });

  it('drops names below the Best Pick confidence and profit bars', () => {
    const ranked = rankQuotes(
      [quote({ symbol: 'THIN', entry: 100, target: 101, confidence: 90 }), high],
      { bestPick: true, suggestion: 'ALL', filters: ['PROFIT'] },
    );
    expect(ranked.map((row) => row.symbol)).toEqual(['HIGH']);
  });

  it('keeps only the selected suspicious band', () => {
    const normal = quote({
      symbol: 'SAFE',
      manipulation: {
        band: 'NORMAL',
        investigateIntensity: 10,
        investigateProbability: null,
        priceAnomaly: 0,
        volumeAnomaly: 0,
        volatilityAnomaly: 0,
        marketRelativeAnomaly: 0,
        evidence: [],
        flags: { accumulation: false, expansion: false, dump: false },
        modelVersion: 'test',
      },
    });
    const investigate = quote({
      symbol: 'RISKY',
      manipulation: {
        band: 'INVESTIGATE',
        investigateIntensity: 88,
        investigateProbability: null,
        priceAnomaly: 80,
        volumeAnomaly: 70,
        volatilityAnomaly: 60,
        marketRelativeAnomaly: 50,
        evidence: [],
        flags: { accumulation: false, expansion: true, dump: false },
        modelVersion: 'test',
      },
    });
    const ranked = rankQuotes([normal, investigate, high], {
      bestPick: false,
      suggestion: 'ALL',
      filters: [],
      suspicious: 'INVESTIGATE',
    });
    expect(ranked.map((row) => row.symbol)).toEqual(['RISKY']);
  });
});
