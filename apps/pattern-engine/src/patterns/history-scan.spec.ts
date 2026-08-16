import { candlesFromCloses } from '@stockpred/shared-utils';
import type { PatternOccurrenceView } from '@stockpred/shared-types';
import { buildAnalog, composePatternBriefing } from './history-scan';

function hit(
  pattern: string,
  direction: 'bullish' | 'bearish',
  return10: number,
  day: number,
): PatternOccurrenceView {
  return {
    symbol: 'ABMKNO',
    pattern,
    timeframe: '1d',
    direction,
    confidence: 70,
    price: 100,
    confirmedAt: Date.UTC(2024, 0, day),
    return5: return10 / 2,
    return10,
    return20: return10,
    maxFavorable: Math.abs(return10),
    maxAdverse: -1,
  };
}

describe('buildAnalog', () => {
  it('leans grow/fall with 3 repeats and flags a small sample', () => {
    const analog = buildAnalog('ABMKNO', 'DOUBLE_BOTTOM', [
      hit('DOUBLE_BOTTOM', 'bullish', 4, 2),
      hit('DOUBLE_BOTTOM', 'bullish', 5, 20),
      hit('DOUBLE_BOTTOM', 'bullish', 6, 40),
    ]);
    expect(analog.sampleSize).toBe(3);
    expect(analog.medianReturn10).toBe(5);
    expect(analog.suggestion).toMatch(/Small sample/);
    expect(analog.suggestion).toMatch(/lean/);
  });
});

describe('composePatternBriefing', () => {
  it('does not lean with fewer than 40 bars', () => {
    const candles = candlesFromCloses(
      Array.from({ length: 20 }, () => 100),
      { symbol: 'ABMKNO' },
    );
    const briefing = composePatternBriefing('ABMKNO', candles);
    expect(briefing.outlook).toBe('UNCLEAR');
    expect(briefing.events).toEqual([]);
    expect(briefing.barCount).toBe(20);
    expect(briefing.outlookText).toMatch(/40 daily sessions/);
  });

  it('exposes first and last bar times for the full-history caption', () => {
    const candles = candlesFromCloses(
      Array.from({ length: 80 }, (_, i) => 100 + i * 0.1),
      { symbol: 'ABMKNO' },
    );
    const briefing = composePatternBriefing('ABMKNO', candles);
    expect(briefing.firstBarAt).toBe(candles[0].time);
    expect(briefing.lastBarAt).toBe(candles[candles.length - 1].time);
  });
});
