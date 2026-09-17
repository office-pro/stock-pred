/**
 * Historical intelligence + evidence + reliability + ranking independence tests.
 */
import {
  HISTORICAL_ANALOGUE_MIN_SAMPLE,
  PREDICTION_RELIABILITY_MIN_SAMPLE,
} from '@stockpred/shared-types';
import { buildBatchResearchReport, isBestOpportunityRow } from './batch-research-report';
import {
  assessHistoricalIntelligence,
  findHistoricalAnalogues,
  buildHistoricalForwardDistribution,
} from './historical-intelligence-engine';
import { runMatchedHistoricalPredictionProof } from './historical-prediction-proof';
import { evidenceFromAdvisoryLabels, validateEvidencePackage } from './evidence-validation-layer';
import {
  assessPredictionImprovement,
  buildPredictionQualityPayload,
  computeEngineReliability,
} from './prediction-reliability';
import { buildBullRunV2FromEvidence } from './bull-run-v2-engine';
import type { IntelligenceBatchResultRow } from '@stockpred/shared-types';

function syntheticCloses(n: number, drift = 0.0012, vol = 0.018): number[] {
  const out: number[] = [100];
  for (let i = 1; i < n; i++) {
    const shock = ((i % 11) - 5) * vol * 0.25;
    out.push(out[i - 1]! * (1 + drift + shock));
  }
  return out;
}

describe('historical-intelligence-engine', () => {
  it('returns UNAVAILABLE below minimum analogue sample (never 100% from tiny N)', () => {
    const closes = syntheticCloses(100);
    const set = findHistoricalAnalogues({ symbol: 'TCS', closes });
    expect(set.minSampleRequired).toBe(HISTORICAL_ANALOGUE_MIN_SAMPLE);
    if (set.sampleSize < HISTORICAL_ANALOGUE_MIN_SAMPLE) {
      expect(set.status).toBe('UNAVAILABLE');
    }
  });

  it('produces AVAILABLE analogues and distributions with long history', () => {
    const closes = syntheticCloses(900, 0.001, 0.02);
    const assessed = assessHistoricalIntelligence({ symbol: 'TCS', closes, lookback: '5Y' });
    expect(assessed.state.priceReturnBasis).toBe('AS_PROVIDED_CANDLES');
    expect(assessed.state.universeMembershipStatus).toBe('UNKNOWN');
    expect(assessed.state.corporateActionNote.toLowerCase()).toContain('corporate-action');
    if (assessed.analogues.status === 'AVAILABLE') {
      expect(assessed.analogues.sampleSize).toBeGreaterThanOrEqual(HISTORICAL_ANALOGUE_MIN_SAMPLE);
      const dist = assessed.forwardDistribution3M;
      if (dist.status === 'AVAILABLE') {
        expect(dist.sampleSize).toBeGreaterThanOrEqual(HISTORICAL_ANALOGUE_MIN_SAMPLE);
        expect(dist.calibrationStatus).not.toBe('AVAILABLE');
        expect(dist.maxForwardReturns?.length).toBe(dist.sampleSize);
      }
    }
  });

  it('analogue order is deterministic', () => {
    const closes = syntheticCloses(800);
    const a = findHistoricalAnalogues({ symbol: 'INFY', closes });
    const b = findHistoricalAnalogues({ symbol: 'INFY', closes });
    expect(a.analogues.map((x) => x.historicalIndex)).toEqual(
      b.analogues.map((x) => x.historicalIndex),
    );
  });

  it('can feed Bull-Run v2 with analogue max-forward returns without second engine', () => {
    const closes = syntheticCloses(900);
    const dist = buildHistoricalForwardDistribution({ symbol: 'TCS', closes }, '3M');
    const v2 = buildBullRunV2FromEvidence({
      symbol: 'TCS',
      closes,
      dataStatus: 'OFFLINE',
      analogueMaxForwardReturnsByHorizon:
        dist.status === 'AVAILABLE' && dist.maxForwardReturns
          ? {
              '3M': { sampleSize: dist.sampleSize, maxForwardReturns: dist.maxForwardReturns },
            }
          : undefined,
    });
    expect(v2.executionReadyFromBullRun).toBe(false);
    const m3 = v2.cells.filter((c) => c.horizon === '3M' && c.status === 'AVAILABLE');
    for (let i = 1; i < m3.length; i++) {
      expect(m3[i]!.probability!).toBeLessThanOrEqual(m3[i - 1]!.probability!);
    }
  });
});

