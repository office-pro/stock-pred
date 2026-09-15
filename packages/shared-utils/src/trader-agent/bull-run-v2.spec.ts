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
import { buildBatchResearchReport } from './batch-research-report';
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
          bullRunStage: 'CONFIRMED',
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
    expect(report.dataQuality.fabricated).toBe(0);
    expect(report.bestOpportunities[0]?.symbol).toBe('TCS');
    expect(report.bestOpportunities[0]?.rank).toBe(1);
    expect(report.disclaimer.toLowerCase()).toContain('not guarantees');
    const c3m20 = report.bullRunCountsByHorizon.find(
      (c) => c.horizon === '3M' && c.targetReturn === 0.2,
    );
    expect(c3m20?.candidateCount).toBe(2);
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
