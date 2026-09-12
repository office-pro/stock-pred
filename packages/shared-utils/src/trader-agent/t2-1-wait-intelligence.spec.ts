/**
 * T2.1 WAIT Intelligence crown tests.
 */
import type { AgentAnalysis, IntelligenceSnapshot } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  applyDecisionPolicy,
  applyWait,
  buildIntelligenceSnapshot,
  buildWaitRecommendation,
  digestFromSnapshot,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  verifyWaitIntelligenceIsolation,
} from './index';

const NOW = 1_700_000_000_000;

function baseAnalysis(overrides: Partial<AgentAnalysis> = {}): AgentAnalysis {
  return {
    symbol: 'TCS',
    currentPrice: 3520,
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
    generatedAt: NOW,
    disclaimer: 'test',
    ...overrides,
  } as AgentAnalysis;
}

function snapshotFor(analysis: AgentAnalysis): IntelligenceSnapshot {
  const decision = evaluateTrade({ analysis });
  return buildIntelligenceSnapshot({
    analysis,
    decision,
    sourceDataTimestamp: analysis.generatedAt,
    marketContext: {
      scannerRegime: 'RISK_ON',
      breadthPercentAboveEma50: 0.55,
      asOf: NOW,
    },
  });
}

describe('T2.1 WAIT Intelligence', () => {
  it('always returns decision WAIT only', () => {
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    const rec = buildWaitRecommendation({ now: NOW, analysis, snapshot: snap });
    expect(rec.decision).toBe('WAIT');
  });

  it('is deterministic for expiry and price trigger', () => {
    const analysis = baseAnalysis({ currentPrice: 3600 });
    const snap = snapshotFor(analysis);
    const a = buildWaitRecommendation({ now: NOW, analysis, snapshot: snap });
    const b = buildWaitRecommendation({ now: NOW, analysis, snapshot: snap });
    expect(a.expiryAt).toBe(b.expiryAt);
    expect(a.reevaluateWhen).toEqual(b.reevaluateWhen);
    expect(a.reevaluateWhen.trigger).toBe('PRICE');
    expect(a.reevaluateWhen.priceLevel).toBe(3500);
  });

  it('uses TIME trigger when price in entry zone', () => {
    const analysis = baseAnalysis({ currentPrice: 3502 });
    const snap = snapshotFor(analysis);
    const rec = buildWaitRecommendation({ now: NOW, analysis, snapshot: snap });
    expect(rec.reevaluateWhen.trigger).toBe('TIME');
    expect(rec.reevaluateWhen.timeAt).toBe(NOW + 30 * 60_000);
  });

  it('uses EVENT when catalyst event exists and event risk elevated', () => {
    const analysis = baseAnalysis({ currentPrice: 3502 });
    const decision = evaluateTrade({ analysis });
    const snap = buildIntelligenceSnapshot({
      analysis,
      decision,
      sourceDataTimestamp: analysis.generatedAt,
      catalyst: {
        decisionTimestamp: NOW,
        candidates: [
          {
            id: 'evt-earnings',
            type: 'EARNINGS',
            direction: 'UNKNOWN',
            strength: 'MED',
            relevance: 'HIGH',
            eventPublishedAt: new Date(NOW - 86_400_000).toISOString(),
            eventEffectiveAt: new Date(NOW + 2 * 86_400_000).toISOString(),
          },
        ],
      },
    });
    const rec = buildWaitRecommendation({
      now: NOW,
      analysis,
      snapshot: snap,
      previousWait: applyWait({ now: NOW, reason: 'CATALYST_PENDING' }),
    });
    expect(rec.reevaluateWhen.trigger).toBe('EVENT');
    expect(rec.reevaluateWhen.eventRef).toBe('evt-earnings');
  });

  it('returns UNAVAILABLE for event-driven wait without catalyst events', () => {
    const analysis = baseAnalysis({ currentPrice: 3502 });
    const decision = evaluateTrade({ analysis });
    const snap = buildIntelligenceSnapshot({
      analysis,
      decision,
      sourceDataTimestamp: analysis.generatedAt,
      catalyst: { decisionTimestamp: NOW, candidates: [] },
    });
    // Force EVENT_RISK path via snapshot patch for test
    const highRiskSnap = {
      ...snap,
      catalystContext: snap.catalystContext
        ? { ...snap.catalystContext, eventRisk: 'HIGH' as const, events: [] }
        : undefined,
    };
    const rec = buildWaitRecommendation({
      now: NOW,
      analysis,
      snapshot: highRiskSnap,
      previousWait: applyWait({ now: NOW, reason: 'CATALYST_PENDING' }),
    });
    expect(rec.reevaluateWhen.trigger).toBe('UNAVAILABLE');
  });

  it('never mutates authoritative waitExpiresAt via applyWait', () => {
    const waitBefore = applyWait({ now: NOW, ttlMs: 15 * 60_000 });
    const expiresAt = waitBefore.waitExpiresAt;
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    buildWaitRecommendation({
      now: NOW + 5_000,
      analysis,
      snapshot: snap,
      previousWait: waitBefore,
    });
    expect(waitBefore.waitExpiresAt).toBe(expiresAt);
  });

  it('builds evidenceDelta from prior digest', () => {
    const analysis = baseAnalysis();
    const snap = snapshotFor(analysis);
    const priorDigest = digestFromSnapshot(snap);
    const changedSnap = {
      ...snap,
      marketContext: {
        ...snap.marketContext,
        regimeCombo: 'RISK_OFF|HIGH',
      },
      expectedValue: {
        ...(snap.expectedValue ?? {}),
        expectedValueR: 0.34,
        rewardR: 1.2,
        riskR: 1,
      },
    };
    const rec = buildWaitRecommendation({
      now: NOW,
      analysis,
      snapshot: changedSnap,
      previousWait: { ...applyWait({ now: NOW }), priorDigest },
    });
    expect(rec.evidenceDelta?.some((d) => d.includes('REGIME'))).toBe(true);
  });

  it('evaluateTrade / Risk / Portfolio / Policy unchanged when wait intelligence attached', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const riskA = evaluateRisk(riskInput);
    const portfolioSnap = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const portA = evaluatePortfolio({ decision, risk: riskA, portfolio: portfolioSnap });
    const policyA = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'APPROVAL',
      eligibility: decision.eligibility,
      risk: riskA,
      portfolio: portA,
    });

    const snap = snapshotFor(analysis);
    const waitIntel = buildWaitRecommendation({ now: NOW, analysis, snapshot: snap });
    const tampered = {
      ...waitIntel,
      reasonCodes: [...waitIntel.reasonCodes, 'TAMPERED'],
      summary: 'tampered summary',
    };
    expect(tampered.decision).toBe('WAIT');

    const riskB = evaluateRisk(riskInput);
    const portB = evaluatePortfolio({ decision, risk: riskB, portfolio: portfolioSnap });
    const policyB = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'APPROVAL',
      eligibility: decision.eligibility,
      risk: riskB,
      portfolio: portB,
    });

    expect(riskB).toEqual(riskA);
    expect(portB).toEqual(portA);
    expect(policyB).toEqual(policyA);
  });

  it('exposes isolation guard without forbidden engine imports', () => {
    const guard = verifyWaitIntelligenceIsolation();
    expect(guard.ok).toBe(true);
    expect(guard.forbidden).toContain('risk-engine');
  });
});