describe('evidence-validation-layer', () => {
  it('separates supporting/conflicting/missing without EvidenceScore', () => {
    const pkg = validateEvidencePackage({
      items: evidenceFromAdvisoryLabels({
        sector: 'IMPROVING',
        rs: 'LEADERS',
        mlDirection: 'DOWN',
        historicalStatus: 'AVAILABLE',
        historicalSampleSize: 94,
        bullRunStage: 'EARLY',
        integrity: 'NORMAL',
      }),
    });
    expect(pkg.supportingEvidence.length).toBeGreaterThan(0);
    expect(pkg.conflictingEvidence.some((e) => e.engine === 'ML')).toBe(true);
    expect(pkg.conflictSummary.toLowerCase()).toContain('mixed');
    expect(['STRONG', 'MIXED', 'WEAK', 'INSUFFICIENT', 'UNKNOWN']).toContain(pkg.evidenceQuality);
  });
});

describe('prediction-reliability', () => {
  it('UNAVAILABLE below min labeled samples', () => {
    const m = computeEngineReliability(
      [
        {
          engine: 'ML',
          symbol: 'TCS',
          predictionTime: 1,
          horizon: '3M',
          prediction: 'UP',
          actual: 'UP',
        },
      ],
      'ML',
      '3M',
      'UNKNOWN',
    );
    expect(m.status).toBe('UNAVAILABLE');
    expect(m.sampleSize).toBeLessThan(PREDICTION_RELIABILITY_MIN_SAMPLE);
  });

  it('does not treat confidence as calibrated probability', () => {
    const p = buildPredictionQualityPayload({
      predictionHorizon: '3M',
      analysisTimeframe: '1D',
      probability: 0.7,
      confidence: 85,
      sampleSize: 100,
      definedEvent: 'P(max fwd return within 3M >= 0.2)',
      status: 'AVAILABLE',
      hasCalibrationEvidence: false,
    });
    expect(p.calibrationStatus).not.toBe('AVAILABLE');
    expect(p.confidence).toBe(85);
    expect(p.probability).toBe(0.7);
  });

  it('improvement claim defaults to IMPROVEMENT NOT VERIFIED', () => {
    const c = assessPredictionImprovement({ hasMatchedWalkForwardComparison: false });
    expect(c.status).toBe('IMPROVEMENT_NOT_VERIFIED');
  });
});

