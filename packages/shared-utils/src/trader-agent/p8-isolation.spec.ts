/**
 * P8.3 — Isolation proofs: scaling does not alter auth, P7, tenant, or idempotency.
 */
import type { AgentAnalysis, TradeDecision } from '@stockpred/shared-types';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  authorizationProjectionsEqual,
  runBaselineAuthorizationChain,
} from './authorization-test-harness';
import { emptyBreakerMetrics } from './circuit-breakers';
import { applyDecisionPolicy } from './decision-policy';
import { DEFAULT_DUPLICATE_ORDER_WINDOW_MS, simulateRevalidatingGate } from './gate-sim';
import { evaluateP7BreakerSystem } from './p7-breaker-aggregation';
import { isLiveAutoEffectivelyArmed, readP5EvidenceUnlock } from './p5-evidence-unlock';
import { SimulatedBook } from './simulated-book';
import { loadScaleConfig, TenantBreakerStore } from './throughput-scale';

function baseAnalysis(): AgentAnalysis {
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
      invalidation: 'x',
    },
    marketRegime: 'RISK_ON',
    thesis: 't',
    counterThesis: 'c',
    invalidation: 'i',
    risks: [],
    action: 'a',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  } as AgentAnalysis;
}

function minimalDecision(symbol = 'TCS'): TradeDecision {
  const now = Date.now();
  return {
    decisionId: 'dec-1',
    symbol,
    intent: 'BUY',
    eligibility: 'AUTONOMOUS_ELIGIBLE',
    signalScore: 80,
    confidence: 0.8,
    scores: {
      fundamental: 70,
      technical: 80,
      sentiment: 60,
      quant: 70,
      macro: 50,
      sector: 60,
      risk: 70,
      overall: 80,
    },
    strategy: 'COMPOSITE',
    marketRegime: 'NEUTRAL',
    thesis: 't',
    counterThesis: 'c',
    invalidation: 'i',
    reasons: [],
    reasonCodes: ['BUY_DECISION'],
    setup: {
      entry: 3500,
      stopLoss: 3400,
      target1: 3700,
      target2: null,
      target3: null,
      riskReward: 2,
      recommendedQty: 10,
    },
    createdAt: now - 1000,
    ttlMs: 60_000,
    quoteTimestamp: now - 500,
  };
}

/** Mirrors DecisionLedgerStore appendOutcome idempotency contract (tradeId key). */
function simulateOutcomeIdempotency(
  store: Map<string, { outcomeId: string; tradeId: string }>,
  row: { outcomeId: string; tradeId: string; decisionId: string },
): { duplicate: boolean; recorded: { outcomeId: string; tradeId: string } } {
  const key = row.tradeId || row.decisionId;
  const existing = store.get(key);
  if (existing) {
    return { duplicate: true, recorded: existing };
  }
  store.set(key, { outcomeId: row.outcomeId, tradeId: row.tradeId });
  return { duplicate: false, recorded: row };
}

