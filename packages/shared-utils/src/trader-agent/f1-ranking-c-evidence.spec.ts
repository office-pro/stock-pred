/**
 * F1 — RankingContext consumes Phase C evidence already on IntelligenceSnapshot.
 * Missing stays UNKNOWN / DATA_INCOMPLETE. Never 0 / NEUTRAL fill.
 * Batch macro is shared context, not per-symbol CPI.
 * Ranking still does not call Risk / Gate.
 */
import type { AgentAnalysis, IntelligenceSnapshot, RankingContext } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  assessOpportunityRanking,
  dimensionPrecedenceForContext,
  type OpportunityRankingCandidate,
} from './opportunity-ranking-engine';
import { buildIntelligenceSnapshot } from './intelligence-snapshot';
import { evaluateTrade } from './decision-engine';
import { emptyPortfolioSnapshot, evaluatePortfolio, evaluateRisk } from './index';

function baseAnalysis(symbol: string): AgentAnalysis {
  return {
    symbol,
    currentPrice: 3500,
    decision: 'BUY',
    scores: {
      fundamental: 70,
      technical: 80,
      sentiment: 60,
      quant: 65,
      macro: 70,
      sector: 60,
      risk: 70,
      overall: 80,
    },
    setup: {
      instrument: symbol,
      direction: 'LONG',
      entry: 3500,
      stopLoss: 3400,
      target1: 3700,
      target2: null,
      target3: null,
      riskReward: 2,
      positionSize: 10,
      expectedHoldingPeriod: '1-5d',
      confidence: 80,
      invalidation: 'Close below stop',
    },
    marketRegime: 'RISK_ON',
    thesis: 'Breakout with volume',
    counterThesis: 'Market risk-off',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose breakout long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  };
}

function twinSnap(symbol: string): IntelligenceSnapshot {
  const analysis = baseAnalysis(symbol);
  const decision = evaluateTrade({ analysis });
  const snap = buildIntelligenceSnapshot({
    analysis,
    decision,
    sourceDataTimestamp: '2026-08-24T10:00:00.000Z',
    marketContext: {
      scannerRegime: 'BULL',
      vixLevel: 14,
      niftyChangePercent: 0.4,
      breadthPercentAboveEma50: 65,
      asOf: '2026-08-24T10:00:00.000Z',
    },
    crossSectional: {
      rsVsNifty50: 1.15,
      peerRsValues: [0.9, 0.95, 1.0, 1.05, 1.1],
      sector: 'IT',
      sectorMedianRs: 1.0,
      peVsMedianPct: 0,
      pbVsMedianPct: 0,
      asOf: '2026-08-24T10:00:00.000Z',
    },
  });
  snap.crossSectionalRs = {
    ...(snap.crossSectionalRs ?? { rsBucket: 'LEADERS', source: 'PEER_CROSS_SECTION' }),
    rsBucket: 'LEADERS',
    source: snap.crossSectionalRs?.source ?? 'PEER_CROSS_SECTION',
  };
  snap.sectorIntelligence = {
    sector: 'IT',
    sectorTrend: 'LEADING',
    valuationVsPeers: 'FAIR',
    sectorFit: 'HIGH',
    asOf: '2026-08-24T10:00:00.000Z',
  };
  return snap;
}

function candidate(symbol: string, snap: IntelligenceSnapshot): OpportunityRankingCandidate {
  return { opportunityId: `opp-${symbol}`, symbol, snapshot: snap, portfolioFit: 'GOOD' };
}

const swingCtx: RankingContext = {
  tradeHorizon: 'SWING_TRADE',
  strategyTag: 'BREAKOUT',
  marketRegime: 'BULL',
  timestamp: '2026-08-24T10:30:00.000Z',
};

const batchMacro = {
  source: 'SOURCE_REPORTED' as const,
  seriesId: 'FEDFUNDS',
  asOf: Date.parse('2026-08-01T00:00:00.000Z'),
};

