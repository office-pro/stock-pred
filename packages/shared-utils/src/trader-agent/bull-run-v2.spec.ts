/**
 * Bull-Run v2 unit tests — distribution, monotonicity, UNAVAILABLE≠0, auth isolation.
 */
import {
  buildBullRunV2FromEvidence,
  compactBullRunV2Cells,
  computeMaxForwardReturns,
  enforceMonotonicProbabilities,
  probabilityAtLeast,
} from './bull-run-v2-engine';
import { buildBatchResearchReport, compareBatchResearchReports } from './batch-research-report';
import type { BullRunTargetHorizonCell, IntelligenceBatchResultRow } from '@stockpred/shared-types';

function syntheticCloses(n: number, drift = 0.001, vol = 0.02): number[] {
  const out: number[] = [100];
  for (let i = 1; i < n; i++) {
    const shock = ((i % 7) - 3) * vol * 0.3;
    out.push(out[i - 1]! * (1 + drift + shock));
  }
  return out;
}

describe('bull-run-v2-engine', () => {
  it('computes empirical max forward returns', () => {
    const closes = [100, 101, 102, 99, 105, 110];
    const samples = computeMaxForwardReturns(closes, 2);
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...samples)).toBeGreaterThan(0);
  });

  it('probabilityAtLeast is monotonic in T for same samples', () => {
    const samples = [0.02, 0.05, 0.12, 0.25, -0.03, 0.4, 0.08];
    const p5 = probabilityAtLeast(samples, 0.05);
    const p20 = probabilityAtLeast(samples, 0.2);
    const p50 = probabilityAtLeast(samples, 0.5);
    expect(p20).toBeLessThanOrEqual(p5);
    expect(p50).toBeLessThanOrEqual(p20);
  });

  it('enforceMonotonicProbabilities clamps higher-T probs', () => {
    const cells: BullRunTargetHorizonCell[] = [
      {
        targetReturn: 0.1,
        horizon: '3M',
        status: 'AVAILABLE',
        probability: 0.61,
      },
      {
        targetReturn: 0.2,
        horizon: '3M',
        status: 'AVAILABLE',
        probability: 0.74, // invalid — must be clamped
      },
    ];
    const fixed = enforceMonotonicProbabilities(cells);
    const p10 = fixed.find((c) => c.targetReturn === 0.1)?.probability ?? 0;
    const p20 = fixed.find((c) => c.targetReturn === 0.2)?.probability ?? 0;
    expect(p20).toBeLessThanOrEqual(p10);
  });

  it('buildBullRunV2FromEvidence returns UNAVAILABLE (not 0) when history short', () => {
    const v2 = buildBullRunV2FromEvidence({
      symbol: 'TEST',
      closes: [100, 101, 102],
      dataStatus: 'OFFLINE',
    });
    expect(v2.status).toBe('UNAVAILABLE');
    expect(v2.executionReadyFromBullRun).toBe(false);
    for (const c of v2.cells) {
      expect(c.status).toBe('UNAVAILABLE');
      expect(c.probability == null || c.probability === null).toBe(true);
    }
    expect(compactBullRunV2Cells(v2)).toEqual([]);
  });

  it('buildBullRunV2FromEvidence produces AVAILABLE cells with enough history', () => {
    const closes = syntheticCloses(400, 0.0015, 0.015);
    const v2 = buildBullRunV2FromEvidence({
      symbol: 'TCS',
      closes,
      dataStatus: 'OFFLINE',
      dataAsOf: Date.now(),
    });
    expect(v2.executionReadyFromBullRun).toBe(false);
    expect(v2.dataStatus).toBe('OFFLINE');
    const avail = v2.cells.filter((c) => c.status === 'AVAILABLE');
    expect(avail.length).toBeGreaterThan(0);
    // Monotonic within 3M
    const m3 = avail
      .filter((c) => c.horizon === '3M')
      .sort((a, b) => a.targetReturn - b.targetReturn);
    for (let i = 1; i < m3.length; i++) {
      expect(m3[i]!.probability!).toBeLessThanOrEqual(m3[i - 1]!.probability!);
    }
    // Compact omits UNAVAILABLE — never fabricates 0 for missing
    const compact = compactBullRunV2Cells(v2);
    expect(compact.every((c) => c.p != null && Number.isFinite(c.p))).toBe(true);
  });

  it('does not treat OFFLINE probability as execution-ready', () => {
    const v2 = buildBullRunV2FromEvidence({
      symbol: 'RELIANCE',
      closes: syntheticCloses(300),
      dataStatus: 'OFFLINE',
    });
    expect(v2.executionReadyFromBullRun).toBe(false);
    expect(v2.dataStatus).toBe('OFFLINE');
  });
  it('includes +200%/+500% targets when observed; omits extreme targets with zero hits', () => {
    // Strong uptrend → some high targets may be AVAILABLE; extreme 500% usually UNAVAILABLE
    const closes = syntheticCloses(500, 0.004, 0.01);
    const v2 = buildBullRunV2FromEvidence({
      symbol: 'TCS',
      closes,
      dataStatus: 'OFFLINE',
      targets: [0.1, 0.2, 0.3, 0.5, 1.0, 2.0, 5.0],
    });
    expect(v2.supportedTargets).toEqual([0.1, 0.2, 0.3, 0.5, 1.0, 2.0, 5.0]);
    const m3 = v2.cells.filter((c) => c.horizon === '3M');
    const t500 = m3.find((c) => c.targetReturn === 5.0);
    // If never observed, must be UNAVAILABLE with null p — never fabricated tiny %
    if (t500 && (t500.probability == null || t500.probability <= 0)) {
      expect(t500.status).toBe('UNAVAILABLE');
      expect(t500.probability == null).toBe(true);
    }
    const avail = m3
      .filter((c) => c.status === 'AVAILABLE')
      .sort((a, b) => a.targetReturn - b.targetReturn);
    for (let i = 1; i < avail.length; i++) {
      expect(avail[i]!.probability!).toBeLessThanOrEqual(avail[i - 1]!.probability!);
    }
    const compact = compactBullRunV2Cells(v2);
    expect(compact.every((c) => c.t < 2.0 || c.p > 0)).toBe(true);
  });

  it('custom targetReturn unsupported when history short → UNAVAILABLE not 0', () => {
    const v2 = buildBullRunV2FromEvidence({
      symbol: 'XYZ',
      closes: [100, 101],
      targets: [0.1, 5.0],
    });
    for (const c of v2.cells) {
      expect(c.status).toBe('UNAVAILABLE');
      expect(c.probability).toBeNull();
    }
  });
});

