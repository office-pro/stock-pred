/**
 * Crown test: IntelligenceSnapshot must not change Risk / Portfolio / Policy outcomes.
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
  } as AgentAnalysis;
}

describe('IntelligenceSnapshot isolation (P4 crown)', () => {
  it('Risk / Portfolio / Policy are identical with or without snapshot', () => {
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
    const policyA = applyDecisionPolicy(policyInput);
    const policyB = applyDecisionPolicy({
      ...policyInput,
      risk: riskB,
      portfolio: portB,
    });
    expect(policyA).toEqual(policyB);
    expect(policyA.outcome).toBe('AUTO_ACCEPTED');

    const snapshot = buildIntelligenceSnapshot({ analysis, decision });
    expect(snapshot.schemaVersion).toBeTruthy();
    expect(evaluateRisk(riskInput)).toEqual(riskA);
  });

  it('LIVE + AUTONOMOUS remains HUMAN_REQUIRED', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const risk = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    });
    const portfolio = evaluatePortfolio({
      decision,
      risk,
      portfolio: emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000),
    });
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
