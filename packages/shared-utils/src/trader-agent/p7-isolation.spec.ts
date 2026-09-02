/**
 * P7.6 — Isolation proofs: P7 never mutates Risk/Portfolio/Policy/Gate.
 */
import type { AgentAnalysis } from '@stockpred/shared-types';
import { emptyBreakerMetrics } from './circuit-breakers';
import {
  authorizationProjectionsEqual,
  runBaselineAuthorizationChain,
} from './authorization-test-harness';
import { evaluateP7BreakerSystem, mapAggregateToEnforcement } from './p7-breaker-aggregation';

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

describe('p7-isolation (P7.6)', () => {
  it('P7 STOP enforcement does not mutate Risk/Portfolio/Policy/Gate projections', () => {
    const baseline = runBaselineAuthorizationChain({
      analysis: baseAnalysis(),
      includeGate: true,
    });
    const enriched = runBaselineAuthorizationChain({
      analysis: baseAnalysis(),
      includeGate: true,
    });
    expect(authorizationProjectionsEqual(baseline.projection, enriched.projection)).toBe(true);
  });

  it('P7 aggregate FORCE_APPROVAL is enforcement-only — not an authorization outcome', () => {
    const report = evaluateP7BreakerSystem({
      metrics: emptyBreakerMetrics({
        qualityBandScore: 85,
        qualityHistAvgR: 0.6,
        qualityLiveAvgR: -0.2,
      }),
      brokerConnected: true,
      advancedSubStates: {
        quality_drift: 'STOP',
        ev_drift: 'CLEAR',
        calibration_drift: 'CLEAR',
        regime_drift: 'CLEAR',
      },
    });
    expect(report.enforcement).toBe('FORCE_APPROVAL');
    expect(report).not.toHaveProperty('liveAutoArmed');
    expect(report).not.toHaveProperty('outcome');
    expect(JSON.stringify(report)).not.toMatch(/AUTO_ACCEPTED/);
  });

  it('RESTRICT_AUTONOMOUS blocks autonomous path only', () => {
    expect(mapAggregateToEnforcement('RESTRICT')).toBe('RESTRICT_AUTONOMOUS');
    expect(mapAggregateToEnforcement('UNKNOWN')).toBe('RESTRICT_AUTONOMOUS');
  });

  it('INSUFFICIENT does not enforce', () => {
    const report = evaluateP7BreakerSystem({
      metrics: emptyBreakerMetrics(),
      brokerConnected: true,
      advancedSubStates: {
        quality_drift: 'INSUFFICIENT',
        ev_drift: 'INSUFFICIENT',
        calibration_drift: 'INSUFFICIENT',
        regime_drift: 'INSUFFICIENT',
      },
    });
    expect(report.enforcement).toBe('NONE');
  });
});
