import type { AgentAnalysis } from '@stockpred/shared-types';
import {
  assessCrossSectionalRs,
  assessSectorIntelligence,
  rsBucketFromRatio,
  valuationVsPeersFromPct,
} from './cross-sectional-rs-engine';
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

describe('T1.4 Cross-sectional RS + sector intelligence', () => {
  it('buckets RS vs Nifty thresholds', () => {
    expect(rsBucketFromRatio(1.08)).toBe('LEADERS');
    expect(rsBucketFromRatio(1.0)).toBe('MIDDLE');
    expect(rsBucketFromRatio(0.9)).toBe('LAGGARDS');
    expect(rsBucketFromRatio(null)).toBe('UNKNOWN');
  });

  it('labels valuation vs peers', () => {
    expect(valuationVsPeersFromPct(-12)).toBe('CHEAP');
    expect(valuationVsPeersFromPct(0)).toBe('FAIR');
    expect(valuationVsPeersFromPct(20)).toBe('RICH');
  });

  it('computes percentile when peers provided', () => {
    const rs = assessCrossSectionalRs({
      rsVsNifty50: 1.1,
      peerRsValues: [0.9, 0.95, 1.0, 1.05, 1.2],
      asOf: '2026-08-23T10:00:00.000Z',
    });
    expect(rs.rsBucket).toBe('LEADERS');
    expect(rs.rsPercentile).toBeGreaterThan(50);
    expect(rs.source).toMatch(/MIXED|PEER/);
  });

  it('builds sector intelligence fit', () => {
    const sector = assessSectorIntelligence({
      sector: 'IT',
      sectorMedianRs: 1.04,
      stockRsVsNifty50: 1.08,
      peVsMedianPct: -5,
      rsBucket: 'LEADERS',
    });
    expect(sector.sectorTrend).toBe('LEADING');
    expect(sector.valuationVsPeers).toBe('FAIR');
    expect(sector.sectorFit).toBe('HIGH');
  });

  it('attaches RS/sector onto intelligence snapshot without changing eligibility', () => {
    const analysis = baseAnalysis();
    const decision = evaluateTrade({ analysis });
    const snap = buildIntelligenceSnapshot({
      analysis,
      decision,
      crossSectional: {
        rsVsNifty50: 1.1,
        peerRsValues: [0.9, 1.0, 1.05, 1.1, 1.2],
        sector: 'IT',
        sectorMedianRs: 1.04,
        peVsMedianPct: -8,
      },
    });
    expect(snap.crossSectionalRs?.rsBucket).toBe('LEADERS');
    expect(snap.sectorIntelligence?.sector).toBe('IT');
    expect(snap.marketContext.sectorTrend).toBe('LEADING');
    expect(snap.tradeQuality?.relativeStrength).toBeGreaterThan(0);
    expect(decision.eligibility).toBe(evaluateTrade({ analysis }).eligibility);
  });
});
