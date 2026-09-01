/**
 * T2.3 Exit Intelligence crown tests.
 */
import type { StructuredThesis } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  applyDecisionPolicy,
  buildExitRecommendation,
  evaluateExitPolicy,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  emptyPortfolioSnapshot,
  verifyExitIntelligenceIsolation,
  EXIT_INTEL_NEAR_TARGET_RATIO,
} from './index';

const NOW = 1_700_000_000_000;

function basePosition(
  overrides: Partial<{
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    stopLoss: number;
    target: number;
    quantity: number;
    openedAt: number;
  }> = {},
) {
  return {
    symbol: 'TCS',
    entryPrice: 3500,
    currentPrice: 3520,
    stopLoss: 3400,
    target: 3700,
    quantity: 10,
    openedAt: NOW - 86_400_000,
    ...overrides,
  };
}

function thesisWithState(state: StructuredThesis['state']): StructuredThesis {
  return {
    symbol: 'TCS',
    side: 'LONG',
    setup: 'Breakout',
    primaryThesis: 'Breakout continuation',
    supportingEvidence: [],
    invalidationConditions: [],
    state,
    provenance: {
      engineVersion: 'thesis-intelligence.v1',
      generatedAt: new Date(NOW).toISOString(),
      sourceDataTimestamp: new Date(NOW).toISOString(),
    },
  };
}

describe('T2.3 Exit Intelligence', () => {
  it('always returns advisory true', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: thesisWithState('VALID'),
    });
    expect(rec.advisory).toBe(true);
  });

  it('hard test B — invalidated thesis yields EXIT advisory only', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: thesisWithState('INVALIDATED'),
    });
    expect(rec.action).toBe('EXIT');
    expect(rec.advisory).toBe(true);
    expect(rec).not.toHaveProperty('execute');
    expect(rec).not.toHaveProperty('quantity');
  });

  it('hard test C — weakening thesis yields TRIM or HOLD not forced EXIT', () => {
    const hold = buildExitRecommendation({
      now: NOW,
      position: basePosition({ currentPrice: 3520, target: 3700 }),
      thesis: thesisWithState('WEAKENING'),
    });
    expect(['HOLD', 'TRIM']).toContain(hold.action);
    expect(hold.action).not.toBe('EXIT');

    const trim = buildExitRecommendation({
      now: NOW,
      position: basePosition({
        currentPrice: 3700 * EXIT_INTEL_NEAR_TARGET_RATIO,
        target: 3700,
      }),
      thesis: thesisWithState('WEAKENING'),
    });
    expect(trim.action).toBe('TRIM');
  });

  it('hard test D — missing thesis evidence yields HOLD not EXIT', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: null,
    });
    expect(rec.action).toBe('HOLD');
    expect(rec.reasonCodes).toContain('INSUFFICIENT_EVIDENCE');
  });

  it('rejects future P5 context as evidence', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: thesisWithState('VALID'),
      p5Context: {
        decisionId: 'dec-1',
        maeR: -1.2,
        mfeR: 2.5,
        asOf: NOW + 60_000,
      },
    });
    expect(rec.evidence.some((e) => e.code === 'P5_MAE')).toBe(false);
    expect(rec.evidence.some((e) => e.code === 'P5_MFE')).toBe(false);
  });

  it('includes historical P5 context when temporally valid', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: thesisWithState('VALID'),
      p5Context: {
        decisionId: 'dec-1',
        maeR: -0.5,
        mfeR: 1.1,
        asOf: NOW - 3_600_000,
      },
    });
    expect(rec.evidence.some((e) => e.historical && e.code === 'P5_MAE')).toBe(true);
  });

  it('crown A — Risk / Portfolio / Policy unchanged when exit intelligence attached', () => {
    const analysis = {
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
      thesis: 'Breakout',
      counterThesis: '',
      invalidation: '',
      risks: [],
      action: '',
      usedCapabilities: [],
      missingCapabilities: [],
      capabilityRequests: [],
      generatedAt: NOW,
      disclaimer: 'test',
    } as import('@stockpred/shared-types').AgentAnalysis;

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

    buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: thesisWithState('INVALIDATED'),
    });

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

  it('crown E — evaluateExitPolicy unchanged when exit intelligence built', () => {
    const position = {
      symbol: 'TCS',
      entryPrice: 3500,
      quantity: 10,
      target: 3700,
      stopLoss: 3400,
    };
    const ctx = { price: 3520, thesisIntact: true };
    const before = evaluateExitPolicy(position, ctx);

    buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: thesisWithState('INVALIDATED'),
    });

    const after = evaluateExitPolicy(position, ctx);
    expect(after).toEqual(before);
  });

  it('crown F — recommendation has no execution surface', () => {
    const rec = buildExitRecommendation({
      now: NOW,
      position: basePosition(),
      thesis: thesisWithState('INVALIDATED'),
    });
    const keys = Object.keys(rec);
    expect(keys).not.toContain('orderId');
    expect(keys).not.toContain('tradeId');
    expect(keys).not.toContain('broker');
    expect(keys).not.toContain('quantity');
    expect(JSON.stringify(rec)).not.toMatch(/execute|submit|close/i);
  });

  it('exposes isolation guard without forbidden engine imports', () => {
    const guard = verifyExitIntelligenceIsolation();
    expect(guard.ok).toBe(true);
    expect(guard.forbidden).toContain('exit-policy');
    expect(guard.forbidden).toContain('risk-engine');
  });
});
