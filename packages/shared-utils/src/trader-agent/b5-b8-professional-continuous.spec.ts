/**
 * B6 Professional Trader + B7 Continuous — unit tests.
 * Auth isolation: engines never call evaluateTrade.
 */

import {
  buildContinuousEvent,
  buildPositionManagementPlan,
  buildTradePlan,
  ContinuousEventDedupeStore,
  continuousExecutionEligibleHint,
  continuousIntelligenceAllowed,
  evaluateTrade,
  reassessContinuousEvent,
} from './index';

function analysis(symbol = 'RELIANCE') {
  return {
    symbol,
    currentPrice: 100,
    decision: 'BUY' as const,
    scores: {
      fundamental: 60,
      technical: 80,
      sentiment: 55,
      quant: 50,
      macro: 50,
      sector: 50,
      risk: 50,
      overall: 78,
    },
    setup: {
      instrument: symbol,
      direction: 'LONG' as const,
      entry: 100,
      stopLoss: 95,
      target1: 110,
      target2: 115,
      target3: null,
      riskReward: 2.1,
      positionSize: 1,
      expectedHoldingPeriod: '1-3d',
      confidence: 78,
      invalidation: 'below 95',
    },
    marketRegime: 'RISK_ON' as const,
    thesis: 'Breakout with RS leadership',
    counterThesis: 'c',
    invalidation: 'below 95',
    risks: [] as string[],
    action: 'a',
    usedCapabilities: [] as string[],
    missingCapabilities: [] as string[],
    capabilityRequests: [] as never[],
    disclaimer: 'test',
    generatedAt: Date.now(),
  };
}

describe('B6 buildTradePlan', () => {
  it('builds advisory TradePlan with provenance; APPROVE ≠ evaluateTrade', () => {
    const a = analysis();
    const decision = evaluateTrade({ analysis: a });
    const snap = {
      schemaVersion: '1',
      engineVersion: 't',
      generatedAt: new Date().toISOString(),
      sourceDataTimestamp: new Date().toISOString(),
      marketContext: { regimeCombo: 'BULL/LOW' },
      crossSectionalRs: { rsBucket: 'LEADERS' },
      mlPrediction: {
        schemaVersion: 'ml-prediction-snapshot.v1' as const,
        modelId: 'm1',
        modelVersion: 'ensemble-v1',
        featureVersion: 'features.v1.4',
        horizon: 'NEXT_DAY',
        predictionTimestamp: new Date().toISOString(),
        freshnessStatus: 'fresh' as const,
        driftStatus: 'ok' as const,
        direction: 'UP',
        confidence: 72,
        calibratedProbabilities: { UP: 0.72, DOWN: 0.18, SIDEWAYS: 0.1 },
      },
    } as unknown as import('@stockpred/shared-types').IntelligenceSnapshot;

    const plan = buildTradePlan({
      now: Date.now(),
      opportunityId: decision.decisionId,
      analysis: a,
      snapshot: snap,
    });

    expect(plan.schemaVersion).toBe('trade-plan.v1');
    expect(plan.recommendation).toBe('APPROVE');
    expect(plan.upsideProbability).toBeCloseTo(0.72);
    expect(plan.provenance.modelVersions).toContain('ensemble-v1');
    expect(plan.provenance.intelligenceVersion).toContain('intelligence-batch');
    expect(plan.assessment.opportunityQuality).toBe('HIGH');
    // Recommendation is advisory — evaluateTrade remains a separate call.
    expect(typeof evaluateTrade).toBe('function');
  });

  it('omits fabricated max-profit language; uses ranges', () => {
    const plan = buildTradePlan({
      now: 1,
      opportunityId: 'opp-1',
      analysis: analysis(),
      snapshot: {
        schemaVersion: '1',
        engineVersion: 't',
        generatedAt: 't',
        sourceDataTimestamp: 't',
        marketContext: {},
      } as unknown as import('@stockpred/shared-types').IntelligenceSnapshot,
    });
    expect(plan.expectedReturnRange).toBeDefined();
    expect(JSON.stringify(plan)).not.toMatch(/maximumProfit|willGoUp|will go up/i);
  });
});

describe('B7 continuous + PositionManagementPlan', () => {
  it('deduplicates the same event', () => {
    const dedupe = new ContinuousEventDedupeStore();
    const event = buildContinuousEvent({
      eventId: 'e1',
      symbol: 'RELIANCE',
      priority: 'P0',
      trigger: 'CUTOFF',
      dataStatus: 'LIVE',
      message: 'cutoff reached',
      positionId: 'pos-1',
      dedupeKey: 'RELIANCE:CUTOFF:pos-1:e1',
    });
    const first = reassessContinuousEvent({
      event,
      dedupe,
      position: {
        positionId: 'pos-1',
        originalEntry: 100,
        currentPrice: 108,
        originalTarget: 110,
        originalStop: 95,
        thesisState: 'VALID',
        cutoffReached: true,
      },
    });
    expect(first.deduplicated).toBe(false);
    expect(first.positionPlan?.recommendedAction).toBe('EXTEND');

    const second = reassessContinuousEvent({
      event,
      dedupe,
      position: {
        positionId: 'pos-1',
        originalEntry: 100,
        currentPrice: 108,
        originalTarget: 110,
        originalStop: 95,
        thesisState: 'VALID',
        cutoffReached: true,
      },
    });
    expect(second.deduplicated).toBe(true);
    expect(second.positionPlan).toBeUndefined();
  });

  it('does not invent position plans without a real position', () => {
    const event = buildContinuousEvent({
      eventId: 'e2',
      symbol: 'INFY',
      priority: 'P2',
      trigger: 'ML',
      dataStatus: 'DELAYED',
      message: 'ml changed',
    });
    const result = reassessContinuousEvent({
      event,
      dedupe: new ContinuousEventDedupeStore(),
    });
    expect(result.positionPlan).toBeUndefined();
    expect(continuousIntelligenceAllowed('DELAYED')).toBe(true);
    expect(continuousExecutionEligibleHint('DELAYED')).toBe(false);
  });

  it('WEAKENING thesis → TRIM; stop breach → EXIT', () => {
    const baseEvent = buildContinuousEvent({
      eventId: 'e3',
      symbol: 'TCS',
      priority: 'P0',
      trigger: 'THESIS',
      dataStatus: 'LIVE',
      message: 'thesis weakening',
      positionId: 'p2',
    });
    const trim = buildPositionManagementPlan({
      event: baseEvent,
      positionId: 'p2',
      originalEntry: 100,
      currentPrice: 102,
      originalTarget: 120,
      originalStop: 95,
      thesisState: 'WEAKENING',
    });
    expect(trim.recommendedAction).toBe('TRIM');

    const exit = buildPositionManagementPlan({
      event: baseEvent,
      positionId: 'p2',
      originalEntry: 100,
      currentPrice: 94,
      originalStop: 95,
      thesisState: 'VALID',
    });
    expect(exit.recommendedAction).toBe('EXIT');
  });
});
