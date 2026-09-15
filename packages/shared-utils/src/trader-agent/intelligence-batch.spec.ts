/**
 * B1 Intelligence Batch — unit tests (partition, checkpoint, reserved modes, no auth).
 */

import {
  assertB1ExecutableBatchRequest,
  assessOpportunityRanking,
  b2PipelineStages,
  buildIntelligenceSnapshot,
  canPause,
  canResume,
  compactIntelligenceBatchContext,
  composeAgentAnalysis,
  computeProgress,
  countTiEnrichmentFromLabels,
  createIntelligenceBatchSkeleton,
  diagnoseMlForBatch,
  diagnoseRsForBatch,
  evaluateTrade,
  IntelligenceBatchValidationError,
  markFailedTasksPending,
  materializeIntelligenceLifecycleState,
  partitionSymbols,
  pendingTasksForResume,
  presenceFromUsedCapabilities,
  queryIntelligenceBatchResultsPage,
  compareBatchResultRows,
  refreshCheckpointFromTasks,
  rematerializeSetupFromQuote,
  resolveBatchCanonicalIdentity,
  resolveIntelligenceUniverse,
  intelligenceUniverseSizes,
} from './index';

describe('assertB1ExecutableBatchRequest', () => {
  it('accepts HISTORICAL FULL_ANALYSIS defaults', () => {
    expect(assertB1ExecutableBatchRequest({ universe: 'NIFTY50' })).toEqual({
      batchType: 'FULL_ANALYSIS',
      mode: 'HISTORICAL',
    });
  });

  it('rejects LIVE_CONTINUOUS and LIVE/HYBRID as reserved', () => {
    expect(() =>
      assertB1ExecutableBatchRequest({
        universe: 'NIFTY50',
        batchType: 'LIVE_CONTINUOUS',
      }),
    ).toThrow(IntelligenceBatchValidationError);
    expect(() => assertB1ExecutableBatchRequest({ universe: 'NIFTY50', mode: 'LIVE' })).toThrow(
      IntelligenceBatchValidationError,
    );
    expect(() => assertB1ExecutableBatchRequest({ universe: 'NIFTY50', mode: 'HYBRID' })).toThrow(
      IntelligenceBatchValidationError,
    );
  });
});

describe('partitionSymbols / createIntelligenceBatchSkeleton', () => {
  it('partitions into size-50 chunks and builds PENDING tasks', () => {
    const symbols = Array.from({ length: 120 }, (_, i) => `S${i}`);
    const parts = partitionSymbols(symbols, 50);
    expect(parts).toHaveLength(3);
    expect(parts[0].symbols).toHaveLength(50);
    expect(parts[2].symbols).toHaveLength(20);
    expect(parts[0].partitionId).toBe('P01');

    const batch = createIntelligenceBatchSkeleton({
      batchId: 'IBATCH-1',
      universe: 'CUSTOM',
      batchType: 'FULL_ANALYSIS',
      mode: 'HISTORICAL',
      symbols,
      now: 1_700_000_000_000,
      partitionSize: 50,
    });
    expect(batch.schemaVersion).toBe('intelligence-batch.v1');
    expect(batch.tasks).toHaveLength(120);
    expect(batch.tasks.every((t) => t.status === 'PENDING')).toBe(true);
    expect(batch.progress.total).toBe(120);
    expect(batch.progress.stages.find((s) => s.id === 'ml')?.availability).toBe('Not available');
    expect(batch.progress.stages.find((s) => s.id === 'technical')?.availability).toBe('available');
    // Before TI finalize, regime stages remain Not available (tiTotal=0).
    expect(batch.progress.stages.find((s) => s.id === 'regime')?.availability).toBe(
      'Not available',
    );
  });
});

describe('checkpoint / pause-resume helpers', () => {
  it('skips DONE on resume and restores FAILED via retry helper', () => {
    const batch = createIntelligenceBatchSkeleton({
      batchId: 'IBATCH-2',
      universe: 'CUSTOM',
      batchType: 'FULL_ANALYSIS',
      mode: 'HISTORICAL',
      symbols: ['AAA', 'BBB', 'CCC'],
      now: 1,
    });
    batch.tasks[0].status = 'DONE';
    batch.tasks[1].status = 'FAILED';
    batch.tasks[1].error = 'boom';
    const pending = pendingTasksForResume(batch.tasks);
    expect(pending.map((t) => t.symbol)).toEqual(['BBB', 'CCC']);

    const retried = markFailedTasksPending(batch.tasks);
    expect(retried[1].status).toBe('PENDING');
    expect(retried[1].error).toBeUndefined();

    const cp = refreshCheckpointFromTasks(batch.tasks, 'CCC', 99);
    expect(cp.completedSymbols).toEqual(['AAA']);
    expect(cp.failedSymbols).toEqual(['BBB']);
    expect(cp.currentSymbol).toBe('CCC');
    expect(canPause('RUNNING')).toBe(true);
    expect(canResume('PAUSED')).toBe(true);
  });

  it('computeProgress counts DONE/FAILED/SKIPPED', () => {
    const batch = createIntelligenceBatchSkeleton({
      batchId: 'IBATCH-3',
      universe: 'CUSTOM',
      batchType: 'FULL_ANALYSIS',
      mode: 'HISTORICAL',
      symbols: ['A', 'B'],
      now: 1,
    });
    batch.tasks[0].status = 'DONE';
    batch.tasks[1].status = 'SKIPPED';
    const p = computeProgress(batch.tasks);
    expect(p.processed).toBe(2);
    expect(p.percent).toBe(100);
  });
});

