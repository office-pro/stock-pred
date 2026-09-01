import type {
  AgentAnalysis,
  HorizonBiasAssessment,
  MultiHorizonConflict,
} from '@stockpred/shared-types';
import {
  assessMultiHorizonAgreement,
  biasFromCloses,
  horizonPlan,
  inferTradeHorizon,
} from './multi-horizon-agreement-engine';
import { buildIntelligenceSnapshot } from './intelligence-snapshot';
import { evaluateTrade } from './decision-engine';

function rising(n: number, start = 100): number[] {
  return Array.from({ length: n }, (_, i) => start + i * 0.5);
}

function falling(n: number, start = 100): number[] {
  return Array.from({ length: n }, (_, i) => start - i * 0.5);
}

function flat(n: number, start = 100): number[] {
  return Array.from({ length: n }, () => start);
}

function baseAnalysis(holding = '1-5d'): AgentAnalysis {
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
      expectedHoldingPeriod: holding,
      confidence: 80,
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
  };
}

describe('T1.5 Multi-horizon agreement', () => {
  it('infers trade horizon from holding period', () => {
    expect(inferTradeHorizon('intraday')).toBe('DAY_TRADE');
    expect(inferTradeHorizon('1-5d')).toBe('SWING_TRADE');
    expect(inferTradeHorizon('weeks')).toBe('POSITION');
  });

  it('derives bias from closes without collapsing horizons', () => {
    expect(biasFromCloses(rising(20)).bias).toBe('BULLISH');
    expect(biasFromCloses(falling(20)).bias).toBe('BEARISH');
    expect(biasFromCloses(flat(20)).bias).toBe('NEUTRAL');
    expect(biasFromCloses([100]).bias).toBe('UNKNOWN');
  });

  it('preserves per-horizon assessments and grades agreement by primary only', () => {
    const assessment = assessMultiHorizonAgreement({
      tradeHorizon: 'SWING_TRADE',
      intendedSide: 'LONG',
      closesByHorizon: {
        M15: rising(20),
        H1: rising(20),
        H4: rising(20),
        D1: rising(40),
        W1: flat(12),
      },
      asOf: '2026-08-23T10:00:00.000Z',
    });
    expect(assessment.horizons.length).toBe(horizonPlan('SWING_TRADE').length);
    expect(
      assessment.horizons.every((h: HorizonBiasAssessment) => h.horizon && h.bias && h.role),
    ).toBe(true);
    expect(assessment.agreement).toBe('HIGH');
    expect(assessment.higherTimeframeAlignment).toMatch(/MED|HIGH/);
    expect(
      assessment.conflicts.some((c: MultiHorizonConflict) => c.code === 'HTF_NOT_CONFIRMED'),
    ).toBe(true);
    expect(assessment.provenance.engineVersion).toContain('multi-horizon');
    expect(assessment.provenance.inputs?.tradeHorizon).toBe('SWING_TRADE');
  });

  it('day-trade tolerates higher-TF weakness without requiring full-stack agreement', () => {
    const day = assessMultiHorizonAgreement({
      tradeHorizon: 'DAY_TRADE',
      intendedSide: 'LONG',
      closesByHorizon: {
        M5: rising(30),
        M15: rising(30),
        H1: rising(30),
        D1: falling(40),
        W1: falling(12),
      },
    });
    expect(day.agreement).toBe('HIGH');
    expect(day.conflicts.some((c: MultiHorizonConflict) => c.code === 'HTF_OPPOSES')).toBe(true);

    const swing = assessMultiHorizonAgreement({
      tradeHorizon: 'SWING_TRADE',
      intendedSide: 'LONG',
      closesByHorizon: {
        H1: rising(20),
        H4: falling(20),
        D1: falling(40),
        W1: falling(12),
      },
    });
    expect(swing.agreement).toMatch(/LOW|MED/);
    expect(
      swing.conflicts.some((c: MultiHorizonConflict) => c.code === 'HORIZON_PRIMARY_DISAGREE'),
    ).toBe(true);
  });

  it('attaches multi-horizon onto snapshot as soft conflicts only', () => {
    const analysis = baseAnalysis('1-5d');
    const decision = evaluateTrade({ analysis });
    const snap = buildIntelligenceSnapshot({
      analysis,
      decision,
      multiHorizon: {
        tradeHorizon: 'SWING_TRADE',
        intendedSide: 'LONG',
        closesByHorizon: {
          H1: rising(20),
          H4: rising(20),
          D1: rising(40),
          W1: flat(12),
        },
      },
    });
    expect(snap.multiHorizonAgreement?.agreement).toBe('HIGH');
    expect(snap.multiHorizonAgreement?.horizons.length).toBeGreaterThan(0);
    expect(snap.opportunity?.multiHorizonAgreement?.tradeHorizon).toBe('SWING_TRADE');
    const soft = (snap.conflicts ?? []).filter((c) =>
      ['HTF_NOT_CONFIRMED', 'HORIZON_PRIMARY_DISAGREE', 'HORIZON_AGREEMENT_LOW'].includes(c.code),
    );
    expect(soft.every((c) => c.severity === 'INFO' || c.severity === 'WARN')).toBe(true);
    expect(soft.every((c) => c.severity !== 'BLOCK')).toBe(true);
    expect(decision.eligibility).toBe(evaluateTrade({ analysis }).eligibility);
  });
});