describe('F1 RankingContext C evidence', () => {
  it('keeps PORTFOLIO_FIT last and T1.8 head unchanged', () => {
    const day = dimensionPrecedenceForContext('DAY_TRADE');
    const swing = dimensionPrecedenceForContext('SWING_TRADE');
    expect(day[0]).toBe('LIQUIDITY');
    expect(swing[0]).toBe('RS');
    expect(day.slice(0, 4)).toEqual(['LIQUIDITY', 'FRESHNESS', 'MTF', 'EV']);
    expect(swing.slice(0, 4)).toEqual(['RS', 'SECTOR', 'REGIME', 'EV']);
    expect(day.at(-1)).toBe('PORTFOLIO_FIT');
    expect(swing.at(-1)).toBe('PORTFOLIO_FIT');
    expect(day.slice(-5, -1)).toEqual(['FUNDAMENTAL', 'NEWS', 'SENTIMENT', 'MACRO']);
    expect(swing.slice(-5, -1)).toEqual(['FUNDAMENTAL', 'NEWS', 'SENTIMENT', 'MACRO']);
  });

  it('does not treat AgentAnalysis scores as Phase C evidence', () => {
    const snap = twinSnap('TCS');
    expect(snap.tradeQuality?.fundamental).toBe(70);
    expect(snap.fundamental).toBeUndefined();
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('TCS', snap)],
    });
    expect(result.rankings[0]?.dimensions.fundamental).toBe('UNKNOWN');
    expect(result.rankings[0]?.dimensions.news).toBe('UNKNOWN');
    expect(result.rankings[0]?.dimensions.sentiment).toBe('UNKNOWN');
    expect(result.rankings[0]?.dimensions.macro).toBe('UNKNOWN');
    expect(result.rankings[0]?.unknownDimensions).toEqual(
      expect.arrayContaining(['FUNDAMENTAL', 'NEWS', 'SENTIMENT', 'MACRO']),
    );
    expect(result.rankings[0]?.dataCompleteness).toBe('DATA_INCOMPLETE');
  });

  it('maps missing/null C sentiment to UNKNOWN and genuine 0 to MED', () => {
    const missing = twinSnap('NULL');
    missing.sentiment = null;
    const zero = twinSnap('ZERO');
    zero.sentiment = { source: 'MODEL_DERIVED', score: 0 };
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('NULL', missing), candidate('ZERO', zero)],
    });
    const nullRow = result.rankings.find((r) => r.symbol === 'NULL');
    const zeroRow = result.rankings.find((r) => r.symbol === 'ZERO');
    expect(nullRow?.dimensions.sentiment).toBe('UNKNOWN');
    expect(zeroRow?.dimensions.sentiment).toBe('MED');
    expect(zeroRow?.rank).toBeLessThan(nullRow!.rank);
  });

  it('does not invent headlineCount 0 when news is absent', () => {
    const snap = twinSnap('NONEWS');
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('NONEWS', snap)],
    });
    expect(result.rankings[0]?.dimensions.news).toBe('UNKNOWN');
    expect(result.rankings[0]?.unknownDimensions).toContain('NEWS');
  });

  it('treats UNAVAILABLE fundamentals as UNKNOWN, not NEUTRAL', () => {
    const snap = twinSnap('MISS');
    snap.fundamental = {
      kind: 'UNAVAILABLE',
      reasonCode: 'MISSING_CIK',
      message: 'Ticker not in SEC company_tickers.json',
    };
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('MISS', snap)],
    });
    expect(result.rankings[0]?.dimensions.fundamental).toBe('UNKNOWN');
  });

  it('uses batch-level macro identically across candidates (not per-symbol CPI)', () => {
    const a = twinSnap('AAA');
    const b = twinSnap('BBB');
    a.macro = { ...batchMacro };
    b.macro = { ...batchMacro };
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('AAA', a), candidate('BBB', b)],
    });
    expect(result.rankings[0]?.dimensions.macro).toBe('HIGH');
    expect(result.rankings[1]?.dimensions.macro).toBe('HIGH');
    expect(result.rankings.map((r) => r.dimensions.macro)).toEqual(['HIGH', 'HIGH']);
  });

  it('lets Phase C evidence break a T1.8 tie without touching Risk', () => {
    const weak = twinSnap('WEAK');
    const strong = twinSnap('STRONG');
    strong.fundamental = { kind: 'EQUITY_STATEMENTS', roe: 22, revenue: 1, netIncome: 1 };
    strong.news = { source: 'SOURCE_REPORTED', headlineCount: 4, asOf: 1 };
    strong.sentiment = { source: 'MODEL_DERIVED', score: 0.4 };
    strong.macro = { ...batchMacro };
    weak.sentiment = null;

    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('WEAK', weak), candidate('STRONG', strong)],
    });
    expect(result.rankings[0]?.symbol).toBe('STRONG');
    expect(result.rankings[0]?.dimensions.fundamental).toBe('HIGH');
    expect(result.rankings[0]?.dimensions.news).toBe('HIGH');
    expect(result.rankings[0]?.dimensions.sentiment).toBe('HIGH');
    expect(JSON.stringify(result)).not.toMatch(/rankingScore|rankScore/i);

    const analysis = baseAnalysis('STRONG');
    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const riskA = evaluateRisk(riskInput);
    expect(evaluateRisk(riskInput)).toEqual(riskA);
    const port = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    expect(evaluatePortfolio({ decision, risk: riskA, portfolio: port })).toEqual(
      evaluatePortfolio({ decision, risk: riskA, portfolio: port }),
    );
  });
});