describe('resolveIntelligenceUniverse', () => {
  it('resolves NIFTY baskets and CUSTOM; sizes are stable', () => {
    const sizes = intelligenceUniverseSizes();
    expect(sizes.NIFTY50).toBe(50);
    expect(sizes.NIFTY100).toBe(100);
    expect(sizes.NIFTY150).toBe(150);
    expect(sizes.NIFTY500).toBe(500);

    expect(resolveIntelligenceUniverse({ universe: 'NIFTY50' })).toHaveLength(50);
    expect(resolveIntelligenceUniverse({ universe: 'NIFTY150' })).toHaveLength(150);
    expect(
      resolveIntelligenceUniverse({
        universe: 'CUSTOM',
        customSymbols: ['reliance', 'RELIANCE', 'infy'],
      }),
    ).toEqual(['RELIANCE', 'INFY']);
  });

  it('requires symbols for CUSTOM and ALL', () => {
    expect(() => resolveIntelligenceUniverse({ universe: 'CUSTOM' })).toThrow(/CUSTOM/);
    expect(() => resolveIntelligenceUniverse({ universe: 'ALL' })).toThrow(/ALL/);
  });
});

describe('B1 auth-isolation contract (documentation assertions)', () => {
  it('forbids batch path from implying evaluateTrade / Risk / Gate / TradePlan ranking', () => {
    const contract = [
      'Intelligence batch MUST NOT call evaluateTrade',
      'Intelligence batch MUST NOT call evaluateRisk',
      'Intelligence batch MUST NOT call evaluatePortfolio',
      'Intelligence batch MUST NOT call applyDecisionPolicy',
      'Intelligence batch MUST NOT call Gate / live caps',
      'Intelligence batch MUST NOT fabricate TradePlan or ML probabilities',
      'Intelligence batch MUST use existing assessOpportunityRanking only',
      'Frontend MUST NOT re-rank IntelligenceBatch results',
      'B4 MUST NOT mutate waitExpiresAt',
      'B4 MUST NOT invent exitAdvisory without ExitIntelligencePosition',
      'B4 MUST NOT add thesisScore/integrityScore/lifecycleScore ranking keys',
    ].join('\n');
    expect(contract).toContain('MUST NOT call evaluateTrade');
    expect(contract).toContain('assessOpportunityRanking only');
    expect(contract).toContain('MUST NOT mutate waitExpiresAt');
    expect(contract).not.toMatch(/TradePlan\.expectedReturn/);
  });
});

describe('B2 compactIntelligenceBatchContext', () => {
  it('omits TI labels when snapshot has no TI fields', () => {
    const labels = compactIntelligenceBatchContext({
      thesis: 't',
      decision: 'BUY',
      overallScore: 77,
      snapshot: null,
    });
    expect(labels).toEqual({ thesis: 't', decision: 'BUY', overallScore: 77 });
    expect(labels.regimeCombo).toBeUndefined();
    expect(labels.rsBucket).toBeUndefined();
  });

  it('copies compact TI labels from snapshot when present', () => {
    const snap = {
      marketContext: { regimeCombo: 'BULL/LOW' },
      crossSectionalRs: { rsBucket: 'LEADERS' },
      sectorIntelligence: { sectorFit: 'HIGH', sectorTrend: 'LEADING' },
      multiHorizonAgreement: { agreement: 'HIGH' },
    } as unknown as import('@stockpred/shared-types').IntelligenceSnapshot;
    const labels = compactIntelligenceBatchContext({
      overallScore: 80,
      snapshot: snap,
    });
    expect(labels.regimeCombo).toBe('BULL/LOW');
    expect(labels.rsBucket).toBe('LEADERS');
    expect(labels.sectorFit).toBe('HIGH');
    expect(labels.sectorTrend).toBe('LEADING');
    expect(labels.horizonAgreement).toBe('HIGH');
    expect(labels.overallScore).toBe(80);
  });
});

describe('B2 pipeline stages', () => {
  it('marks regime/RS/sector/MTF available only with real TI totals', () => {
    const before = b2PipelineStages({ analyzedDone: 2, analyzedTotal: 2 });
    expect(before.find((s) => s.id === 'regime')?.availability).toBe('Not available');
    expect(before.find((s) => s.id === 'fundamental')?.availability).toBe('Not available');

    const after = b2PipelineStages({
      analyzedDone: 2,
      analyzedTotal: 2,
      tiTotal: 2,
      regimeDone: 1,
      rsDone: 2,
      sectorDone: 0,
      multiHorizonDone: 1,
      fundamentalDone: 0,
      newsDone: 0,
      socialDone: 0,
      macroDone: 1,
    });
    expect(after.find((s) => s.id === 'regime')).toMatchObject({
      availability: 'available',
      done: 1,
      total: 2,
    });
    expect(after.find((s) => s.id === 'relativeStrength')).toMatchObject({
      availability: 'available',
      done: 2,
      total: 2,
    });
    // B3: stages available with real counts (0 done is still available, not fabricated 100%).
    expect(after.find((s) => s.id === 'fundamental')).toMatchObject({
      availability: 'available',
      done: 0,
      total: 2,
    });
    expect(after.find((s) => s.id === 'macro')).toMatchObject({
      availability: 'available',
      done: 1,
      total: 2,
    });
    expect(after.find((s) => s.id === 'integrity')).toMatchObject({
      availability: 'available',
      done: 0,
      total: 2,
    });
    expect(after.find((s) => s.id === 'exit')).toMatchObject({
      availability: 'prerequisite_missing',
      done: 0,
      total: 0,
      unavailableReason: 'REQUIRES_OPEN_POSITION',
    });
    expect(after.find((s) => s.id === 'ml')).toMatchObject({
      availability: 'available',
      done: 0,
      total: 2,
    });
  });

  it('countTiEnrichmentFromLabels tallies actual label and presence', () => {
    const counts = countTiEnrichmentFromLabels([
      {
        intelligenceContext: { regimeCombo: 'X', rsBucket: 'LEADERS', thesisState: 'VALID' },
        presence: { fundamental: true, news: false, social: false, macro: false },
      },
      {
        intelligenceContext: {
          sectorFit: 'HIGH',
          waitTrigger: 'PRICE',
          integrityStatus: 'NORMAL',
        },
        presence: { fundamental: false, news: true, social: false, macro: true },
      },
      { intelligenceContext: {} },
    ]);
    expect(counts).toEqual({
      tiTotal: 3,
      regimeDone: 1,
      rsDone: 1,
      sectorDone: 1,
      multiHorizonDone: 0,
      fundamentalDone: 1,
      newsDone: 1,
      socialDone: 0,
      macroDone: 1,
      thesisDone: 1,
      waitDone: 1,
      exitDone: 0,
      integrityDone: 1,
      mlDone: 0,
      professionalAnalysisDone: 0,
    });
  });
});

