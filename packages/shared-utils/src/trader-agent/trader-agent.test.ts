import {
  applyDecisionPolicy,
  buildCapabilityStatuses,
  capabilityRequestsFromStatuses,
  composeAgentAnalysis,
  confidenceToScale,
  emptyPortfolioSnapshot,
  evaluateExitPolicy,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  isPortfolioSnapshot,
  requiredCapabilitiesMissing,
} from './index';
import type { AgentAnalysis, StockQuote } from '@stockpred/shared-types';
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

  it('accepts optional day/week anchors and holding sector', () => {
    const snapshot = {
      ...emptyPortfolioSnapshot(TradingMode.PAPER, 10_000_000),
      dayStartEquity: 10_100_000,
      weekStartEquity: 9_900_000,
      openPositions: 1,
      cash: 9_000_000,
      equity: 9_950_000,
      holdings: [
        {
          symbol: 'INFY',
          quantity: 5,
          entryPrice: 1500,
          currentPrice: 1510,
          target: 1600,
          stopLoss: 1400,
          unrealizedPnl: 50,
          sector: 'IT',
        },
      ],
    };
    expect(isPortfolioSnapshot(snapshot)).toBe(true);
  });

  it('rejects non-finite dayStartEquity when present', () => {
    expect(
      isPortfolioSnapshot({
        ...emptyPortfolioSnapshot(TradingMode.PAPER, 1),
        dayStartEquity: Number.NaN,
      }),
    ).toBe(false);
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

describe('capabilityRequestsFromStatuses soft probes', () => {
  it('alt-news unavailable produces request', () => {
    const statuses = buildCapabilityStatuses([
      { id: 'quotes', available: true },
      { id: 'signals', available: true },
      { id: 'portfolio', available: true },
      { id: 'broker-orders', available: true },
      { id: 'alt-news', available: false },
    ]);
    const requests = capabilityRequestsFromStatuses(statuses);
    expect(requests.some((row) => row.id === 'alt-news')).toBe(true);
  });

  it('broker-orders unavailable is a blocker request', () => {
    const statuses = buildCapabilityStatuses([
      { id: 'quotes', available: true },
      { id: 'signals', available: true },
      { id: 'portfolio', available: true },
      { id: 'broker-orders', available: false },
    ]);
    const requests = capabilityRequestsFromStatuses(statuses);
    const broker = requests.find((row) => row.id === 'broker-orders');
    expect(broker?.priority).toBe('blocker');
  });
});

describe('trade decision engine', () => {
  const baseAnalysis = (): AgentAnalysis =>
    ({
      symbol: 'TCS',
      currentPrice: 3500,
      decision: 'BUY',
      scores: {
        fundamental: 70,
        technical: 80,
        sentiment: 60,
        quant: 65,
        macro: 55,
        sector: 60,
        risk: 70,
        overall: 78,
      },
      setup: {
        instrument: 'TCS',
        direction: 'LONG',
        entry: 3500,
        stopLoss: 3400,
        target1: 3700,
        target2: null,
        target3: null,
        riskReward: 2,
        positionSize: 10,
        expectedHoldingPeriod: '1-5d',
        confidence: 78,
        invalidation: 'Close below stop',
      },
      marketRegime: 'RISK_ON',
      thesis: 'Breakout with volume',
      counterThesis: 'Market risk-off',
      invalidation: 'Close below stop',
      risks: [],
      action: 'Propose long',
      usedCapabilities: ['quotes'],
      missingCapabilities: [],
      capabilityRequests: [],
      generatedAt: Date.now(),
      disclaimer: 'test',
    }) as AgentAnalysis;

  it('score ≥ 75 yields AUTONOMOUS_ELIGIBLE only (not acceptance)', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    expect(decision.eligibility).toBe('AUTONOMOUS_ELIGIBLE');
    expect(decision.reasonCodes).toContain('AUTONOMOUS_ELIGIBLE');
  });

  it('score 60–74 is HUMAN_ONLY', () => {
    const analysis = baseAnalysis();
    analysis.scores.overall = 68;
    const decision = evaluateTrade({ analysis });
    expect(decision.eligibility).toBe('HUMAN_ONLY');
  });

  it('score below 60 is REJECT', () => {
    const analysis = baseAnalysis();
    analysis.scores.overall = 50;
    const decision = evaluateTrade({ analysis });
    expect(decision.eligibility).toBe('REJECT');
  });

  it('risk veto blocks regardless of score', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    const risk = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: true,
    });
    expect(risk.allowed).toBe(false);
    if (!risk.allowed) expect(risk.blockedBy).toContain('KILL_SWITCH');
  });

  it('policy AUTO_ACCEPTED only for PAPER + AUTONOMOUS + eligible + pass', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    const risk = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    });
    expect(risk.allowed).toBe(true);
    const portfolio = evaluatePortfolio({
      decision,
      risk,
      portfolio: emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000),
    });
    expect(portfolio.allowed).toBe(true);
    const auto = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk,
      portfolio,
    });
    expect(auto.outcome).toBe('AUTO_ACCEPTED');

    const approval = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'APPROVAL',
      eligibility: decision.eligibility,
      risk,
      portfolio,
    });
    expect(approval.outcome).toBe('HUMAN_REQUIRED');

    const live = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk,
      portfolio,
    });
    expect(live.outcome).toBe('HUMAN_REQUIRED');
  });
});

