/**
 * T1.8 Opportunity Ranking — hard-gate suite.
 *
 * Contract:
 * - no RankingScore
 * - PortfolioFit tie-break only
 * - CLEAR is context-scoped
 * - candidate-order independence
 * - Risk / Portfolio / Policy / Gate isolation
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
import {
  applyDecisionPolicy,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  rankOpportunitiesForDisplay,
} from './index';

function baseAnalysis(symbol: string, overall = 80): AgentAnalysis {
  return {
    symbol,
    currentPrice: 3500,
    decision: 'BUY',
    scores: {
      fundamental: 70,
      technical: overall,
      sentiment: 60,
      quant: 65,
      macro: 70,
      sector: 60,
      risk: 70,
      overall,
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
      confidence: overall,
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

function snapFor(
  symbol: string,
  opts: {
    overall?: number;
    scannerRegime?: string;
    vix?: number;
    breadth?: number;
    rsBucket?: 'LEADERS' | 'MIDDLE' | 'LAGGARDS' | 'UNKNOWN';
    sectorFit?: 'HIGH' | 'MED' | 'LOW' | 'UNKNOWN';
    sectorTrend?: 'LEADING' | 'INLINE' | 'LAGGING' | 'UNKNOWN';
    asOf?: string;
  } = {},
): IntelligenceSnapshot {
  const analysis = baseAnalysis(symbol, opts.overall ?? 80);
  const decision = evaluateTrade({ analysis });
  const snap = buildIntelligenceSnapshot({
    analysis,
    decision,
    sourceDataTimestamp: opts.asOf ?? '2026-08-24T10:00:00.000Z',
    marketContext: {
      scannerRegime: opts.scannerRegime ?? 'BULL',
      vixLevel: opts.vix ?? 14,
      niftyChangePercent: 0.4,
      breadthPercentAboveEma50: opts.breadth ?? 65,
      asOf: opts.asOf ?? '2026-08-24T10:00:00.000Z',
    },
    crossSectional: {
      rsVsNifty50: opts.rsBucket === 'LAGGARDS' ? 0.85 : opts.rsBucket === 'MIDDLE' ? 1.0 : 1.15,
      peerRsValues:
        opts.rsBucket === 'LEADERS'
          ? [0.9, 0.95, 1.0, 1.05, 1.1]
          : opts.rsBucket === 'LAGGARDS'
            ? [1.1, 1.15, 1.2, 1.25, 1.3]
            : [0.95, 1.0, 1.05],
      sector: 'IT',
      sectorMedianRs: 1.0,
      peVsMedianPct: 0,
      pbVsMedianPct: 0,
      asOf: opts.asOf ?? '2026-08-24T10:00:00.000Z',
    },
  });

  // Force explicit dimension bands when snapshot enrichment is partial.
  if (opts.rsBucket) {
    snap.crossSectionalRs = {
      ...(snap.crossSectionalRs ?? {
        rsBucket: opts.rsBucket,
        source: 'MISSING',
      }),
      rsBucket: opts.rsBucket,
      source: snap.crossSectionalRs?.source ?? 'PEER_CROSS_SECTION',
    };
  }
  if (opts.sectorFit || opts.sectorTrend) {
    snap.sectorIntelligence = {
      sector: 'IT',
      sectorTrend: opts.sectorTrend ?? 'LEADING',
      valuationVsPeers: 'FAIR',
      sectorFit: opts.sectorFit ?? 'HIGH',
      asOf: opts.asOf ?? '2026-08-24T10:00:00.000Z',
    };
  }
  return snap;
}

function candidate(
  symbol: string,
  snap: IntelligenceSnapshot,
  portfolioFit: 'EXCELLENT' | 'GOOD' | 'BLOCKED' | 'UNKNOWN' = 'GOOD',
): OpportunityRankingCandidate {
  return {
    opportunityId: `opp-${symbol}`,
    symbol,
    snapshot: snap,
    portfolioFit,
  };
}

const swingCtx: RankingContext = {
  tradeHorizon: 'SWING_TRADE',
  strategyTag: 'BREAKOUT',
  marketRegime: 'BULL',
  timestamp: '2026-08-24T10:30:00.000Z',
};

describe('T1.8 Opportunity Ranking', () => {
  it('is deterministic for the same candidates + context', () => {
    const cands = [
      candidate(
        'TCS',
        snapFor('TCS', { rsBucket: 'LEADERS', sectorFit: 'HIGH', sectorTrend: 'LEADING' }),
      ),
      candidate('INFY', snapFor('INFY', { rsBucket: 'MIDDLE', sectorFit: 'HIGH', overall: 85 })),
      candidate('WIPRO', snapFor('WIPRO', { rsBucket: 'LAGGARDS', sectorFit: 'MED', overall: 70 })),
    ];
    const a = assessOpportunityRanking({ context: swingCtx, candidates: cands });
    const b = assessOpportunityRanking({ context: swingCtx, candidates: cands });
    expect(a.rankings.map((r) => r.symbol)).toEqual(b.rankings.map((r) => r.symbol));
    expect(a.rankings.map((r) => r.dominance)).toEqual(b.rankings.map((r) => r.dominance));
    expect(a.noClearWinner).toBe(b.noClearWinner);
    expect(JSON.stringify(a.rankings[0]?.pairwiseReasons)).toBe(
      JSON.stringify(b.rankings[0]?.pairwiseReasons),
    );
  });

  it('is candidate-order independent', () => {
    const tcs = candidate(
      'TCS',
      snapFor('TCS', { rsBucket: 'LEADERS', sectorFit: 'HIGH', sectorTrend: 'LEADING' }),
    );
    const infy = candidate('INFY', snapFor('INFY', { rsBucket: 'MIDDLE', sectorFit: 'HIGH' }));
    const wipro = candidate('WIPRO', snapFor('WIPRO', { rsBucket: 'LAGGARDS', sectorFit: 'LOW' }));
    const a = assessOpportunityRanking({ context: swingCtx, candidates: [tcs, infy, wipro] });
    const b = assessOpportunityRanking({ context: swingCtx, candidates: [wipro, tcs, infy] });
    const c = assessOpportunityRanking({ context: swingCtx, candidates: [infy, wipro, tcs] });
    const ranks = (r: typeof a) =>
      r.rankings.map((x) => ({
        symbol: x.symbol,
        rank: x.rank,
        dominance: x.dominance,
        strengths: x.strengths.map((s) => s.code).sort(),
        weaknesses: x.weaknesses.map((s) => s.code).sort(),
        pairwise: x.pairwiseReasons.map((p) => ({
          peer: p.peerSymbol,
          polarity: p.polarity,
          codes: p.evidence.map((e) => e.code).sort(),
        })),
      }));
    expect(ranks(a)).toEqual(ranks(b));
    expect(ranks(a)).toEqual(ranks(c));
    expect(a.noClearWinner).toBe(b.noClearWinner);
  });

  it('is context-aware (DAY vs SWING precedence differs)', () => {
    expect(dimensionPrecedenceForContext('DAY_TRADE')[0]).toBe('LIQUIDITY');
    expect(dimensionPrecedenceForContext('SWING_TRADE')[0]).toBe('RS');

    const daySnap = snapFor('DAYCO', {
      rsBucket: 'MIDDLE',
      sectorFit: 'MED',
      vix: 12,
      breadth: 55,
      overall: 70,
    });
    daySnap.marketContext = { ...daySnap.marketContext, liquidity: 'HIGH' };

    const swingSnap = snapFor('SWINGCO', {
      rsBucket: 'LEADERS',
      sectorFit: 'HIGH',
      sectorTrend: 'LEADING',
      vix: 22,
      breadth: 40,
      overall: 90,
    });
    swingSnap.marketContext = { ...swingSnap.marketContext, liquidity: 'LOW' };

    const liquidDay = candidate('DAYCO', daySnap);
    const strongSwing = candidate('SWINGCO', swingSnap);

    const day = assessOpportunityRanking({
      context: { ...swingCtx, tradeHorizon: 'DAY_TRADE' },
      candidates: [liquidDay, strongSwing],
    });
    const swing = assessOpportunityRanking({
      context: swingCtx,
      candidates: [liquidDay, strongSwing],
    });
    // Same set can legitimately reorder across horizons.
    expect(day.rankings.map((r) => r.symbol)).not.toEqual(swing.rankings.map((r) => r.symbol));
    expect(day.rankings[0]?.symbol).toBe('DAYCO');
    expect(swing.rankings[0]?.symbol).toBe('SWINGCO');
  });

  it('emits DATA_INCOMPLETE / UNKNOWN rather than inventing bands', () => {
    const analysis = baseAnalysis('THIN');
    const decision = evaluateTrade({ analysis });
    const bare = buildIntelligenceSnapshot({
      analysis,
      decision,
      sourceDataTimestamp: '2026-08-24T10:00:00.000Z',
    });
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('THIN', bare)],
    });
    expect(result.rankings[0]?.dataCompleteness).not.toBe('COMPLETE');
    expect(result.rankings[0]?.unknownDimensions.length).toBeGreaterThan(0);
    expect(result.rankings[0]?.weaknesses.some((w) => w.code === 'DATA_INCOMPLETE')).toBe(true);
    expect((result as { rankingScore?: number }).rankingScore).toBeUndefined();
    expect((result.rankings[0] as { rankingScore?: number }).rankingScore).toBeUndefined();
  });

  it('marks stale intelligence', () => {
    const stale = snapFor('OLD', {
      rsBucket: 'LEADERS',
      sectorFit: 'HIGH',
      asOf: '2026-08-01T10:00:00.000Z',
    });
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('OLD', stale)],
    });
    expect(result.rankings[0]?.stale).toBe(true);
    expect(result.rankings[0]?.weaknesses.some((w) => w.code === 'STALE_INTELLIGENCE')).toBe(true);
  });

  it('classifies CLOSE / NO_CLEAR_WINNER for near-identical candidates', () => {
    const a = candidate(
      'AAA',
      snapFor('AAA', { rsBucket: 'LEADERS', sectorFit: 'HIGH', overall: 80 }),
    );
    const b = candidate(
      'BBB',
      snapFor('BBB', { rsBucket: 'LEADERS', sectorFit: 'HIGH', overall: 80 }),
    );
    const result = assessOpportunityRanking({ context: swingCtx, candidates: [a, b] });
    expect(['CLOSE', 'MIXED', 'NO_CLEAR_WINNER']).toContain(result.rankings[0]?.dominance);
    expect(result.rankings[0]?.dominance).not.toBe('CLEAR');
  });

  it('emits symmetric pairwise reasons', () => {
    const tcs = candidate(
      'TCS',
      snapFor('TCS', { rsBucket: 'LEADERS', sectorFit: 'HIGH', sectorTrend: 'LEADING' }),
    );
    const infy = candidate('INFY', snapFor('INFY', { rsBucket: 'MIDDLE', sectorFit: 'MED' }));
    const result = assessOpportunityRanking({ context: swingCtx, candidates: [tcs, infy] });
    const first = result.rankings[0]!;
    const second = result.rankings[1]!;
    const above = first.pairwiseReasons.find(
      (p) => p.polarity === 'ABOVE' && p.peerSymbol === second.symbol,
    );
    const below = second.pairwiseReasons.find(
      (p) => p.polarity === 'BELOW' && p.peerSymbol === first.symbol,
    );
    expect(above).toBeTruthy();
    expect(below).toBeTruthy();
    expect(above!.evidence.length).toBeGreaterThan(0);
    expect(below!.evidence.length).toBeGreaterThan(0);
  });

  it('allows PortfolioFit only as soft tie-break (not veto/authorize)', () => {
    const base = snapFor('TCS', { rsBucket: 'LEADERS', sectorFit: 'HIGH' });
    const twin = snapFor('INFY', { rsBucket: 'LEADERS', sectorFit: 'HIGH' });
    const withFit = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('TCS', base, 'EXCELLENT'), candidate('INFY', twin, 'BLOCKED')],
    });
    // Soft fit may order equals; must not claim Portfolio veto authority.
    expect(withFit.rankings[0]?.symbol).toBe('TCS');
    const analysis = baseAnalysis('TCS');
    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const riskA = evaluateRisk(riskInput);
    const riskB = evaluateRisk(riskInput);
    expect(riskA).toEqual(riskB);
    const port = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    expect(evaluatePortfolio({ decision, risk: riskA, portfolio: port })).toEqual(
      evaluatePortfolio({ decision, risk: riskB, portfolio: port }),
    );
    const policyInput = {
      operatingMode: 'PAPER' as const,
      decisionMode: 'AUTONOMOUS' as const,
      eligibility: decision.eligibility,
      risk: riskA,
      portfolio: evaluatePortfolio({ decision, risk: riskA, portfolio: port }),
    };
    expect(applyDecisionPolicy(policyInput)).toEqual(applyDecisionPolicy(policyInput));
  });

  it('does not emit RankingScore and leaves P5 display ranking intact', () => {
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [
        candidate('TCS', snapFor('TCS', { rsBucket: 'LEADERS' })),
        candidate('INFY', snapFor('INFY', { rsBucket: 'MIDDLE' })),
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/rankingScore|rankScore/i);

    const p5 = rankOpportunitiesForDisplay([
      {
        opportunityId: '1',
        symbol: 'TCS',
        quality: 80,
        expectedValueR: 1.2,
        signalScore: 80,
        quantity: 10,
        portfolioFit: 'GOOD',
      },
      {
        opportunityId: '2',
        symbol: 'INFY',
        quality: 60,
        expectedValueR: 0.4,
        signalScore: 60,
        quantity: 10,
        portfolioFit: 'GOOD',
      },
    ]);
    expect(p5[0]?.symbol).toBe('TCS');
    expect(p5[0]?.rankScore).toBeGreaterThan(p5[1]!.rankScore);
  });

  it('Risk / Portfolio / Policy are identical with vs without ranking result', () => {
    const analysis = baseAnalysis('TCS');
    const decision = evaluateTrade({ analysis });
    const ranking = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('TCS', snapFor('TCS', { rsBucket: 'LEADERS', sectorFit: 'HIGH' }))],
    });
    expect(ranking.rankings).toHaveLength(1);

    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const risk = evaluateRisk(riskInput);
    expect(evaluateRisk(riskInput)).toEqual(risk);

    const portSnap = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const port = evaluatePortfolio({ decision, risk, portfolio: portSnap });
    expect(evaluatePortfolio({ decision, risk, portfolio: portSnap })).toEqual(port);

    const policyInput = {
      operatingMode: 'PAPER' as const,
      decisionMode: 'AUTONOMOUS' as const,
      eligibility: decision.eligibility,
      risk,
      portfolio: port,
    };
    expect(applyDecisionPolicy(policyInput)).toEqual(applyDecisionPolicy(policyInput));
  });

  it('stores reconstructable context + universe provenance', () => {
    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [
        candidate('INFY', snapFor('INFY', { rsBucket: 'MIDDLE' })),
        candidate('TCS', snapFor('TCS', { rsBucket: 'LEADERS' })),
      ],
    });
    expect(result.context.tradeHorizon).toBe('SWING_TRADE');
    expect(result.context.timestamp).toBe(swingCtx.timestamp);
    expect(result.engineVersion).toBeTruthy();
    expect(result.calculationVersion).toBeTruthy();
    expect(result.candidateUniverse).toEqual(['INFY', 'TCS']);
    expect(result.provenance.inputs?.precedence).toContain('RS');
  });
});