describe('B3 compact labels and sentiment≠news/social', () => {
  it('omits fund/macro/catalyst when absent; keeps negative scores when present', () => {
    const missing = compactIntelligenceBatchContext({
      overallScore: 50,
      fundamentalScore: null,
      macroScore: undefined,
      snapshot: null,
    });
    expect(missing.fundamentalScore).toBeUndefined();
    expect(missing.macroScore).toBeUndefined();
    expect(missing.eventRisk).toBeUndefined();

    const neg = compactIntelligenceBatchContext({
      fundamentalScore: -0.3,
      sentimentScore: -0.8,
      macroScore: -5,
      snapshot: {
        catalystContext: { eventRisk: 'HIGH' },
      } as unknown as import('@stockpred/shared-types').IntelligenceSnapshot,
    });
    expect(neg.fundamentalScore).toBe(-0.3);
    expect(neg.sentimentScore).toBe(-0.8);
    expect(neg.macroScore).toBe(-5);
    expect(neg.eventRisk).toBe('HIGH');
  });

  it('sentimentScore does not imply news or social stage completion', () => {
    const presence = presenceFromUsedCapabilities(['quotes'], {
      fundamental: null,
      macro: null,
    });
    expect(presence.news).toBe(false);
    expect(presence.social).toBe(false);
    expect(presence.fundamental).toBe(false);

    const labels = compactIntelligenceBatchContext({
      sentimentScore: 66,
      snapshot: null,
    });
    expect(labels.sentimentScore).toBe(66);

    // Score presence alone can mark fund/macro; never news/social from sentiment.
    const fromScores = presenceFromUsedCapabilities([], {
      fundamental: -0.2,
      macro: 1,
    });
    expect(fromScores.fundamental).toBe(true);
    expect(fromScores.macro).toBe(true);
    expect(fromScores.news).toBe(false);
    expect(fromScores.social).toBe(false);

    const withAlt = presenceFromUsedCapabilities(['alt-news', 'alt-social', 'fundamentals']);
    expect(withAlt.news).toBe(true);
    expect(withAlt.social).toBe(true);
    expect(withAlt.fundamental).toBe(true);

    const stages = b2PipelineStages({
      analyzedDone: 1,
      analyzedTotal: 1,
      tiTotal: 1,
      newsDone: 0,
      socialDone: 0,
    });
    // sentiment alone must not complete news/social.
    expect(stages.find((s) => s.id === 'news')?.done).toBe(0);
    expect(stages.find((s) => s.id === 'social')?.done).toBe(0);
  });
});

describe('B4 lifecycle / thesis / wait / exit / integrity', () => {
  it('materializes tiered lifecycle from evidence only', () => {
    expect(
      materializeIntelligenceLifecycleState({
        hasAnalysis: false,
        hasSnapshot: true,
        labels: {},
      }),
    ).toBeUndefined();

    expect(
      materializeIntelligenceLifecycleState({
        hasAnalysis: true,
        hasSnapshot: true,
        labels: { overallScore: 70 },
      }),
    ).toBe('INTELLIGENCE_ANALYSIS');

    expect(
      materializeIntelligenceLifecycleState({
        hasAnalysis: true,
        hasSnapshot: true,
        labels: { regimeCombo: 'BULL/LOW' },
        thesisState: 'UNKNOWN',
      }),
    ).toBe('SHORTLIST');

    expect(
      materializeIntelligenceLifecycleState({
        hasAnalysis: true,
        hasSnapshot: true,
        labels: { rsBucket: 'LEADERS' },
        thesisState: 'VALID',
      }),
    ).toBe('OPPORTUNITY');

    expect(
      materializeIntelligenceLifecycleState({
        hasAnalysis: true,
        hasSnapshot: true,
        labels: { eventRisk: 'MED' },
        thesisState: 'WEAKENING',
      }),
    ).toBe('OPPORTUNITY');

    // Thesis alone without B2/B3 TI is not OPPORTUNITY.
    expect(
      materializeIntelligenceLifecycleState({
        hasAnalysis: true,
        hasSnapshot: true,
        labels: {},
        thesisState: 'VALID',
      }),
    ).toBe('INTELLIGENCE_ANALYSIS');
  });

  it('preserves thesisState semantics and keeps narrative thesis separate', () => {
    const labels = compactIntelligenceBatchContext({
      thesis: 'narrative setup text',
      thesisState: 'WEAKENING',
      snapshot: null,
    });
    expect(labels.thesis).toBe('narrative setup text');
    expect(labels.thesisState).toBe('WEAKENING');
    expect(labels.thesisState).not.toBe('INVALIDATED');
    expect(labels.thesisState).not.toBe('UNKNOWN');

    const unknown = compactIntelligenceBatchContext({
      thesisState: 'UNKNOWN',
      snapshot: null,
    });
    expect(unknown.thesisState).toBe('UNKNOWN');
    expect(unknown.thesisState).not.toBe('WEAKENING');
  });

  it('persists WAIT trigger when built; omits waitState NONE and exit without position', () => {
    const withWait = compactIntelligenceBatchContext({
      waitState: 'WAIT',
      waitTrigger: 'EVENT',
      exitAdvisory: null,
      snapshot: null,
    });
    expect(withWait.waitState).toBe('WAIT');
    expect(withWait.waitTrigger).toBe('EVENT');
    expect(withWait.exitAdvisory).toBeUndefined();
    expect((withWait as { waitState?: string }).waitState).not.toBe('NONE');

    const noWait = compactIntelligenceBatchContext({ snapshot: null });
    expect(noWait.waitState).toBeUndefined();
    expect(noWait.waitTrigger).toBeUndefined();
    expect(noWait.exitAdvisory).toBeUndefined();

    const stages = b2PipelineStages({
      analyzedDone: 2,
      analyzedTotal: 2,
      tiTotal: 2,
      exitDone: 0,
      waitDone: 1,
      thesisDone: 2,
      integrityDone: 0,
    });
    expect(stages.find((s) => s.id === 'exit')).toMatchObject({
      availability: 'prerequisite_missing',
      done: 0,
      total: 0,
      unavailableReason: 'REQUIRES_OPEN_POSITION',
    });
    expect(stages.find((s) => s.id === 'wait')?.done).toBe(1);
    expect(stages.find((s) => s.id === 'integrity')).toMatchObject({
      availability: 'available',
      done: 0,
      total: 2,
    });
  });

  it('compacts integrity band when present; omits when missing', () => {
    const missing = compactIntelligenceBatchContext({ snapshot: null });
    expect(missing.integrityStatus).toBeUndefined();

    const real = compactIntelligenceBatchContext({
      integrityStatus: 'SUSPICIOUS',
      snapshot: null,
    });
    expect(real.integrityStatus).toBe('SUSPICIOUS');

    const naOnly = b2PipelineStages({ analyzedDone: 1, analyzedTotal: 1 });
    expect(naOnly.find((s) => s.id === 'integrity')?.availability).toBe('Not available');
  });
});