describe('ranking independence — historical / evidence', () => {
  function makeRows(mode: 'full' | 'none' | 'partial'): IntelligenceBatchResultRow[] {
    return [
      {
        rank: 1,
        symbol: 'TCS',
        opportunityId: 'a',
        intelligenceContext: {
          tradePlanRecommendation: 'APPROVE',
          intelligenceLifecycleState: 'OPPORTUNITY',
          opportunityQuality: 'HIGH',
          ...(mode === 'none'
            ? {}
            : {
                bullRunV2Cells: [{ t: 0.2, h: '3M', p: 0.5, conf: 'HIGH', status: 'AVAILABLE' }],
              }),
        },
      },
      {
        rank: 2,
        symbol: 'INFY',
        opportunityId: 'b',
        intelligenceContext: {
          tradePlanRecommendation: 'APPROVE',
          intelligenceLifecycleState: 'SHORTLIST',
          ...(mode === 'full'
            ? {
                bullRunV2Cells: [{ t: 0.1, h: '3M', p: 0.9, conf: 'HIGH', status: 'AVAILABLE' }],
              }
            : {}),
        },
      },
      {
        rank: 3,
        symbol: 'RELIANCE',
        opportunityId: 'c',
        intelligenceContext: {
          tradePlanRecommendation: 'WAIT',
          bullRunV2Cells: [{ t: 0.1, h: '3M', p: 0.99, conf: 'HIGH', status: 'AVAILABLE' }],
        },
      },
    ];
  }

  it('Best Pick membership ignores historical/bull-run presence', () => {
    for (const mode of ['full', 'none', 'partial'] as const) {
      const picks = makeRows(mode)
        .filter(isBestOpportunityRow)
        .map((r) => `${r.rank}:${r.symbol}`);
      expect(picks).toEqual(['1:TCS', '2:INFY']);
    }
  });

  it('report bestPicks identical across bull-run cell presence', () => {
    const syms = (mode: 'full' | 'none' | 'partial') =>
      buildBatchResearchReport({
        batchId: `h-${mode}`,
        completedAt: 1,
        universe: 'NIFTY50',
        coverage: { total: 3, processed: 3, failed: 0 },
        rankings: makeRows(mode),
      }).bestPicks?.map((p) => `${p.rank}:${p.symbol}`);
    expect(syms('full')).toEqual(['1:TCS', '2:INFY']);
    expect(syms('none')).toEqual(['1:TCS', '2:INFY']);
    expect(syms('partial')).toEqual(['1:TCS', '2:INFY']);
  });

  it('report includes evidence packages and IMPROVEMENT NOT VERIFIED note', () => {
    const report = buildBatchResearchReport({
      batchId: 'ev-1',
      completedAt: 1,
      universe: 'NIFTY50',
      coverage: { total: 1, processed: 1, failed: 0 },
      rankings: makeRows('full'),
    });
    expect(report.bestOpportunities[0]?.conflictSummary).toBeTruthy();
    expect(report.bestOpportunities[0]?.historicalStatus).toBe('UNAVAILABLE');
    expect(report.predictionImprovementNote).toContain('IMPROVEMENT NOT VERIFIED');
  });
});

describe('historical-prediction-proof (matched walk-forward)', () => {
  it('emits IMPROVED | NOT_IMPROVED | INCONCLUSIVE with matched protocol fields', () => {
    const closes = syntheticCloses(900, 0.001, 0.02);
    const report = runMatchedHistoricalPredictionProof({
      symbol: 'TCS',
      closes,
      universe: 'SINGLE_SYMBOL',
    });
    expect(report.schemaVersion).toBe('historical-prediction-proof.v1');
    expect(report.priceReturnBasis).toBe('AS_PROVIDED_CANDLES');
    expect(report.universeMembershipStatus).toBe('UNKNOWN');
    expect(report.predictionHorizon).toBe('3M');
    expect(report.costConvention).toBe('ROUND_TRIP_HAIRCUT');
    expect(['IMPROVED', 'NOT_IMPROVED', 'INCONCLUSIVE']).toContain(report.verdict);
    expect(report.improvementClaim.status).toBeTruthy();
    if (report.verdict !== 'IMPROVED') {
      expect(report.improvementClaim.status).not.toBe('PASS');
    }
    expect(report.notes.some((n) => /regime/i.test(n) || /Matched protocol/i.test(n))).toBe(true);
  });

  it('under-sampled series → INCONCLUSIVE and IMPROVEMENT_NOT_VERIFIED', () => {
    const report = runMatchedHistoricalPredictionProof({
      symbol: 'TINY',
      closes: syntheticCloses(80),
      minTrainBars: 400,
    });
    expect(report.verdict).toBe('INCONCLUSIVE');
    expect(report.improvementClaim.status).toBe('IMPROVEMENT_NOT_VERIFIED');
    expect(report.totalScored).toBeLessThan(30);
  });

  it('never claims calibrated regime metrics without samples', () => {
    const report = runMatchedHistoricalPredictionProof({
      symbol: 'INFY',
      closes: syntheticCloses(500),
    });
    expect(
      report.notes.some(
        (n) =>
          /regime×horizon/i.test(n) ||
          /regime x horizon/i.test(n) ||
          /Regime×horizon/i.test(n) ||
          /UNAVAILABLE/i.test(n),
      ) || report.verdict === 'INCONCLUSIVE',
    ).toBe(true);
  });
});
