import type { AltDataView } from '@stockpred/shared-types';
import { buildStockBrief } from './stock-brief';

function altData(overrides: Partial<AltDataView> = {}): AltDataView {
  return {
    symbol: 'RELIANCE',
    missing: false,
    news: {
      asOfDate: 1,
      availableAt: 1,
      sentiment7d: 0.3,
      count7d: 12,
      highImpact7d: 2,
      earningsSentiment: 0.1,
    },
    social: {
      asOfDate: 1,
      availableAt: 1,
      mentions1d: 40,
      attentionSpike: 1.8,
      sentiment1d: 0.35,
      coordination: 0,
      trends7d: 0.2,
    },
    macro: null,
    ...overrides,
  };
}

describe('buildStockBrief', () => {
  it('combines bullish news and greedy social into the context line', () => {
    const brief = buildStockBrief({
      altData: altData(),
      paperAction: 'BUY',
      predictions: [{ horizon: 'NEXT_DAY', direction: 'UP', confidence: 72 }],
      patternOutlook: 'GROW',
    });

    expect(brief.contextLine).toMatch(/Headlines lean bullish/);
    expect(brief.contextLine).toMatch(/greedy/i);
    expect(brief.decisionLine).toMatch(/Suggested BUY/);
    expect(brief.decisionLine).toMatch(/ML next-day bias up/);
  });

  it('describes fear when social sentiment is negative', () => {
    const brief = buildStockBrief({
      altData: altData({
        social: {
          asOfDate: 1,
          availableAt: 1,
          mentions1d: 25,
          attentionSpike: 1.1,
          sentiment1d: -0.4,
          coordination: 0,
          trends7d: 0.1,
        },
      }),
      paperAction: 'SELL',
      predictions: [{ horizon: 'NEXT_DAY', direction: 'DOWN', confidence: 65 }],
    });

    expect(brief.contextLine).toMatch(/fearful/i);
    expect(brief.decisionLine).toMatch(/Suggested SELL/);
  });

  it('falls back when alt data is missing', () => {
    const brief = buildStockBrief({
      altData: { symbol: 'X', missing: true, news: null, social: null, macro: null },
      paperAction: 'HOLD',
    });

    expect(brief.contextLine).toMatch(/not loaded yet/);
    expect(brief.decisionLine).toMatch(/Suggested HOLD/);
  });
});