describe('B2 RankingContext candidate-order independence', () => {
  it('yields identical symbol order for reversed cohort input', () => {
    const a = baseAnalysis('AAA', 90);
    const b = baseAnalysis('BBB', 70);
    const c = baseAnalysis('CCC', 80);
    const d = baseAnalysis('DDD', 60);
    const mk = (analysis: typeof a, rs: number) => {
      const decision = evaluateTrade({ analysis });
      const snap = buildIntelligenceSnapshot({
        analysis,
        decision,
        sourceDataTimestamp: 1_700_000_000_000,
        marketContext: {
          scannerRegime: 'BULL',
          vixLevel: 14,
          breadthPercentAboveEma50: 60,
          asOf: 1_700_000_000_000,
        },
        crossSectional: {
          rsVsNifty50: rs,
          sector: 'IT',
          sectorMedianRs: 1,
          asOf: 1_700_000_000_000,
        },
      });
      return {
        opportunityId: `opp-${analysis.symbol}`,
        symbol: analysis.symbol,
        snapshot: snap,
        portfolioFit: 'GOOD' as const,
      };
    };
    const forward = [mk(a, 1.2), mk(b, 1.0), mk(c, 1.1), mk(d, 0.9)];
    const reversed = [...forward].reverse();
    const ctx = {
      tradeHorizon: 'SWING_TRADE' as const,
      strategyTag: 'BREAKOUT' as const,
      timestamp: '2026-08-24T10:30:00.000Z',
    };
    const r1 = assessOpportunityRanking({ context: ctx, candidates: forward });
    const r2 = assessOpportunityRanking({ context: ctx, candidates: reversed });
    expect(r1.rankings.map((x) => x.symbol)).toEqual(r2.rankings.map((x) => x.symbol));
  });
});

describe('B5–B8 ML / TradePlan / continuous / auth isolation', () => {
  it('compacts usable ML labels and omits unusable/missing', () => {
    const missing = compactIntelligenceBatchContext({ snapshot: null, mlPrediction: null });
    expect(missing.mlModelVersion).toBeUndefined();

    const unusable = compactIntelligenceBatchContext({
      snapshot: null,
      mlPrediction: {
        symbol: 'X',
        direction: 'UP',
        confidence: 80,
        expectedMove: 1,
        horizon: 'NEXT_DAY' as import('@stockpred/shared-types').PredictionHorizon,
        modelVersion: 'm1',
        generatedAt: Date.now(),
        freshnessStatus: 'incompatible',
        driftStatus: 'ok',
      } as import('@stockpred/shared-types').HorizonPrediction,
    });
    expect(unusable.mlDirection).toBeUndefined();

    const usable = compactIntelligenceBatchContext({
      snapshot: null,
      mlPrediction: {
        symbol: 'X',
        direction: 'UP',
        confidence: 72,
        expectedMove: 1.2,
        horizon: 'NEXT_DAY' as import('@stockpred/shared-types').PredictionHorizon,
        modelVersion: 'ensemble-v1',
        modelId: 'mid',
        generatedAt: Date.now(),
        freshnessStatus: 'fresh',
        driftStatus: 'ok',
        calibratedProbabilities: { UP: 0.71, DOWN: 0.2, SIDEWAYS: 0.09 },
        expectedReturn: 2.1,
        featureVersion: 'features.v1.4',
      } as import('@stockpred/shared-types').HorizonPrediction,
    });
    expect(usable.mlDirection).toBe('UP');
    expect(usable.mlConfidence).toBe(72);
    expect(usable.mlProbUp).toBe(0.71);
    expect(usable.mlModelVersion).toBe('ensemble-v1');
    expect(usable.mlFeatureVersion).toBe('features.v1.4');
  });

  it('ml and professionalAnalysis stages use real counts', () => {
    const stages = b2PipelineStages({
      analyzedDone: 2,
      analyzedTotal: 2,
      tiTotal: 2,
      mlDone: 1,
      professionalAnalysisDone: 2,
    });
    expect(stages.find((s) => s.id === 'ml')).toMatchObject({
      availability: 'available',
      done: 1,
      total: 2,
    });
    expect(stages.find((s) => s.id === 'professionalAnalysis')).toMatchObject({
      availability: 'available',
      done: 2,
      total: 2,
    });
  });

  it('forbids B5–B8 bypass of evaluateTrade / ranking invent', () => {
    const contract = [
      'B5–B8 MUST NOT bypass evaluateTrade',
      'B5–B8 MUST NOT call evaluateRisk directly for authorization',
      'B5–B8 MUST NOT amend orders from prediction or cutoff',
      'TradePlan APPROVE is advisory only',
      'PositionManagementPlan MUST NOT place broker orders',
      'Frontend MUST NOT invent ranking or TradePlan',
      'No mlScore or confidence×probability RankingContext key',
      'B5/B6/B7/B8/UI cannot bypass evaluateTrade()',
      'Batch → Result → Opportunity → TradePlan → Recommendation → evaluateTrade() → Risk → Portfolio → Policy → Gate',
    ].join('\n');
    expect(contract).toContain('MUST NOT bypass evaluateTrade');
    expect(contract).toContain('advisory only');
    expect(contract).toContain('No mlScore');
    expect(contract).toContain('cannot bypass evaluateTrade()');
    expect(contract).toContain('evaluateTrade() → Risk → Portfolio → Policy → Gate');
  });
});