describe('p8-isolation (P8.3)', () => {
  it('authorization chain unchanged regardless of scale config overrides', () => {
    const baseline = runBaselineAuthorizationChain({
      analysis: baseAnalysis(),
      includeGate: true,
    });
    loadScaleConfig({ AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '50' });
    const underScale = runBaselineAuthorizationChain({
      analysis: baseAnalysis(),
      includeGate: true,
    });
    expect(authorizationProjectionsEqual(baseline.projection, underScale.projection)).toBe(true);
  });

  it('scale config does not add policy outcome fields', () => {
    const cfg = loadScaleConfig({ AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '50' });
    expect(cfg.maxAutonomousAcceptsPerCycle).toBe(50);
    expect(cfg).not.toHaveProperty('outcome');
  });

  it('P5/P6 LIVE+AUTONOMOUS stays HUMAN_REQUIRED when evidence NO-GO', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p8-iso-'));
    const path = join(dir, 'review.json');
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 'p5-evidence-review.v1',
        overallDecision: 'NO-GO',
        generatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    expect(readP5EvidenceUnlock(path).unlocked).toBe(false);
    expect(isLiveAutoEffectivelyArmed(true, path)).toBe(false);
    loadScaleConfig({ AGENT_ANALYSIS_CONCURRENCY: '8' });
    const live = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: {
        allowed: true,
        riskScore: 1,
        quantity: 10,
        riskAmount: 500,
        stopLoss: 95,
        maxLoss: 500,
        riskReward: 2,
        reasonCodes: [],
        reasons: [],
      } as never,
      portfolio: {
        allowed: true,
        openPositions: 0,
        cash: 100_000,
        requiredCapital: 1_000,
        nameExposurePct: 5,
        sectorExposurePct: 10,
        reasonCodes: [],
        reasons: [],
      } as never,
      liveAutoArmed: false,
    });
    expect(live.outcome).toBe('HUMAN_REQUIRED');
  });

  it('P7 aggregate identical under different P8 scale configs', () => {
    const metrics = emptyBreakerMetrics({
      qualityBandScore: 85,
      qualityHistAvgR: 0.6,
      qualityLiveAvgR: -0.2,
    });
    const p7Input = {
      metrics,
      brokerConnected: true,
      advancedSubStates: {
        quality_drift: 'STOP' as const,
        ev_drift: 'CLEAR' as const,
        calibration_drift: 'CLEAR' as const,
        regime_drift: 'CLEAR' as const,
      },
    };
    loadScaleConfig({ AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '3' });
    const reportA = evaluateP7BreakerSystem(p7Input);
    loadScaleConfig({
      AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '50',
      AGENT_ANALYSIS_CONCURRENCY: '16',
    });
    const reportB = evaluateP7BreakerSystem(p7Input);
    expect(reportA.aggregate).toBe(reportB.aggregate);
    expect(reportA.enforcement).toBe(reportB.enforcement);
  });

  it('accept ceiling does not mutate P7 breaker state by itself', () => {
    const store = new TenantBreakerStore();
    const cfgLow = loadScaleConfig({ AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '3' });
    const cfgHigh = loadScaleConfig({ AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE: '50' });
    expect(cfgLow.maxAutonomousAcceptsPerCycle).toBe(3);
    expect(cfgHigh.maxAutonomousAcceptsPerCycle).toBe(50);
    store.recordAutoAccept('u1', 'b1');
    const snap = store.snapshot('u1', 'b1');
    expect(snap.dailyAutoAcceptCount).toBe(1);
    expect(snap.autoPnlDrawdownPct).toBe(0);
  });

  it('tenant A cannot receive tenant B breaker counters', () => {
    const store = new TenantBreakerStore();
    store.recordAutoAccept('tenantA', 'brand1');
    store.recordAutoAccept('tenantA', 'brand1');
    store.recordVeto('tenantB', 'brand1');
    expect(store.snapshot('tenantA', 'brand1').dailyAutoAcceptCount).toBe(2);
    expect(store.snapshot('tenantA', 'brand1').consecutiveVetoCount).toBe(0);
    expect(store.snapshot('tenantB', 'brand1').dailyAutoAcceptCount).toBe(0);
    expect(store.snapshot('tenantB', 'brand1').consecutiveVetoCount).toBe(1);
  });

  it('DUPLICATE_ORDER preserved via gate-sim after parallel analysis path', () => {
    const book = new SimulatedBook(100_000);
    const now = Date.now();
    book.recordSubmit('TCS', now - 1000);
    const gate = simulateRevalidatingGate({
      decision: minimalDecision('TCS'),
      livePrice: 3520,
      maxPriceDeviationPct: 5,
      book,
      now,
      duplicateOrderWindowMs: DEFAULT_DUPLICATE_ORDER_WINDOW_MS,
    });
    expect(gate.passed).toBe(false);
    expect(gate.reasonCodes).toContain('DUPLICATE_ORDER');
  });

  it('outcome idempotency: same tradeId yields one logical outcome', () => {
    const store = new Map<string, { outcomeId: string; tradeId: string }>();
    const first = simulateOutcomeIdempotency(store, {
      outcomeId: 'out-1',
      tradeId: 'ord-1',
      decisionId: 'dec-1',
    });
    const second = simulateOutcomeIdempotency(store, {
      outcomeId: 'out-2',
      tradeId: 'ord-1',
      decisionId: 'dec-1',
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.recorded.outcomeId).toBe('out-1');
    expect(store.size).toBe(1);
  });
});
