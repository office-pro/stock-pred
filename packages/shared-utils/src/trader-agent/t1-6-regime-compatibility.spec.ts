import type { AgentAnalysis } from '@stockpred/shared-types';
import { assessMarketRegime } from './market-regime-engine';
import {
  assessRegimeCompatibility,
  breadthFromPercentAboveEma50,
  buildMarketRegimeDimensions,
  liquidityFromVix,
} from './regime-compatibility-engine';
import { buildIntelligenceSnapshot } from './intelligence-snapshot';
import { evaluateTrade } from './decision-engine';

function baseAnalysis(): AgentAnalysis {
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
      expectedHoldingPeriod: '1-5d',
      confidence: 80,
      invalidation: 'Close below stop',
    },
    marketRegime: 'RISK_ON',
    thesis: 'Breakout with volume',
    counterThesis: 'Market risk-off',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose breakout long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  };
}

describe('T1.6 Market regime compatibility', () => {
  it('derives breadth and liquidity dimensions without collapsing them', () => {
    expect(breadthFromPercentAboveEma50(72)).toBe('STRONG');
    expect(breadthFromPercentAboveEma50(45)).toBe('NORMAL');
    expect(breadthFromPercentAboveEma50(25)).toBe('WEAK');
    expect(liquidityFromVix(12)).toBe('HIGH');
    expect(liquidityFromVix(18)).toBe('NORMAL');
    expect(liquidityFromVix(28)).toBe('LOW');
  });

  it('preserves multidimensional regime context (no RegimeScore)', () => {
    const regime = assessMarketRegime({
      scannerRegime: 'BULL',
      vixLevel: 12,
      niftyChangePercent: 0.6,
      breadthPercentAboveEma50: 68,
      asOf: '2026-08-24T04:00:00.000Z',
    });
    const dims = buildMarketRegimeDimensions({
      regime,
      sectorTrend: 'LEADING',
    });
    expect(dims.trend).toBe('BULL');
    expect(dims.volatility).toBe('LOW_VOL');
    expect(dims.breadth).toBe('STRONG');
    expect(dims.liquidity).toBe('HIGH');
    expect(dims.indexStructure).toBe('BULLISH');
    expect(dims.sectorBreadth).toBe('STRONG');
    expect((dims as { score?: number }).score).toBeUndefined();
  });

  it('marks breakout + bull/strong breadth as FAVORABLE', () => {
    const regime = assessMarketRegime({
      scannerRegime: 'BULL',
      vixLevel: 14,
      niftyChangePercent: 0.5,
      breadthPercentAboveEma50: 70,
    });
    const assessment = assessRegimeCompatibility({
      setupStyle: 'BREAKOUT',
      intendedSide: 'LONG',
      tradeHorizon: 'SWING_TRADE',
      dimensions: buildMarketRegimeDimensions({ regime, sectorTrend: 'LEADING' }),
    });
    expect(assessment.compatibility).toBe('FAVORABLE');
    expect(assessment.dimensionNotes.length).toBeGreaterThanOrEqual(6);
    expect(assessment.conflicts.some((c) => c.code === 'REGIME_UNFAVORABLE')).toBe(false);
  });

  it('marks breakout + bear/weak breadth/high vol as UNFAVORABLE with soft conflicts only', () => {
    const regime = assessMarketRegime({
      scannerRegime: 'BEAR',
      vixLevel: 28,
      niftyChangePercent: -0.8,
      breadthPercentAboveEma50: 28,
    });
    const assessment = assessRegimeCompatibility({
      setupStyle: 'BREAKOUT',
      intendedSide: 'LONG',
      tradeHorizon: 'SWING_TRADE',
      dimensions: buildMarketRegimeDimensions({ regime, sectorTrend: 'LAGGING' }),
    });
    expect(assessment.compatibility).toBe('UNFAVORABLE');
    expect(assessment.conflicts.some((c) => c.code === 'REGIME_UNFAVORABLE')).toBe(true);
    expect(assessment.conflicts.some((c) => c.code === 'HIGH_VOLATILITY')).toBe(true);
    expect(assessment.conflicts.some((c) => c.code === 'WEAK_BREADTH')).toBe(true);
  });

  it('treats high vol as supportive for mean-reversion (setup-aware)', () => {
    const regime = assessMarketRegime({
      scannerRegime: 'NEUTRAL',
      vixLevel: 27,
      niftyChangePercent: -0.2,
      breadthPercentAboveEma50: 48,
    });
    const assessment = assessRegimeCompatibility({
      setupStyle: 'MEAN_REVERSION',
      intendedSide: 'LONG',
      dimensions: buildMarketRegimeDimensions({ regime }),
    });
    const volNote = assessment.dimensionNotes.find((n) => n.dimension === 'VOLATILITY');
    expect(volNote?.stance).toBe('SUPPORTIVE');
  });

  it('attaches regime compatibility onto snapshot without changing eligibility', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const snap = buildIntelligenceSnapshot({
      analysis,
      decision,
      marketContext: {
        scannerRegime: 'BEAR',
        vixLevel: 26,
        niftyChangePercent: -0.7,
        breadthPercentAboveEma50: 30,
      },
    });
    expect(snap.regimeCompatibility?.compatibility).toBe('UNFAVORABLE');
    expect(snap.regimeCompatibility?.dimensions.trend).toBe('BEAR');
    expect(snap.regimeCompatibility?.dimensions.volatility).toBe('HIGH_VOL');
    expect(snap.opportunity?.regimeCompatibility?.compatibility).toBe('UNFAVORABLE');
    const soft = (snap.conflicts ?? []).filter((c) =>
      ['REGIME_UNFAVORABLE', 'HIGH_VOLATILITY', 'WEAK_BREADTH', 'REGIME_CONFLICT'].includes(c.code),
    );
    expect(soft.length).toBeGreaterThan(0);
    expect(soft.every((c) => c.severity === 'INFO' || c.severity === 'WARN')).toBe(true);
    expect(soft.every((c) => c.severity !== 'BLOCK')).toBe(true);
    expect(decision.eligibility).toBe(evaluateTrade({ analysis }).eligibility);
  });
});