describe('batch-research-report', () => {
  it('builds report with fabricated=0 and RankingContext order for Best Opps', () => {
    const rankings: IntelligenceBatchResultRow[] = [
      {
        rank: 2,
        symbol: 'INFY',
        opportunityId: 'o2',
        sector: 'IT',
        intelligenceContext: {
          tradePlanRecommendation: 'WAIT',
          bullRunStage: 'EARLY',
          bullRunV2Cells: [{ t: 0.2, h: '3M', p: 0.55, conf: 'LOW', status: 'AVAILABLE' }],
        },
      },
      {
        rank: 1,
        symbol: 'TCS',
        opportunityId: 'o1',
        sector: 'IT',
        intelligenceContext: {
          tradePlanRecommendation: 'APPROVE',
          tradePlanStatus: 'COMPLETE',
          tradePlanExecutionReady: true,
          intelligenceLifecycleState: 'OPPORTUNITY',
          bullRunStage: 'CONFIRMED',
          integrityStatus: 'NORMAL',
          bullRunV2Cells: [{ t: 0.2, h: '3M', p: 0.68, conf: 'MEDIUM', status: 'AVAILABLE' }],
        },
      },
    ];
    const report = buildBatchResearchReport({
      batchId: 'IBATCH-1',
      completedAt: Date.now(),
      universe: 'NIFTY50',
      coverage: { total: 2, processed: 2, failed: 0 },
      rankings,
      dataStatus: 'OFFLINE',
    });
    expect(report.schemaVersion).toBe('batch-research-report.v2');
    expect(report.dataQuality.fabricated).toBe(0);
    expect(report.commandCenterHorizon).toBe('3M');
    expect(report.matrixTargets).toContain(2.0);
    expect(report.matrixTargets).toContain(5.0);
    expect(report.bestOpportunities[0]?.symbol).toBe('TCS');
    expect(report.bestOpportunities[0]?.rank).toBe(1);
    expect(report.bestOpportunities[0]?.isBestPick).toBe(true);
    expect(report.bestOpportunities[0]?.integrityStatus).toBe('NORMAL');
    expect(report.bestOpportunities[0]?.bullRunMatrix?.length).toBeGreaterThan(0);
    expect(report.bestPicks?.[0]?.symbol).toBe('TCS');
    expect(report.integritySummary?.normal).toBe(1);
    expect(report.disclaimer.toLowerCase()).toContain('not guarantees');
    const c3m20 = report.bullRunCountsByHorizon.find(
      (c) => c.horizon === '3M' && c.targetReturn === 0.2,
    );
    expect(c3m20?.candidateCount).toBe(2);
    expect(report.dashboardSummary).toMatchObject({
      total: 2,
      actionable: 1,
      watchlist: 1,
      avoid: 0,
    });
    expect(report.dashboardSummary?.vsPrevious?.available).toBe(false);
    expect(report.dashboardSummary?.vsPrevious?.reason).toBe('NO_PRIOR_SAME_UNIVERSE');
    expect(report.expectedRCoverage).toEqual({ withExpectedR: 0, missing: 2 });
    expect(report.recommendationDistribution?.approve).toBe(1);
    expect(report.opportunities?.length).toBe(2);
    expect(report.sectorOpportunityCounts?.[0]?.sector).toBe('IT');
  });

  it('projects 1W/1M probs as null when UNAVAILABLE — never fabricates 0', () => {
    const rankings: IntelligenceBatchResultRow[] = [
      {
        rank: 1,
        symbol: 'TCS',
        opportunityId: 'o1',
        sector: 'IT',
        price: 3500,
        intelligenceContext: {
          tradePlanRecommendation: 'APPROVE',
          tradePlanExpectedR: 1.5,
          intelligenceLifecycleState: 'OPPORTUNITY',
          opportunityQuality: 'HIGH',
          bullRunV2Cells: [
            { t: 0.2, h: '1W', p: 0.33, conf: 'LOW', status: 'AVAILABLE' },
            { t: 0.2, h: '1M', p: 0.52, conf: 'MEDIUM', status: 'AVAILABLE' },
          ],
        },
      },
      {
        rank: 2,
        symbol: 'INFY',
        opportunityId: 'o2',
        sector: 'IT',
        intelligenceContext: {
          tradePlanRecommendation: 'REJECT',
          tradePlanExpectedR: -0.5,
          bullRunV2Cells: [{ t: 0.2, h: '3M', p: 0.4, conf: 'LOW', status: 'AVAILABLE' }],
        },
      },
    ];
    const report = buildBatchResearchReport({
      batchId: 'IBATCH-2',
      completedAt: Date.now(),
      universe: 'NIFTY50',
      coverage: { total: 2, processed: 2, failed: 0 },
      rankings,
    });
    const tcs = report.opportunities?.find((o) => o.symbol === 'TCS');
    const infy = report.opportunities?.find((o) => o.symbol === 'INFY');
    expect(tcs?.prob1W20).toBeCloseTo(0.33);
    expect(tcs?.prob1M20).toBeCloseTo(0.52);
    expect(tcs?.opportunityQuality).toBe('HIGH');
    expect(tcs?.price).toBe(3500);
    expect(infy?.prob1W20).toBeNull();
    expect(infy?.prob1M20).toBeNull();
    expect(report.dashboardSummary?.avoid).toBe(1);
    expect(report.expectedRHistogram?.find((b) => b.id === '1_2')?.count).toBe(1);
    expect(report.expectedRHistogram?.find((b) => b.id === 'neg1_0')?.count).toBe(1);
    expect(report.expectedRCoverage).toEqual({ withExpectedR: 2, missing: 0 });
  });

  it('computes vsPrevious deltas from prior same-universe report only', () => {
    const rankings: IntelligenceBatchResultRow[] = [
      {
        rank: 1,
        symbol: 'TCS',
        opportunityId: 'o1',
        sector: 'IT',
        intelligenceContext: {
          tradePlanRecommendation: 'APPROVE',
          intelligenceLifecycleState: 'OPPORTUNITY',
          opportunityQuality: 'HIGH',
        },
      },
      {
        rank: 2,
        symbol: 'INFY',
        opportunityId: 'o2',
        sector: 'IT',
        intelligenceContext: { tradePlanRecommendation: 'WAIT' },
      },
      {
        rank: 3,
        symbol: 'WIPRO',
        opportunityId: 'o3',
        sector: 'IT',
        intelligenceContext: { tradePlanRecommendation: 'REJECT' },
      },
    ];
    const prior = buildBatchResearchReport({
      batchId: 'IBATCH-PRIOR',
      completedAt: 1,
      universe: 'NIFTY50',
      coverage: { total: 2, processed: 2, failed: 0 },
      rankings: rankings.slice(0, 2),
    });
    const current = buildBatchResearchReport({
      batchId: 'IBATCH-CUR',
      completedAt: 2,
      universe: 'NIFTY50',
      coverage: { total: 3, processed: 3, failed: 0 },
      rankings,
      priorReport: prior,
    });
    expect(current.dashboardSummary?.vsPrevious).toMatchObject({
      available: true,
      priorBatchId: 'IBATCH-PRIOR',
      deltaTotal: 1,
      deltaActionable: 0,
      deltaWatchlist: 0,
      deltaAvoid: 1,
    });
    const compared = compareBatchResearchReports(current, prior);
    expect(compared.available).toBe(true);
    expect(compared.deltas.deltaAvoid).toBe(1);
    const wrongUniverse = buildBatchResearchReport({
      batchId: 'IBATCH-OTHER',
      completedAt: 1,
      universe: 'NIFTY100',
      coverage: { total: 2, processed: 2, failed: 0 },
      rankings: rankings.slice(0, 2),
    });
    const blocked = compareBatchResearchReports(current, wrongUniverse);
    expect(blocked.available).toBe(false);
    expect(blocked.reason).toBe('NO_PRIOR_SAME_UNIVERSE');
  });

  it('Best Pick order is identical with/without/partial Bull-Run cells', () => {
    type Cell = {
      t: number;
      h: '3M' | '1D';
      p: number;
      conf: 'HIGH' | 'MEDIUM' | 'LOW';
      status: 'AVAILABLE';
    };
    const makeRows = (mode: 'full' | 'none' | 'partial'): IntelligenceBatchResultRow[] => [
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
                bullRunV2Cells: [
                  { t: 0.1, h: '3M', p: 0.8, conf: 'HIGH', status: 'AVAILABLE' },
                  ...(mode === 'full'
                    ? [
                        {
                          t: 0.2,
                          h: '3M' as const,
                          p: 0.6,
                          conf: 'MEDIUM' as const,
                          status: 'AVAILABLE' as const,
                        },
                      ]
                    : []),
                ] as Cell[],
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
          ...(mode === 'none'
            ? {}
            : {
                bullRunV2Cells: [
                  {
                    t: 0.1,
                    h: mode === 'partial' ? '1D' : '3M',
                    p: 0.4,
                    conf: 'LOW',
                    status: 'AVAILABLE',
                  },
                ] as Cell[],
              }),
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

    const pickSyms = (mode: 'full' | 'none' | 'partial') => {
      const r = buildBatchResearchReport({
        batchId: `b-${mode}`,
        completedAt: 1,
        universe: 'NIFTY50',
        coverage: { total: 3, processed: 3, failed: 0 },
        rankings: makeRows(mode),
      });
      return (r.bestPicks ?? []).map((p) => `${p.rank}:${p.symbol}`);
    };

    expect(pickSyms('full')).toEqual(['1:TCS', '2:INFY']);
    expect(pickSyms('none')).toEqual(['1:TCS', '2:INFY']);
    expect(pickSyms('partial')).toEqual(['1:TCS', '2:INFY']);
  });

  it('NO_SUITABLE_OPPORTUNITY when no approve and no bull candidates', () => {
    const report = buildBatchResearchReport({
      batchId: 'IBATCH-2',
      completedAt: Date.now(),
      universe: 'NIFTY50',
      coverage: { total: 1, processed: 1, failed: 0 },
      rankings: [
        {
          rank: 1,
          symbol: 'XYZ',
          opportunityId: 'o',
          intelligenceContext: { tradePlanRecommendation: 'REJECT' },
        },
      ],
    });
    expect(report.outcome).toBe('NO_SUITABLE_OPPORTUNITY');
  });
});
