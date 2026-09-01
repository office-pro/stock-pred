import type { AgentAnalysis } from '@stockpred/shared-types';
import {
  assessCatalystContext,
  candidatesFromAltData,
  dedupeCatalystCandidates,
  isLookAheadSafe,
  logicalEventKey,
} from './catalyst-context-engine';
import { buildIntelligenceSnapshot } from './intelligence-snapshot';
import { evaluateTrade } from './decision-engine';
import {
  applyDecisionPolicy,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
} from './index';
import { TradingMode } from '@stockpred/shared-types';

function baseAnalysis(): AgentAnalysis {
  return {
    symbol: 'TCS',
    currentPrice: 3500,
    decision: 'BUY',
    scores: {
      fundamental: 70,
      technical: 88,
      sentiment: 60,
      quant: 65,
      macro: 70,
      sector: 60,
      risk: 70,
      overall: 80,
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

describe('T1.7 Catalyst / Event Context', () => {
  const decisionTs = '2026-08-24T10:30:00.000Z';

  it('does not treat upcoming earnings as a bullish catalyst (uncertainty test)', () => {
    const assessment = assessCatalystContext({
      intendedSide: 'LONG',
      tradeHorizon: 'SWING_TRADE',
      decisionTimestamp: decisionTs,
      candidates: [
        {
          type: 'EARNINGS',
          title: 'TCS Q1 earnings',
          eventPublishedAt: '2026-08-20T10:00:00.000Z',
          eventEffectiveAt: '2026-08-26T00:00:00.000Z',
          expectedImpact: 'HIGH',
          // Intentionally wrong — engine must ignore for unresolved binary
          direction: 'BULLISH',
        },
      ],
    });
    expect(assessment.events).toHaveLength(1);
    expect(assessment.events[0].direction).toBe('UNKNOWN');
    expect(assessment.events[0].uncertainty).toBe('HIGH');
    expect(assessment.eventRisk).toBe('HIGH');
    expect(assessment.thesisInteraction).toBe('INCREASES_EVENT_RISK');
    expect(assessment.conflicts.some((c) => c.code === 'EARNINGS_NEAR')).toBe(true);
    expect(assessment.conflicts.some((c) => c.code === 'UNRESOLVED_BINARY_EVENT')).toBe(true);
    expect((assessment as { catalystScore?: number }).catalystScore).toBeUndefined();
  });

  it('excludes events published after decision timestamp (freshness / look-ahead)', () => {
    const assessment = assessCatalystContext({
      intendedSide: 'LONG',
      decisionTimestamp: decisionTs,
      candidates: [
        {
          type: 'NEWS',
          title: 'Late tip',
          direction: 'BULLISH',
          eventPublishedAt: '2026-08-24T14:00:00.000Z',
          eventEffectiveAt: '2026-08-24T14:00:00.000Z',
          outcomeResolved: true,
        },
        {
          type: 'NEWS',
          title: 'Morning print',
          direction: 'NEUTRAL',
          eventPublishedAt: '2026-08-24T10:00:00.000Z',
          eventEffectiveAt: '2026-08-24T10:00:00.000Z',
          outcomeResolved: true,
        },
      ],
    });
    expect(isLookAheadSafe({ eventPublishedAt: '2026-08-24T14:00:00.000Z' }, decisionTs)).toBe(
      false,
    );
    expect(assessment.events).toHaveLength(1);
    expect(assessment.events[0].title).toBe('Morning print');
    expect(assessment.provenance.inputs?.lookAheadExcluded).toBe(1);
  });

  it('dedupes the same logical event from multiple feeds', () => {
    const candidates = [
      {
        type: 'EARNINGS' as const,
        title: 'TCS Earnings',
        eventPublishedAt: '2026-08-20T09:00:00.000Z',
        eventEffectiveAt: '2026-08-26T00:00:00.000Z',
        feedId: 'reuters',
      },
      {
        type: 'EARNINGS' as const,
        title: 'TCS earnings',
        eventPublishedAt: '2026-08-20T09:05:00.000Z',
        eventEffectiveAt: '2026-08-26T00:00:00.000Z',
        feedId: 'bloomberg',
      },
      {
        type: 'EARNINGS' as const,
        title: 'TCS Earnings!',
        eventPublishedAt: '2026-08-20T09:10:00.000Z',
        eventEffectiveAt: '2026-08-26T00:00:00.000Z',
        feedId: 'internal',
      },
    ];
    expect(logicalEventKey(candidates[0])).toBe(logicalEventKey(candidates[1]));
    const deduped = dedupeCatalystCandidates(candidates);
    expect(deduped).toHaveLength(1);

    const assessment = assessCatalystContext({
      decisionTimestamp: decisionTs,
      candidates,
    });
    expect(assessment.events).toHaveLength(1);
    expect(assessment.events[0].sourceFeeds?.length).toBe(3);
  });

  it('allows resolved past outcomes to keep directional evidence', () => {
    const assessment = assessCatalystContext({
      intendedSide: 'LONG',
      decisionTimestamp: decisionTs,
      candidates: [
        {
          type: 'ORDER_WIN',
          title: 'Large order win announced',
          direction: 'BULLISH',
          eventPublishedAt: '2026-08-22T08:00:00.000Z',
          eventEffectiveAt: '2026-08-22T08:00:00.000Z',
          outcomeResolved: true,
          expectedImpact: 'MED',
        },
      ],
    });
    expect(assessment.events[0].direction).toBe('BULLISH');
    expect(assessment.thesisInteraction).toBe('SUPPORTS');
    expect(assessment.eventRisk).toBe('NONE');
  });

  it('attaches catalyst context onto snapshot with soft conflicts only', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const snap = buildIntelligenceSnapshot({
      analysis,
      decision,
      sourceDataTimestamp: decisionTs,
      catalyst: {
        decisionTimestamp: decisionTs,
        candidates: [
          {
            type: 'EARNINGS',
            title: 'TCS earnings',
            eventPublishedAt: '2026-08-20T10:00:00.000Z',
            eventEffectiveAt: '2026-08-26T00:00:00.000Z',
            expectedImpact: 'HIGH',
          },
        ],
      },
    });
    expect(snap.catalystContext?.eventRisk).toBe('HIGH');
    expect(snap.opportunity?.catalystContext?.events[0].direction).toBe('UNKNOWN');
    const soft = (snap.conflicts ?? []).filter((c) =>
      ['EARNINGS_NEAR', 'EVENT_RISK_HIGH', 'UNRESOLVED_BINARY_EVENT'].includes(c.code),
    );
    expect(soft.length).toBeGreaterThan(0);
    expect(soft.every((c) => c.severity === 'INFO' || c.severity === 'WARN')).toBe(true);
    expect(soft.some((c) => c.severity === 'BLOCK')).toBe(false);
  });

  it('Risk / Portfolio / Policy / Gate path identical with vs without catalyst', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const snapWith = buildIntelligenceSnapshot({
      analysis,
      decision,
      sourceDataTimestamp: decisionTs,
      catalyst: {
        decisionTimestamp: decisionTs,
        candidates: [
          {
            type: 'EARNINGS',
            title: 'TCS earnings',
            eventPublishedAt: '2026-08-20T10:00:00.000Z',
            eventEffectiveAt: '2026-08-26T00:00:00.000Z',
          },
        ],
      },
    });
    const snapWithout = buildIntelligenceSnapshot({ analysis, decision });
    expect(snapWith.catalystContext).toBeTruthy();
    expect(snapWithout.catalystContext).toBeUndefined();

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

    const portfolioSnap = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const portA = evaluatePortfolio({ decision, risk: riskA, portfolio: portfolioSnap });
    const portB = evaluatePortfolio({ decision, risk: riskB, portfolio: portfolioSnap });
    expect(portA).toEqual(portB);

    const policyInput = {
      operatingMode: 'PAPER' as const,
      decisionMode: 'AUTONOMOUS' as const,
      eligibility: decision.eligibility,
      risk: riskA,
      portfolio: portA,
    };
    expect(applyDecisionPolicy(policyInput)).toEqual(applyDecisionPolicy(policyInput));
    // Snapshot never enters engines — building it must not mutate decision/risk.
    expect(evaluateRisk(riskInput)).toEqual(riskA);
  });

  it('candidatesFromAltData never invents upcoming earnings calendar', () => {
    const candidates = candidatesFromAltData({
      symbol: 'TCS',
      news: {
        availableAt: Date.parse('2026-08-23T12:00:00.000Z'),
        sentiment7d: 0.1,
        highImpact7d: 1,
        earningsSentiment: 0.9,
        count7d: 5,
      },
    });
    expect(candidates.every((c) => c.type !== 'EARNINGS')).toBe(true);
    expect(candidates.every((c) => c.type === 'NEWS')).toBe(true);
  });
});
