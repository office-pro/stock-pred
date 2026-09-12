/**
 * OH-2 Execution Health hard gates.
 * Observe-only — must not change Decision / Risk / Portfolio / Policy / Gate.
 */

import type { AgentAnalysis } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  OhExecutionHealthCollector,
  OH2_FILL_DELAYED_MS,
  OH2_STUCK_ORDER_MS,
  applyDecisionPolicy,
  classifyExecutionHealth,
  diagnosticFromExecutionError,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  priceDeviationPct,
} from './index';

function baseAnalysis(symbol = 'TCS', overall = 80): AgentAnalysis {
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

describe('P5 Operational Hardening OH-2 Execution Health', () => {
  it('1. Healthy execution lifecycle → HEALTHY', () => {
    const c = new OhExecutionHealthCollector();
    c.setBrokerConnected(true);
    c.noteFailureStreak(0);
    c.record({
      phase: 'FILL',
      decisionId: 'd1',
      orderId: 'o1',
      positionId: 'p1',
      symbol: 'TCS',
      submitAckMs: 40,
      fillMs: 80,
      e2eMs: 120,
      expectedQty: 2,
      actualQty: 2,
      expectedPrice: 3500,
      fillPrice: 3500,
      ok: true,
    });
    const snap = c.snapshot();
    expect(snap.observeOnly).toBe(true);
    expect(snap.status).toBe('HEALTHY');
    expect(snap.recent[0].decisionId).toBe('d1');
    expect(snap.recent[0].orderId).toBe('o1');
    expect(snap.recent[0].positionId).toBe('p1');
  });

  it('2. Broker timeout detection', () => {
    expect(diagnosticFromExecutionError({ code: 'ECONNABORTED', message: 'timeout' })).toBe(
      'BROKER_TIMEOUT',
    );
    const c = new OhExecutionHealthCollector();
    c.setBrokerConnected(true);
    c.record({
      phase: 'ERROR',
      decisionId: 'd2',
      ok: false,
      diagnostic: 'BROKER_TIMEOUT',
      message: 'timeout',
    });
    expect(c.snapshot().diagnostics).toContain('BROKER_TIMEOUT');
    expect(c.snapshot().status).toBe('UNAVAILABLE');
  });

  it('3. Broker disconnect detection', () => {
    const classified = classifyExecutionHealth({
      samples: [],
      brokerConnected: false,
      failureStreak: 0,
      pendingOpenCount: 0,
    });
    expect(classified.status).toBe('UNAVAILABLE');
    expect(classified.diagnostics).toContain('BROKER_DISCONNECTED');
  });

  it('4. Stuck-order detection', () => {
    const c = new OhExecutionHealthCollector();
    c.setBrokerConnected(true);
    c.noteSubmitStarted({ decisionId: 'd-stuck', symbol: 'INFY', expectedQty: 1 });
    const stuck = c.scanStuckOrders(Date.now() + OH2_STUCK_ORDER_MS + 1);
    expect(stuck.some((s) => s.diagnostic === 'ORDER_STUCK')).toBe(true);
    expect(c.snapshot().diagnostics).toContain('ORDER_STUCK');
  });

  it('5. Fill-latency measurement (FILL_DELAYED)', () => {
    const c = new OhExecutionHealthCollector();
    c.setBrokerConnected(true);
    c.record({
      phase: 'FILL',
      decisionId: 'd3',
      orderId: 'o3',
      fillMs: OH2_FILL_DELAYED_MS + 500,
      e2eMs: OH2_FILL_DELAYED_MS + 500,
      ok: true,
    });
    expect(c.snapshot().diagnostics).toContain('FILL_DELAYED');
    expect(c.snapshot().latency.fillP50Ms).toBeGreaterThanOrEqual(OH2_FILL_DELAYED_MS);
  });

  it('6. Price / quantity mismatch detection', () => {
    expect(priceDeviationPct(100, 102)).toBeCloseTo(2, 5);
    const c = new OhExecutionHealthCollector();
    c.setBrokerConnected(true);
    c.record({
      phase: 'FILL',
      decisionId: 'd4',
      orderId: 'o4',
      expectedQty: 5,
      actualQty: 3,
      expectedPrice: 100,
      fillPrice: 103,
      priceDeviationPct: priceDeviationPct(100, 103) ?? undefined,
      ok: false,
      diagnostic: 'PRICE_DEVIATION',
    });
    const snap = c.snapshot();
    expect(snap.diagnostics).toContain('QTY_MISMATCH');
    expect(snap.diagnostics).toContain('PRICE_DEVIATION');
  });

  it('7. Duplicate attempt detection', () => {
    const c = new OhExecutionHealthCollector();
    c.record({
      phase: 'ERROR',
      decisionId: 'd5',
      symbol: 'TCS',
      ok: false,
      diagnostic: 'DUPLICATE_ATTEMPT',
    });
    expect(c.snapshot().counts.duplicates).toBe(1);
    expect(c.snapshot().diagnostics).toContain('DUPLICATE_ATTEMPT');
  });

  it('8. Metrics do not change Decision/Risk/Portfolio/Policy outputs', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const risk = evaluateRisk(riskInput);
    const port = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    const portfolio = evaluatePortfolio({ decision, risk, portfolio: port });
    const policyInput = {
      operatingMode: 'PAPER' as const,
      decisionMode: 'AUTONOMOUS' as const,
      eligibility: decision.eligibility,
      risk,
      portfolio,
    };
    const policy = applyDecisionPolicy(policyInput);

    const c = new OhExecutionHealthCollector();
    c.record({
      phase: 'ERROR',
      decisionId: decision.decisionId,
      ok: false,
      diagnostic: 'EXECUTION_FAILURE',
    });
    c.snapshot();

    expect(evaluateRisk(riskInput)).toEqual(risk);
    expect(evaluatePortfolio({ decision, risk, portfolio: port })).toEqual(portfolio);
    expect(applyDecisionPolicy(policyInput)).toEqual(policy);
  });

  it('9. Missing / bad telemetry does not crash', () => {
    const c = new OhExecutionHealthCollector();
    expect(() =>
      c.record({
        phase: 'FILL',
        decisionId: undefined,
        orderId: undefined,
        ok: true,
        submitAckMs: Number.NaN as unknown as number,
      }),
    ).not.toThrow();
    expect(() => c.noteSubmitStarted({ decisionId: '' })).not.toThrow();
    expect(() => c.snapshot()).not.toThrow();
  });

  it('10. Samples stay correlated decisionId → orderId → positionId', () => {
    const c = new OhExecutionHealthCollector();
    c.record({
      phase: 'SUBMIT',
      decisionId: 'dec-9',
      symbol: 'WIPRO',
      ok: true,
    });
    c.record({
      phase: 'FILL',
      decisionId: 'dec-9',
      orderId: 'ord-9',
      positionId: 'pos-9',
      symbol: 'WIPRO',
      submitAckMs: 30,
      e2eMs: 90,
      ok: true,
    });
    const fill = c.snapshot().recent.find((s) => s.phase === 'FILL');
    expect(fill?.decisionId).toBe('dec-9');
    expect(fill?.orderId).toBe('ord-9');
    expect(fill?.positionId).toBe('pos-9');
  });
});
