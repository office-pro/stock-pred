/**
 * OH-6 Unified Operations Report hard gates.
 * Observe-only — must not change Risk / Portfolio / Policy / Gate.
 */

import type { AgentAnalysis } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  OhDataQualityCollector,
  OhExecutionHealthCollector,
  OhPipelineMetricsCollector,
  OhSafetyEventCollector,
  applyDecisionPolicy,
  buildOhOpsReport,
  buildOhReconciliationReport,
  buildRecommendedActions,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  verifyOh6Isolation,
} from './index';

function healthyPipeline(): ReturnType<OhPipelineMetricsCollector['snapshot']> {
  const c = new OhPipelineMetricsCollector();
  c.record({
    sampleId: 'p1',
    recordedAt: Date.now(),
    kind: 'PIPELINE',
    symbol: 'TCS',
    stages: [{ stage: 'pipelineTotal', ms: 120 }],
    totalMs: 120,
    ok: true,
  });
  return c.snapshot();
}

function healthyExecution(): ReturnType<OhExecutionHealthCollector['snapshot']> {
  const c = new OhExecutionHealthCollector();
  c.setBrokerConnected(true);
  c.noteFailureStreak(0);
  c.record({
    phase: 'FILL',
    decisionId: 'd1',
    ok: true,
    submitAckMs: 30,
    fillMs: 50,
    e2eMs: 80,
  });
  return c.snapshot();
}

function healthyReconciliation() {
  return buildOhReconciliationReport({
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
}

function healthySafety(): ReturnType<OhSafetyEventCollector['snapshot']> {
  return new OhSafetyEventCollector().snapshot();
}

function healthyDataQuality(): ReturnType<OhDataQualityCollector['snapshot']> {
  const c = new OhDataQualityCollector();
  c.noteSourceReachable(true);
  c.recordIssues('QUOTE', [], { symbol: 'TCS' });
  return c.snapshot();
}

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

describe('P5 Operational Hardening OH-6 Unified Operations Report', () => {
  it('1. all OH components healthy → HEALTHY', () => {
    const report = buildOhOpsReport({
      pipeline: healthyPipeline(),
      execution: healthyExecution(),
      reconciliation: healthyReconciliation(),
      safety: healthySafety(),
      dataQuality: healthyDataQuality(),
    });
    expect(report.observeOnly).toBe(true);
    expect(report.schemaVersion).toBe('oh-ops-report.v1');
    expect(report.overallStatus).toBe('HEALTHY');
    expect(report.componentStatuses).toHaveLength(5);
    expect(report.recommendedActions.length).toBeGreaterThan(0);
  });

  it('2. degraded execution component → DEGRADED overall', () => {
    const exec = new OhExecutionHealthCollector();
    exec.setBrokerConnected(true);
    exec.noteFailureStreak(2);
    exec.record({
      phase: 'ERROR',
      decisionId: 'd2',
      ok: false,
      diagnostic: 'EXECUTION_FAILURE',
    });
    const report = buildOhOpsReport({
      pipeline: healthyPipeline(),
      execution: exec.snapshot(),
      reconciliation: healthyReconciliation(),
      safety: healthySafety(),
      dataQuality: healthyDataQuality(),
    });
    expect(report.overallStatus).toBe('DEGRADED');
    expect(report.diagnostics.some((d) => d.startsWith('OH2_EXECUTION'))).toBe(true);
  });

  it('3. unavailable critical component → UNAVAILABLE overall', () => {
    const exec = new OhExecutionHealthCollector();
    exec.setBrokerConnected(false);
    const dq = new OhDataQualityCollector();
    dq.noteSourceReachable(false);
    dq.recordIssues('SOURCE', [{ diagnostic: 'SOURCE_UNAVAILABLE', message: 'down' }]);
    const report = buildOhOpsReport({
      pipeline: healthyPipeline(),
      execution: exec.snapshot(),
      reconciliation: healthyReconciliation(),
      safety: healthySafety(),
      dataQuality: dq.snapshot(),
    });
    expect(report.overallStatus).toBe('UNAVAILABLE');
    expect(
      buildRecommendedActions(report.componentStatuses).some(
        (a) => a.componentId === 'OH2_EXECUTION',
      ),
    ).toBe(true);
  });

  it('4. malformed telemetry → report does not throw', () => {
    expect(() =>
      buildOhOpsReport({
        pipeline: null as unknown as ReturnType<OhPipelineMetricsCollector['snapshot']>,
        execution: healthyExecution(),
        reconciliation: null,
        safety: healthySafety(),
        dataQuality: healthyDataQuality(),
      }),
    ).not.toThrow();

    const report = buildOhOpsReport({
      pipeline: null as unknown as ReturnType<OhPipelineMetricsCollector['snapshot']>,
      execution: healthyExecution(),
      reconciliation: null,
      safety: healthySafety(),
      dataQuality: healthyDataQuality(),
    });
    expect(report.observeOnly).toBe(true);
    expect(report.overallStatus).not.toBe('HEALTHY');
  });

  it('5. OH-6 ON vs OFF → identical Risk / Portfolio / Policy', () => {
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

    buildOhOpsReport({
      pipeline: healthyPipeline(),
      execution: (() => {
        const c = new OhExecutionHealthCollector();
        c.setBrokerConnected(false);
        return c.snapshot();
      })(),
      reconciliation: buildOhReconciliationReport({
        ledger: [],
        holdings: [{ symbol: 'TCS', quantity: 99 }],
      }),
      safety: (() => {
        const s = new OhSafetyEventCollector();
        s.record({ code: 'KILL_SWITCH_TRIGGERED' });
        return s.snapshot();
      })(),
      dataQuality: (() => {
        const d = new OhDataQualityCollector();
        d.recordIssues('QUOTE', [{ diagnostic: 'DATA_STALE', message: 'stale' }]);
        return d.snapshot();
      })(),
    });

    const riskOn = evaluateRisk(riskInput);
    const portOn = evaluatePortfolio({ decision, risk: riskOn, portfolio: portfolioSnap });
    const policyOn = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: decision.eligibility,
      risk: riskOn,
      portfolio: portOn,
    });

    const verified = verifyOh6Isolation({
      riskA: riskOff,
      riskB: riskOn,
      portfolioA: portOff,
      portfolioB: portOn,
      policyA: policyOff,
      policyB: policyOn,
    });
    expect(verified.ok).toBe(true);
  });
});
