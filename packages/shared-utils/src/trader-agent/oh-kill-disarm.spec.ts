/**
 * OH-4 Kill/Disarm crown tests A–D.
 * Observe-only — must not change Risk / Portfolio / Policy / Gate / TI / P5 / PAPER semantics.
 */

import type { AgentAnalysis, PortfolioVerdict, RiskVerdict } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  OhSafetyEventCollector,
  applyDecisionPolicy,
  buildOhReconciliationReport,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  verifyKillSwitchBlocksExecute,
  verifyLiveDisarmBlocksExecute,
  verifyOh4Isolation,
  wouldAutonomousExecute,
} from './index';

const okRisk: RiskVerdict = {
  allowed: true,
  riskScore: 1,
  quantity: 10,
  riskAmount: 500,
  stopLoss: 95,
  maxLoss: 500,
  riskReward: 2,
  reasonCodes: [],
  reasons: [],
};

const okPortfolio: PortfolioVerdict = {
  allowed: true,
  openPositions: 0,
  cash: 100_000,
  requiredCapital: 1_000,
  nameExposurePct: 5,
  sectorExposurePct: 10,
  reasonCodes: [],
  reasons: [],
};

function baseAnalysis(symbol = 'TCS'): AgentAnalysis {
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
    thesis: 'Breakout',
    counterThesis: 'Risk-off',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  };
}

describe('P5 Operational Hardening OH-4 Kill/Disarm', () => {
  it('A. LIVE disarm → HUMAN_REQUIRED → no execute', () => {
    const before = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
      liveAutoArmed: true,
    });
    expect(before.outcome).toBe('AUTO_ACCEPTED');
    expect(wouldAutonomousExecute(before)).toBe(true);

    const after = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
      liveAutoArmed: false,
    });
    expect(after.outcome).toBe('HUMAN_REQUIRED');
    expect(after.reasonCodes).toContain('LIVE_AUTONOMOUS_NOT_ARMED');

    const verified = verifyLiveDisarmBlocksExecute({
      beforeDisarm: before,
      afterDisarm: after,
    });
    expect(verified.ok).toBe(true);
    expect(verified.wouldExecuteAfter).toBe(false);

    // Preserve PAPER semantics: PAPER + AUTONOMOUS ignores LIVE latch
    const paper = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
      liveAutoArmed: false,
    });
    expect(paper.outcome).toBe('AUTO_ACCEPTED');
  });

  it('B. Kill switch → Risk blocked → Policy REJECT → no execute', () => {
    const decision = evaluateTrade({ analysis: baseAnalysis() });
    const risk = evaluateRisk({
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: true,
    });
    expect(risk.allowed).toBe(false);
    if (!risk.allowed) {
      expect(risk.blockedBy).toContain('KILL_SWITCH');
    }

    const policy = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk,
      portfolio: okPortfolio,
      liveAutoArmed: true,
    });
    expect(policy.outcome).toBe('REJECT');

    const verified = verifyKillSwitchBlocksExecute({ risk, policy });
    expect(verified.ok).toBe(true);
    expect(verified.wouldExecute).toBe(false);
  });

  it('C. OH-4 ON/OFF → identical Risk / Portfolio / Policy', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const portfolioSnap = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };

    const riskOff = evaluateRisk(riskInput);
    const portOff = evaluatePortfolio({ decision, risk: riskOff, portfolio: portfolioSnap });
    const policyOff = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk: riskOff,
      portfolio: portOff,
    });

    const collector = new OhSafetyEventCollector();
    collector.record({ code: 'DISARM_REQUESTED', message: 'telemetry on' });
    collector.record({ code: 'DISARM_CONFIRMED' });
    collector.snapshot();

    const riskOn = evaluateRisk(riskInput);
    const portOn = evaluatePortfolio({ decision, risk: riskOn, portfolio: portfolioSnap });
    const policyOn = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk: riskOn,
      portfolio: portOn,
    });

    const verified = verifyOh4Isolation({
      riskA: riskOff,
      riskB: riskOn,
      portfolioA: portOff,
      portfolioB: portOn,
      policyA: policyOff,
      policyB: policyOn,
    });
    expect(verified.ok).toBe(true);
  });

  it('D. Safety audit events + reconciliation remain observe-only', () => {
    const collector = new OhSafetyEventCollector();
    collector.record({ code: 'DISARM_REQUESTED', decisionId: 'd1' });
    collector.record({ code: 'DISARM_CONFIRMED', decisionId: 'd1' });
    collector.record({ code: 'KILL_SWITCH_TRIGGERED' });
    collector.record({ code: 'TRADING_DISABLED' });
    collector.record({
      code: 'AUTONOMOUS_AUTHORIZATION_BLOCKED',
      decisionId: 'd2',
      message: 'policy=HUMAN_REQUIRED',
    });

    const snap = collector.snapshot();
    expect(snap.observeOnly).toBe(true);
    expect(snap.schemaVersion).toBe('oh-safety-events.v1');
    expect(snap.counts.DISARM_CONFIRMED).toBe(1);
    expect(snap.counts.KILL_SWITCH_TRIGGERED).toBe(1);
    expect(
      snap.recent.some((e: { code: string }) => e.code === 'AUTONOMOUS_AUTHORIZATION_BLOCKED'),
    ).toBe(true);

    const report = buildOhReconciliationReport({
      ledger: [
        {
          decisionId: 'd1',
          symbol: 'TCS',
          decision: 'APPROVED',
          timestamp: Date.now(),
          executionOrderId: 'o1',
          executionQty: 2,
          executionStatus: 'EXECUTED',
        },
      ],
      holdings: [{ symbol: 'TCS', quantity: 2, orderId: 'o1', decisionId: 'd1' }],
    });
    expect(report.observeOnly).toBe(true);
    expect(report.summary.issueCount).toBe(0);

    expect(() =>
      collector.record({ code: undefined as unknown as 'DISARM_REQUESTED' }),
    ).not.toThrow();
    expect(() => collector.snapshot()).not.toThrow();
  });
});