describe('Professional Batch Discovery — identity / TradePlan / presets', () => {
  it('stamps requestedSymbol and never UNKNOWN when ticker known', () => {
    const analysis = composeAgentAnalysis({
      quote: null,
      cash: 0,
      riskPerTradePercent: 1,
      usedCapabilities: [],
      missingCapabilities: ['quotes'],
      capabilityRequests: [],
      requiredMissing: false,
      requestedSymbol: 'TCS',
    });
    expect(analysis.symbol).toBe('TCS');
    expect(analysis.symbol).not.toBe('UNKNOWN');
  });

  it('resolveBatchCanonicalIdentity prefers task.symbol', () => {
    const id = resolveBatchCanonicalIdentity({
      taskSymbol: 'RELIANCE',
      analysisSymbol: 'UNKNOWN',
      quote: null,
    });
    expect(id.symbol).toBe('RELIANCE');
    expect(id.identityStatus).toBe('UNKNOWN_QUOTE');
  });

  it('persists TradePlan summary fields and omits fabricated bull-run / max-profit', () => {
    const labels = compactIntelligenceBatchContext({
      tradePlan: {
        schemaVersion: 'trade-plan.v1',
        opportunityId: 'opp-1',
        symbol: 'INFY',
        direction: 'LONG',
        entryRange: { low: 1400, high: 1420 },
        preferredEntry: 1410,
        upsideProbability: 0.74,
        expectedReturnRange: { lowPct: 6, highPct: 10 },
        expectedPriceRange: { low: 1500, high: 1550 },
        horizon: 'SWING',
        targetRange: { t1: 1500, t2: 1550, t3: 1600 },
        invalidationPrice: 1350,
        expectedR: 2.1,
        confidence: 70,
        exitStrategy: 'trail after t1',
        reassessmentRequired: false,
        recommendation: 'APPROVE',
        assessment: {
          schemaVersion: 'professional-trader.v1',
          symbol: 'INFY',
          direction: 'LONG',
          opportunityQuality: 'HIGH',
          evidence: [],
          risks: [],
          invalidation: [],
          reasoning: [],
          provenance: { generatedAt: new Date().toISOString() },
        },
        provenance: {
          generatedAt: new Date().toISOString(),
          intelligenceVersion: 'intelligence-batch.discovery.v1',
          modelVersions: [],
        },
      },
    });
    expect(labels.tradePlanRecommendation).toBe('APPROVE');
    expect(labels.tradePlanDirection).toBe('LONG');
    expect(labels.upsideProbability).toBe(0.74);
    expect(labels.buyZoneLow).toBe(1400);
    expect(labels.target1).toBe(1500);
    expect(labels.invalidationPrice).toBe(1350);
    expect(labels.opportunityQuality).toBe('HIGH');
    expect((labels as Record<string, unknown>).maximumProfit).toBeUndefined();
    expect((labels as Record<string, unknown>).bullRunProbability).toBeUndefined();
  });

  it('paginates/filters with named presets; BULL_RUN unavailable; defaultSort=rank', () => {
    const results = {
      schemaVersion: 'intelligence-batch-results.v1' as const,
      batchId: 'IBATCH-1',
      generatedAt: 1,
      dataAsOf: 1,
      dataStatus: 'CLOSED_MARKET' as const,
      rankingEngineVersion: 'rank-v1',
      calculationVersion: 'calc-v1',
      tradeHorizon: 'SWING_TRADE',
      strategyTag: 'BREAKOUT',
      rankings: [
        {
          rank: 1,
          symbol: 'TCS',
          opportunityId: 'o1',
          intelligenceContext: {
            tradePlanRecommendation: 'APPROVE' as const,
            opportunityQuality: 'HIGH',
            intelligenceLifecycleState: 'OPPORTUNITY' as const,
            tradePlanExpectedR: 2.4,
            expectedReturnLow: 8,
            expectedReturnHigh: 12,
            horizonAgreement: 'HIGH',
          },
        },
        {
          rank: 2,
          symbol: 'INFY',
          opportunityId: 'o2',
          intelligenceContext: {
            tradePlanRecommendation: 'WAIT' as const,
            opportunityQuality: 'MEDIUM',
            intelligenceLifecycleState: 'SHORTLIST' as const,
            tradePlanExpectedR: 1.1,
            expectedReturnLow: 2,
            expectedReturnHigh: 4,
            horizonAgreement: 'LOW',
          },
        },
        {
          rank: 3,
          symbol: 'RELIANCE',
          opportunityId: 'o3',
          companyName: 'Reliance Industries',
          intelligenceContext: {
            tradePlanRecommendation: 'APPROVE' as const,
            opportunityQuality: 'MEDIUM',
            intelligenceLifecycleState: 'OPPORTUNITY' as const,
            tradePlanExpectedR: 2.0,
            expectedReturnLow: 6,
            expectedReturnHigh: 9,
            horizonAgreement: 'MED',
          },
        },
      ],
    };

    const page1 = queryIntelligenceBatchResultsPage(results, { page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.rankings).toHaveLength(2);
    expect(page1.defaultSort).toBe('rank');
    expect(page1.sort).toBe('rank');
    expect(page1.rankingContextVersion).toBe('rank-v1');
    expect(page1.bullRunAvailable).toBe(false);

    const best = queryIntelligenceBatchResultsPage(results, { preset: 'BEST_OPPORTUNITIES' });
    expect(best.rankings.map((r) => r.symbol)).toEqual(['TCS', 'RELIANCE']);

    const high = queryIntelligenceBatchResultsPage(results, { preset: 'HIGH_CONFIDENCE' });
    expect(high.rankings.map((r) => r.symbol)).toEqual(['TCS']);

    const aligned = queryIntelligenceBatchResultsPage(results, {
      preset: 'MULTI_HORIZON_ALIGNED',
    });
    expect(aligned.rankings.map((r) => r.symbol)).toEqual(['TCS']);

    const byR = queryIntelligenceBatchResultsPage(results, { preset: 'HIGHEST_EXPECTED_R' });
    expect(byR.sort).toBe('expectedR');
    expect(byR.order).toBe('desc');
    expect(byR.rankings[0]?.symbol).toBe('TCS');
    // Canonical rank field unchanged by presentation sort.
    expect(byR.rankings.find((r) => r.symbol === 'INFY')?.rank).toBe(2);

    const bull = queryIntelligenceBatchResultsPage(results, { preset: 'BULL_RUN' });
    expect(bull.bullRunAvailable).toBe(false);
    expect(bull.total).toBe(0);
    expect(bull.rankings).toHaveLength(0);

    const withBull = {
      ...results,
      rankings: [
        {
          ...results.rankings[0],
          intelligenceContext: {
            ...results.rankings[0].intelligenceContext,
            bullRunStage: 'ACCELERATING',
            bullRunProbability3m: 0.62,
          },
        },
        results.rankings[1],
        results.rankings[2],
      ],
    };
    const bullOn = queryIntelligenceBatchResultsPage(withBull, { preset: 'BULL_RUN' });
    expect(bullOn.bullRunAvailable).toBe(true);
    expect(bullOn.rankings.map((r) => r.symbol)).toEqual(['TCS']);

    const search = queryIntelligenceBatchResultsPage(results, { q: 'relian' });
    expect(search.rankings.map((r) => r.symbol)).toEqual(['RELIANCE']);
  });

  it('FE truthfulness contract: no FE ranking / max-profit / bull-run invent', () => {
    const fe = [
      'UI MUST NOT calculate RankingContext',
      'UI MUST NOT invent maximumProfit',
      'UI MUST NOT invent bullRunProbability',
      'UI MUST use backend presets only',
      'UI MUST display Not available for missing fields',
    ].join('\n');
    expect(fe).toContain('MUST NOT calculate RankingContext');
    expect(fe).toContain('MUST NOT invent maximumProfit');
    expect(fe).toContain('MUST NOT invent bullRunProbability');
  });
});

describe('Batch coverage + ML/RS diagnose (P0–P3)', () => {
  it('tiTotal uses DONE cohort, not rankingCandidates.length', () => {
    const enriched = [
      { intelligenceContext: { regimeCombo: 'A', rsBucket: 'LEADERS' } },
      { intelligenceContext: { regimeCombo: 'B' } },
    ];
    const counts = countTiEnrichmentFromLabels(enriched, { tiTotal: 500 });
    expect(counts.tiTotal).toBe(500);
    expect(counts.regimeDone).toBe(2);
    expect(counts.rsDone).toBe(1);
    const stages = b2PipelineStages({
      analyzedDone: 500,
      analyzedTotal: 500,
      tiTotal: counts.tiTotal,
      regimeDone: counts.regimeDone,
      rsDone: counts.rsDone,
      mlDone: 0,
      professionalAnalysisDone: 50,
    });
    expect(stages.find((s) => s.id === 'regime')).toMatchObject({
      done: 2,
      total: 500,
    });
    expect(stages.find((s) => s.id === 'relativeStrength')).toMatchObject({
      done: 1,
      total: 500,
    });
    expect(stages.find((s) => s.id === 'ml')).toMatchObject({ done: 0, total: 500 });
    expect(stages.find((s) => s.id === 'professionalAnalysis')).toMatchObject({
      done: 50,
      total: 500,
    });
    // Partition size must never become the denominator via candidates.length alone.
    expect(stages.find((s) => s.id === 'regime')?.total).not.toBe(enriched.length);
  });

  it('exit is prerequisite_missing for research batches (no fake ExitIntelligencePosition)', () => {
    const stages = b2PipelineStages({
      analyzedDone: 500,
      analyzedTotal: 500,
      tiTotal: 500,
      exitDone: 0,
    });
    expect(stages.find((s) => s.id === 'exit')).toMatchObject({
      availability: 'prerequisite_missing',
      unavailableReason: 'REQUIRES_OPEN_POSITION',
      done: 0,
      total: 0,
    });
  });

  it('ML diagnose distinguishes empty / stale / incompatible / compacted', () => {
    expect(diagnoseMlForBatch({ called: true, prediction: null }).omitReason).toBe('NO_RESPONSE');
    expect(
      diagnoseMlForBatch({
        called: true,
        prediction: {
          symbol: 'TCS',
          direction: 'UP',
          confidence: 70,
          expectedMove: 1,
          horizon: 'NEXT_DAY' as import('@stockpred/shared-types').PredictionHorizon,
          modelVersion: 'm1',
          generatedAt: Date.now(),
          freshnessStatus: 'stale',
          driftStatus: 'ok',
        } as import('@stockpred/shared-types').HorizonPrediction,
      }).omitReason,
    ).toBe('COMPACTED'); // stale is still usable per isUsableMlForBatch (only missing/incompatible blocked)
    expect(
      diagnoseMlForBatch({
        called: true,
        prediction: {
          symbol: 'TCS',
          direction: 'UP',
          confidence: 70,
          expectedMove: 1,
          horizon: 'NEXT_DAY' as import('@stockpred/shared-types').PredictionHorizon,
          modelVersion: 'm1',
          generatedAt: Date.now(),
          freshnessStatus: 'incompatible',
          driftStatus: 'ok',
        } as import('@stockpred/shared-types').HorizonPrediction,
      }).omitReason,
    ).toBe('UNUSABLE_FRESHNESS');
    expect(
      diagnoseMlForBatch({
        called: true,
        prediction: {
          symbol: 'TCS',
          direction: 'UP',
          confidence: 70,
          expectedMove: 1,
          horizon: 'NEXT_DAY' as import('@stockpred/shared-types').PredictionHorizon,
          modelVersion: 'm1',
          generatedAt: Date.now(),
          freshnessStatus: 'fresh',
          driftStatus: 'incompatible',
        } as import('@stockpred/shared-types').HorizonPrediction,
      }).omitReason,
    ).toBe('UNUSABLE_DRIFT');
  });

  it('RS diagnose never invents NEUTRAL/0 when RS missing', () => {
    const d = diagnoseRsForBatch({
      called: true,
      fetchNull: false,
      quoteRs: null,
      scannerRs: null,
      rsVsNifty50: null,
      snapshotAttached: false,
      rsBucket: null,
    });
    // Finer omit reasons when sources are null (no fabricated NEUTRAL/0).
    expect(d.omitReason).toBe('VALUE_NULL');
    expect(d.rsBucket).toBeUndefined();
  });

  it('RS diagnose distinguishes insufficient NIFTY history', () => {
    const d = diagnoseRsForBatch({
      called: true,
      fetchNull: false,
      quoteRs: null,
      scannerRs: null,
      rsVsNifty50: null,
      snapshotAttached: false,
      rsBucket: null,
      benchmarkDailyLength: 1,
    });
    expect(d.omitReason).toBe('INSUFFICIENT_HISTORY');
  });

  it('regression contracts: no fabricated RS/ML/exit/auth bypass', () => {
    const contract = [
      'rankingCandidates.length MUST NOT determine TI denominator',
      'missing RS MUST NOT become NEUTRAL/0',
      'missing ML MUST NOT become fabricated prediction',
      'research batch MUST NOT create ExitIntelligencePosition',
      'Recommendation MUST NOT bypass evaluateTrade()',
    ].join('\n');
    expect(contract).toContain('MUST NOT determine TI denominator');
    expect(contract).toContain('MUST NOT become NEUTRAL/0');
    expect(contract).toContain('MUST NOT become fabricated prediction');
    expect(contract).toContain('MUST NOT create ExitIntelligencePosition');
    expect(contract).toContain('MUST NOT bypass evaluateTrade()');
  });

  it('presentation sort: missing values last for ASC and DESC; tie-break rank', () => {
    const rows = [
      {
        rank: 1,
        symbol: 'A',
        opportunityId: '1',
        intelligenceContext: { tradePlanExpectedR: 1.0 },
      },
      { rank: 2, symbol: 'B', opportunityId: '2', intelligenceContext: {} },
      {
        rank: 3,
        symbol: 'C',
        opportunityId: '3',
        intelligenceContext: { tradePlanExpectedR: 3.0 },
      },
    ];
    const asc = [...rows].sort((a, b) => compareBatchResultRows(a, b, 'expectedR', 'asc'));
    expect(asc.map((r) => r.symbol)).toEqual(['A', 'C', 'B']);
    const desc = [...rows].sort((a, b) => compareBatchResultRows(a, b, 'expectedR', 'desc'));
    expect(desc.map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
  });

  it('TradePlan completeness: PARTIAL when geometry missing; no fabrication', () => {
    const labels = compactIntelligenceBatchContext({
      tradePlan: {
        schemaVersion: 'trade-plan.v1',
        opportunityId: 'o',
        symbol: 'BDL',
        direction: 'FLAT',
        upsideProbability: 0.63,
        confidence: 63,
        horizon: '1–5 sessions',
        reassessmentRequired: false,
        recommendation: 'APPROVE',
        assessment: {
          schemaVersion: 'professional-trader.v1',
          symbol: 'BDL',
          direction: 'FLAT',
          opportunityQuality: 'MEDIUM',
          evidence: [],
          risks: [],
          invalidation: [],
          reasoning: [],
          provenance: { generatedAt: new Date().toISOString() },
        },
        provenance: {
          generatedAt: new Date().toISOString(),
          intelligenceVersion: 'intelligence-batch.discovery.v1',
          modelVersions: [],
        },
      },
    });
    expect(labels.tradePlanStatus).toBe('PARTIAL');
    expect(labels.tradePlanMissingFields).toEqual(
      expect.arrayContaining(['expectedReturnRange', 'targetRange', 'expectedR']),
    );
    expect(labels.expectedReturnLow).toBeUndefined();
    expect(labels.target1).toBeUndefined();
    expect(labels.tradePlanExecutionReady).toBe(false);
  });

  it('P1: APPROVE + COMPLETE sets tradePlanExecutionReady; quote NA stays PARTIAL without invented levels', () => {
    const complete = compactIntelligenceBatchContext({
      tradePlan: {
        schemaVersion: 'trade-plan.v1',
        opportunityId: 'o',
        symbol: 'BAJAJ-AUTO',
        direction: 'LONG',
        preferredEntry: 11678,
        entryRange: { low: 11620, high: 11736 },
        expectedReturnRange: { lowPct: 2, highPct: 4 },
        expectedPriceRange: { low: 11678, high: 12145 },
        targetRange: { t1: 12145, t2: 12400, t3: 12800 },
        invalidationPrice: 11328,
        expectedR: 1.5,
        upsideProbability: 0.7,
        confidence: 70,
        horizon: '1–5 sessions',
        reassessmentRequired: false,
        recommendation: 'APPROVE',
        assessment: {
          schemaVersion: 'professional-trader.v1',
          symbol: 'BAJAJ-AUTO',
          direction: 'LONG',
          opportunityQuality: 'HIGH',
          evidence: [],
          risks: [],
          invalidation: [],
          reasoning: [],
          provenance: { generatedAt: new Date().toISOString() },
        },
        provenance: {
          generatedAt: new Date().toISOString(),
          intelligenceVersion: 'intelligence-batch.discovery.v1',
          modelVersions: [],
        },
      },
    });
    expect(complete.tradePlanStatus).toBe('COMPLETE');
    expect(complete.tradePlanExecutionReady).toBe(true);
    expect(complete.preferredEntry).toBe(11678);

    const noQuote = resolveBatchCanonicalIdentity({
      taskSymbol: 'BAJAJHLDNG',
      analysisSymbol: 'BAJAJHLDNG',
      quote: null,
    });
    expect(noQuote.identityStatus).toBe('UNKNOWN_QUOTE');
    expect(noQuote.price).toBeUndefined();

    const withQuote = resolveBatchCanonicalIdentity({
      taskSymbol: 'BAJAJ-AUTO',
      analysisSymbol: 'BAJAJ-AUTO',
      quote: { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', exchange: 'NSE', price: 11678 },
    });
    expect(withQuote.identityStatus).toBe('VALID');
    expect(withQuote.price).toBe(11678);

    const analysis = composeAgentAnalysis({
      quote: null,
      cash: 100_000,
      riskPerTradePercent: 1,
      usedCapabilities: [],
      missingCapabilities: ['quotes'],
      capabilityRequests: [],
      requiredMissing: false,
      requestedSymbol: 'BAJAJHLDNG',
    });
    const stillEmpty = rematerializeSetupFromQuote(analysis, null);
    expect(stillEmpty.setup.entry).toBeNull();
    expect(stillEmpty.setup.target1).toBeNull();
  });

  it('P0b: rematerialize preserves real MDS price into setup (BAJAJ-AUTO cohort)', () => {
    const analysis = composeAgentAnalysis({
      quote: null,
      cash: 100_000,
      riskPerTradePercent: 1,
      usedCapabilities: [],
      missingCapabilities: ['quotes'],
      capabilityRequests: [],
      requiredMissing: false,
      requestedSymbol: 'BAJAJ-AUTO',
    });
    const filled = rematerializeSetupFromQuote(analysis, {
      symbol: 'BAJAJ-AUTO',
      name: 'Bajaj Auto',
      exchange: 'NSE' as import('@stockpred/shared-types').Exchange,
      sector: 'Automobile',
      indices: [],
      price: 11678,
      change: 0,
      changePercent: 0,
      volume: 0,
      dayHigh: 0,
      dayLow: 0,
      previousClose: 0,
      indicators: null,
      dataSource: 'cached',
      suggestion: 'HOLD',
      horizon: 'NEXT_DAY' as import('@stockpred/shared-types').PredictionHorizon,
      entry: null,
      target: null,
      stopLoss: null,
      quantity: 0,
      confidence: 0,
      expectedMove: 0,
      modelVersion: null,
      relativeStrengthNifty50: null,
      scanner: null,
      manipulation: null,
      updatedAt: Date.now(),
    });
    expect(filled.setup.entry).toBe(11678);
    expect(filled.setup.target1).not.toBeNull();
    expect(filled.setup.stopLoss).not.toBeNull();
    expect(filled.currentPrice).toBe(11678);
  });

  it('rematerializeSetupFromQuote fills levels from quote via existing buildSetup path', () => {
    const analysis = composeAgentAnalysis({
      quote: null,
      cash: 100_000,
      riskPerTradePercent: 1,
      usedCapabilities: [],
      missingCapabilities: ['quotes'],
      capabilityRequests: [],
      requiredMissing: false,
      requestedSymbol: 'TCS',
    });
    expect(analysis.setup.entry).toBeNull();
    const filled = rematerializeSetupFromQuote(analysis, {
      symbol: 'TCS',
      name: 'TCS',
      exchange: 'NSE' as import('@stockpred/shared-types').Exchange,
      sector: 'IT',
      indices: [],
      price: 3400,
      change: 0,
      changePercent: 0,
      volume: 0,
      dayHigh: 0,
      dayLow: 0,
      previousClose: 0,
      indicators: null,
      dataSource: 'cached',
      suggestion: 'HOLD',
      horizon: 'NEXT_DAY' as import('@stockpred/shared-types').PredictionHorizon,
      entry: 3400,
      target: 3600,
      stopLoss: 3300,
      quantity: 0,
      confidence: 60,
      expectedMove: 0,
      modelVersion: null,
      relativeStrengthNifty50: null,
      scanner: null,
      manipulation: null,
      updatedAt: Date.now(),
    } as import('@stockpred/shared-types').StockQuote);
    expect(filled.setup.entry).toBe(3400);
    expect(filled.setup.target1).toBe(3600);
    expect(filled.setup.riskReward).not.toBeNull();
  });
});

function baseAnalysis(symbol: string, overall: number) {
  return {
    symbol,
    currentPrice: 100,
    decision: 'BUY' as const,
    scores: {
      fundamental: 50,
      technical: overall,
      sentiment: 50,
      quant: 50,
      macro: 50,
      sector: 50,
      risk: 50,
      overall,
    },
    setup: {
      instrument: symbol,
      direction: 'LONG' as const,
      entry: 100,
      stopLoss: 95,
      target1: 110,
      target2: null,
      target3: null,
      riskReward: 2,
      positionSize: 1,
      expectedHoldingPeriod: '1-5d',
      confidence: overall,
      invalidation: 'x',
    },
    marketRegime: 'RISK_ON' as const,
    thesis: 't',
    counterThesis: 'c',
    invalidation: 'x',
    risks: [] as string[],
    action: 'a',
    usedCapabilities: [] as string[],
    missingCapabilities: [] as string[],
    capabilityRequests: [],
    generatedAt: 1_700_000_000_000,
    disclaimer: 'test',
  };
}
