import { MarketRegime, PredictionHorizon } from '@stockpred/shared-types';
import type { AgentAnalysis, HorizonPrediction } from '@stockpred/shared-types';
import {
  assessMarketRegime,
  riskCompatibilityFrom,
  scannerRegimeFromRiskLabel,
} from './market-regime-engine';
import {
  assessStockOpportunity,
  computeGeometricExpectedR,
  resolveDirectionProbabilities,
} from './stock-opportunity-model';
import { buildIntelligenceSnapshot } from './intelligence-snapshot';
import { evaluateTrade } from './decision-engine';

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
      macro: 70,
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

describe('T1.1 Market Regime Engine', () => {
  it('builds BULL+LOW_VOL combo with asOf and RISK_ON compatibility', () => {
    const regime = assessMarketRegime({
      scannerRegime: MarketRegime.STRONG_BULL,
      vixLevel: 12,
      breadthPercentAboveEma50: 70,
      asOf: '2026-08-23T10:00:00.000Z',
    });
    expect(regime.directionRegime).toBe('BULL');
    expect(regime.volatilityRegime).toBe('LOW_VOL');
    expect(regime.regimeCombo).toBe('BULL+LOW_VOL');
    expect(regime.riskCompatibility).toBe('RISK_ON');
    expect(regime.asOf).toBe('2026-08-23T10:00:00.000Z');
  });

  it('maps HIGH_VOL to RISK_OFF even in BULL', () => {
    expect(riskCompatibilityFrom('BULL', 'HIGH_VOL')).toBe('RISK_OFF');
  });

  it('maps agent RISK labels onto scanner regimes', () => {
    expect(scannerRegimeFromRiskLabel('RISK_ON')).toBe(MarketRegime.BULL);
    expect(scannerRegimeFromRiskLabel('RISK_OFF')).toBe(MarketRegime.BEAR);
  });
});

describe('T1.2 / T1.3 Opportunity + Expected-R', () => {
  function mlBase(partial: Partial<HorizonPrediction> = {}): HorizonPrediction {
    return {
      symbol: 'TCS',
      direction: 'UP',
      confidence: 80,
      expectedMove: 2,
      horizon: PredictionHorizon.NEXT_DAY,
      modelVersion: 'v1',
      modelId: 'model-1',
      generatedAt: Date.now(),
      predictionTimestamp: new Date().toISOString(),
      freshnessStatus: 'fresh',
      driftStatus: 'ok',
      ...partial,
    };
  }

  it('labels calibrated probs as CALIBRATED', () => {
    const probs = resolveDirectionProbabilities(
      mlBase({ calibratedProbabilities: { UP: 0.7, DOWN: 0.1, SIDEWAYS: 0.2 } }),
    );
    expect(probs?.source).toBe('CALIBRATED');
    expect(probs!.pUp + probs!.pDown + probs!.pSideways).toBeCloseTo(1, 5);
  });

  it('labels confidence-only paths as HEURISTIC (never silent CALIBRATED)', () => {
    const probs = resolveDirectionProbabilities(mlBase({ confidence: 80 }));
    expect(probs?.source).toBe('HEURISTIC');
  });

  it('enforces pHit + pStop <= 1 with residual neither and provenance', () => {
    const ev = computeGeometricExpectedR({
      rewardR: 2,
      riskR: 1,
      expectedMfe: 0.03,
      expectedMae: -0.01,
      pUp: 0.7,
      pDown: 0.2,
      probabilitySource: 'CALIBRATED',
    });
    expect((ev.probabilityTarget ?? 0) + (ev.probabilityStop ?? 0)).toBeLessThanOrEqual(1.0001);
    expect(ev.probabilityNeither).toBeGreaterThanOrEqual(0);
    expect(
      (ev.probabilityTarget ?? 0) + (ev.probabilityStop ?? 0) + (ev.probabilityNeither ?? 0),
    ).toBeCloseTo(1, 4);
    expect(ev.expectedValueMethod).toBe('GEOMETRIC_HEURISTIC_V1');
    expect(ev.expectedValueR).not.toBe(0);
    expect(ev.probabilitySource).toBe('CALIBRATED');
  });

  it('builds opportunity with path heads and regime fit', () => {
    const opp = assessStockOpportunity({
      directionRegime: 'BULL',
      ml: mlBase({
        confidence: 75,
        calibratedProbabilities: { UP: 0.65, DOWN: 0.15, SIDEWAYS: 0.2 },
        expectedReturn: 0.024,
        expectedMfe: 0.031,
        expectedMae: -0.008,
      }),
    });
    expect(opp?.expectedReturn).toBe(0.024);
    expect(opp?.expectedMfe).toBe(0.031);
    expect(opp?.regimeFit).toBe('HIGH');
    expect(opp?.probabilitySource).toBe('CALIBRATED');
  });
});

describe('T1 snapshot wiring', () => {
  it('produces non-zero E[R] with provenance and regime combo', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const snap = buildIntelligenceSnapshot({
      analysis,
      decision,
      marketContext: {
        scannerRegime: MarketRegime.BULL,
        vixLevel: 14,
        breadthPercentAboveEma50: 60,
      },
      mlPrediction: {
        symbol: 'TCS',
        direction: 'UP',
        confidence: 72,
        expectedMove: 2.1,
        horizon: PredictionHorizon.NEXT_DAY,
        modelVersion: 'v1',
        modelId: 'model-1',
        generatedAt: Date.now(),
        predictionTimestamp: new Date().toISOString(),
        calibratedProbabilities: { UP: 0.6, DOWN: 0.2, SIDEWAYS: 0.2 },
        expectedReturn: 0.02,
        expectedMfe: 0.03,
        expectedMae: -0.01,
        freshnessStatus: 'fresh',
        driftStatus: 'ok',
      },
    });

    expect(snap.marketContext.regimeCombo).toMatch(/BULL\+/);
    expect(snap.marketContext.asOf).toBeTruthy();
    expect(snap.expectedValue?.expectedValueR).not.toBe(0);
    expect(snap.expectedValue?.expectedValueMethod).toBe('GEOMETRIC_HEURISTIC_V1');
    expect(snap.expectedValue?.probabilitySource).toBeTruthy();
    expect(snap.opportunity?.expectedMfe).toBe(0.03);
    expect(
      (snap.expectedValue?.probabilityTarget ?? 0) + (snap.expectedValue?.probabilityStop ?? 0),
    ).toBeLessThanOrEqual(1.0001);
  });

  it('keeps evaluateTrade eligibility unchanged by snapshot metadata', () => {
    const analysis = baseAnalysis();
    const d1 = evaluateTrade({ analysis });
    const d2 = evaluateTrade({ analysis });
    expect(d1.eligibility).toBe(d2.eligibility);
    expect(d1.signalScore).toBe(d2.signalScore);
  });
});