describe('Phase 2 risk + portfolio budgets', () => {
  const baseAnalysis = (): AgentAnalysis =>
    ({
      symbol: 'TCS',
      currentPrice: 3500,
      decision: 'BUY',
      scores: {
        fundamental: 70,
        technical: 80,
        sentiment: 60,
        quant: 65,
        macro: 55,
        sector: 60,
        risk: 70,
        overall: 78,
      },
      setup: {
        instrument: 'TCS',
        direction: 'LONG',
        entry: 3500,
        stopLoss: 3400,
        target1: 3700,
        target2: null,
        target3: null,
        riskReward: 2,
        positionSize: 10,
        expectedHoldingPeriod: '1-5d',
        confidence: 78,
        invalidation: 'Close below stop',
      },
      marketRegime: 'RISK_ON',
      thesis: 'Breakout with volume',
      counterThesis: 'Market risk-off',
      invalidation: 'Close below stop',
      risks: [],
      action: 'Propose long',
      usedCapabilities: ['quotes'],
      missingCapabilities: [],
      capabilityRequests: [],
      generatedAt: Date.now(),
      disclaimer: 'test',
    }) as AgentAnalysis;

  it('confidence 70 scales qty below ceiling; confidence cannot raise above ceiling', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    const capital = 1_000_000;
    const cash = 1_000_000;
    const ceiling = evaluateRisk({
      decision,
      capital,
      cash,
      tradingEnabled: true,
      killSwitch: false,
      confidence: 100,
    });
    expect(ceiling.allowed).toBe(true);
    if (!ceiling.allowed) return;

    const scaled = evaluateRisk({
      decision,
      capital,
      cash,
      tradingEnabled: true,
      killSwitch: false,
      confidence: 70,
    });
    expect(scaled.allowed).toBe(true);
    if (!scaled.allowed) return;
    expect(scaled.quantityBeforeConfidence).toBe(ceiling.quantityBeforeConfidence);
    expect(scaled.quantity).toBeLessThan(scaled.quantityBeforeConfidence!);
    expect(scaled.quantity).toBe(
      Math.floor(scaled.quantityBeforeConfidence! * confidenceToScale(70)),
    );
    expect(scaled.reasonCodes).toContain('CONFIDENCE_SCALED_DOWN');

    const hyped = evaluateRisk({
      decision,
      capital,
      cash,
      tradingEnabled: true,
      killSwitch: false,
      confidence: 250,
    });
    expect(hyped.allowed).toBe(true);
    if (!hyped.allowed) return;
    expect(hyped.confidenceScale).toBe(1);
    expect(hyped.quantity).toBeLessThanOrEqual(hyped.quantityBeforeConfidence!);
    expect(hyped.quantity).toBe(ceiling.quantity);
  });

  it('day drawdown uses dayStartEquity anchor', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    const blocked = evaluateRisk({
      decision,
      capital: 960_000,
      cash: 960_000,
      tradingEnabled: true,
      killSwitch: false,
      dayStartEquity: 1_000_000,
      weekStartEquity: 1_000_000,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.blockedBy).toContain('DAILY_DRAWDOWN_LIMIT');

    const ok = evaluateRisk({
      decision,
      capital: 990_000,
      cash: 990_000,
      tradingEnabled: true,
      killSwitch: false,
      dayStartEquity: 1_000_000,
      weekStartEquity: 1_000_000,
    });
    expect(ok.allowed).toBe(true);
  });

  it('week drawdown uses weekStartEquity anchor', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    const blocked = evaluateRisk({
      decision,
      capital: 910_000,
      cash: 910_000,
      tradingEnabled: true,
      killSwitch: false,
      dayStartEquity: 910_000,
      weekStartEquity: 1_000_000,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.blockedBy).toContain('WEEKLY_DRAWDOWN_LIMIT');
  });

  it('sector exposure vetoes when symbolSector is set', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    const risk = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
      confidence: 100,
    });
    expect(risk.allowed).toBe(true);
    if (!risk.allowed) return;

    const portfolio = {
      ...emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000),
      cash: 500_000,
      equity: 1_000_000,
      openPositions: 1,
      holdings: [
        {
          symbol: 'INFY',
          quantity: 100,
          entryPrice: 3000,
          currentPrice: 3000,
          target: 3200,
          stopLoss: 2800,
          unrealizedPnl: 0,
          sector: 'IT',
        },
      ],
    };

    const veto = evaluatePortfolio({
      decision,
      risk,
      portfolio,
      symbolSector: 'IT',
      maxSectorExposurePct: 30,
    });
    expect(veto.allowed).toBe(false);
    if (!veto.allowed) expect(veto.blockedBy).toContain('SECTOR_EXPOSURE_LIMIT');

    const skipped = evaluatePortfolio({
      decision,
      risk,
      portfolio,
      symbolSector: null,
      maxSectorExposurePct: 30,
    });
    expect(skipped.reasonCodes).toContain('SECTOR_UNKNOWN_SKIPPED');
  });
});
