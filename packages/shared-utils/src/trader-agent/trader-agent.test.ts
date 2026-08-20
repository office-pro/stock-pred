import {
  buildCapabilityStatuses,
  capabilityRequestsFromStatuses,
  composeAgentAnalysis,
  emptyPortfolioSnapshot,
  evaluateExitPolicy,
  isPortfolioSnapshot,
  requiredCapabilitiesMissing,
} from './index';
import type { StockQuote } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';

function quote(overrides: Partial<StockQuote> & { symbol: string }): StockQuote {
  return {
    name: overrides.symbol,
    exchange: 'NSE',
    sector: 'IT',
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

describe('trader-agent capabilities', () => {
  it('marks missing required capabilities as blocker requests', () => {
    const statuses = buildCapabilityStatuses([
      { id: 'quotes', available: true },
      { id: 'signals', available: false },
      { id: 'portfolio', available: true },
      { id: 'broker-orders', available: true },
    ]);
    expect(requiredCapabilitiesMissing(statuses)).toBe(true);
    const requests = capabilityRequestsFromStatuses(statuses);
    expect(requests.some((row) => row.id === 'signals' && row.priority === 'blocker')).toBe(true);
  });
});

describe('isPortfolioSnapshot', () => {
  it('accepts a valid auto-trader portfolio payload', () => {
    const snapshot = emptyPortfolioSnapshot(TradingMode.PAPER, 10_000_000);
    expect(isPortfolioSnapshot(snapshot)).toBe(true);
  });

  it('accepts open lots with required holding fields', () => {
    const snapshot = {
      ...emptyPortfolioSnapshot(TradingMode.PAPER, 10_000_000),
      equity: 9_500_000,
      cash: 8_000_000,
      openPositions: 1,
      realizedPnl: 1000,
      unrealizedPnl: -500,
      holdings: [
        {
          symbol: 'TCS',
          quantity: 10,
          entryPrice: 4000,
          currentPrice: 3950,
          target: 4200,
          stopLoss: 3800,
          unrealizedPnl: -500,
        },
      ],
    };
    expect(isPortfolioSnapshot(snapshot)).toBe(true);
  });

  it('rejects payloads missing required portfolio fields', () => {
    expect(isPortfolioSnapshot(null)).toBe(false);
    expect(isPortfolioSnapshot({ mode: 'PAPER' })).toBe(false);
    expect(
      isPortfolioSnapshot({
        ...emptyPortfolioSnapshot(TradingMode.PAPER, 1),
        openPositions: 1,
        holdings: [],
      }),
    ).toBe(false);
  });
});

describe('composeAgentAnalysis', () => {
  it('returns WAIT when required capabilities are missing', () => {
    const analysis = composeAgentAnalysis({
      quote: quote({ symbol: 'TCS' }),
      fundamentals: null,
      altData: null,
      cash: 1_000_000,
      riskPerTradePercent: 1,
      usedCapabilities: ['quotes'],
      missingCapabilities: ['signals'],
      capabilityRequests: [
        {
          id: 'signals',
          title: 'Trading signals',
          whyNeeded: 'missing',
          blockedDecisions: ['BUY'],
          suggestedOwner: 'signal-engine',
          priority: 'blocker',
          createdAt: 1,
        },
      ],
      requiredMissing: true,
    });
    expect(analysis.decision).toBe('WAIT');
    expect(analysis.missingCapabilities).toContain('signals');
  });

  it('can propose BUY when scores and suggestion align', () => {
    const analysis = composeAgentAnalysis({
      quote: quote({
        symbol: 'INFY',
        suggestion: 'BUY',
        confidence: 85,
        indicators: {
          symbol: 'INFY',
          time: 1,
          rsi: 55,
          macd: 1,
          macdSignal: 0.5,
          macdHistogram: 0.5,
          atr: 2,
          ema20: 101,
          ema50: 99,
          ema200: 90,
          vwap: 100,
          bollingerUpper: 110,
          bollingerMiddle: 100,
          bollingerLower: 90,
          avgVolume20: 1,
        },
      }),
      fundamentals: {
        symbol: 'INFY',
        asOfDate: 1,
        availableAt: 1,
        sector: 'IT',
        pe: 25,
        pb: 5,
        roe: 20,
        debtEquity: 0.2,
        revYoy: 12,
        patYoy: 10,
        netMargin: 15,
        currentRatio: 2,
        displayScore: 80,
        missing: false,
      },
      altData: {
        symbol: 'INFY',
        missing: false,
        news: {
          asOfDate: 1,
          availableAt: 1,
          sentiment7d: 0.3,
          count7d: 10,
          highImpact7d: 1,
          earningsSentiment: 0.2,
        },
        social: null,
        macro: null,
      },
      cash: 1_000_000,
      riskPerTradePercent: 1,
      usedCapabilities: ['quotes', 'signals', 'fundamentals', 'alt-news', 'portfolio'],
      missingCapabilities: [],
      capabilityRequests: [],
      requiredMissing: false,
    });
    expect(['STRONG_BUY', 'BUY', 'BUY_ON_BREAKOUT', 'BUY_ON_PULLBACK']).toContain(
      analysis.decision,
    );
    expect(analysis.setup.positionSize).toBeGreaterThan(0);
  });
});

describe('evaluateExitPolicy', () => {
  const position = {
    symbol: 'TCS',
    entryPrice: 100,
    quantity: 10,
    target: 110,
    stopLoss: 95,
  };

  it('exits on hard stop', () => {
    const action = evaluateExitPolicy(position, { price: 94 });
    expect(action.type).toBe('FULL_EXIT');
    if (action.type === 'FULL_EXIT') expect(action.reason).toBe('STOP_LOSS_HIT');
  });

  it('trails or takes partial when past target with intact thesis', () => {
    const action = evaluateExitPolicy(position, {
      price: 111,
      thesisIntact: true,
      thesisScore: 70,
    });
    expect(['UPDATE_LEVELS', 'PARTIAL_EXIT']).toContain(action.type);
    expect(action.stopLoss).toBeGreaterThanOrEqual(95);
  });

  it('exits on thesis invalidation', () => {
    const action = evaluateExitPolicy(position, {
      price: 105,
      reversalSignal: true,
    });
    expect(action.type).toBe('FULL_EXIT');
    if (action.type === 'FULL_EXIT') expect(action.reason).toBe('THESIS_INVALID');
  });
});
