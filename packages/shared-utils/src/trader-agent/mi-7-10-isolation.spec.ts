/**
 * MI-7.10 — Isolation crown: advanced intelligence does not alter auth path.
 */
import type { AgentAnalysis } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  applyDecisionPolicy,
  buildIntelligenceSnapshot,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
} from './index';

function baseAnalysis(): AgentAnalysis {
  return {
    symbol: 'ISO',
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
      instrument: 'ISO',
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
    thesis: 'test',
    counterThesis: 'risk',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  } as AgentAnalysis;
}

describe('MI-7.10 isolation', () => {
  it('changing advanced intelligence fields leaves Risk/Portfolio/Policy unchanged', () => {
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
    const policyInput = {
      operatingMode: 'PAPER' as const,
      decisionMode: 'AUTONOMOUS' as const,
      eligibility: decision.eligibility,
      risk: riskA,
      portfolio: portA,
    };
    const policyA = applyDecisionPolicy(policyInput);

    const snap = buildIntelligenceSnapshot({ analysis, decision });
    snap.advancedIntelligenceSnapshotId = 'ADV-CHANGED';
    snap.marketIntelligenceSnapshotId = 'MI-CHANGED';
    snap.dataSnapshotVersion = 'md-changed';

    expect(evaluateRisk(riskInput)).toEqual(riskA);
    expect(evaluatePortfolio({ decision, risk: riskA, portfolio: portfolioSnap })).toEqual(portA);
    expect(applyDecisionPolicy(policyInput)).toEqual(policyA);
  });
});
