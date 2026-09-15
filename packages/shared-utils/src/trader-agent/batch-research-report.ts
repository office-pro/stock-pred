/**
 * BatchResearchReport v2 — backend-owned Command Center projection.
 * Aggregates only; never fabricates Bull-Run or ranking scores.
 * Best opportunities / Best Picks follow RankingContext order (canonical rank).
 * Bull-Run availability must not change Best Pick membership or order.
 */
import type {
  BatchResearchReport,
  BatchResearchReportBestOpportunity,
  BatchResearchReportBullRunCounts,
  BatchResearchReportBullRunOpportunity,
  BatchResearchReportHorizonMatrix,
  BatchResearchReportIntegritySummary,
  BatchResearchReportSectorSummary,
  BullRunCalendarHorizon,
  BullRunDataStatus,
  IntelligenceBatchResultRow,
} from '@stockpred/shared-types';
import {
  BULL_RUN_CALENDAR_HORIZONS,
  BULL_RUN_DEFAULT_TARGETS,
  COMMAND_CENTER_DEFAULT_HORIZON,
  COMMAND_CENTER_MATRIX_TARGETS,
} from '@stockpred/shared-types';
import { provenance } from './b9-b17-helpers';

export interface BuildBatchResearchReportInput {
  batchId: string;
  completedAt: number;
  universe: string;
  coverage: { total: number; processed: number; failed: number };
  rankings: IntelligenceBatchResultRow[];
  dataStatus?: BullRunDataStatus;
  dataAsOf?: number | string | null;
  marketRegime?: string | null;
}

const DISCLAIMER =
  'Probabilities are model estimates derived from forward-return distributions and historical evidence, not guarantees. Offline/stale analysis is not execution readiness. Column values are P(max forward return within horizon ≥ target), not predicted returns.';

const CALIBRATION_NOTE =
  'Bull-Run cell calibration: Not available (engine does not populate hit-rate calibration). Sample size on live MDS cells is historical window count, not a live hit rate.';

/** Same membership as preset=BEST_OPPORTUNITIES — independent of bullRunV2Cells. */
export function isBestOpportunityRow(row: IntelligenceBatchResultRow): boolean {
  const ctx = row.intelligenceContext;
  if (ctx?.tradePlanRecommendation !== 'APPROVE') return false;
  const life = ctx.intelligenceLifecycleState;
  return life === 'OPPORTUNITY' || life === 'SHORTLIST' || ctx.opportunityQuality != null;
}

function buildBullRunMatrix(
  cells: NonNullable<
    NonNullable<IntelligenceBatchResultRow['intelligenceContext']>['bullRunV2Cells']
  >,
): BatchResearchReportHorizonMatrix[] {
  const byH = new Map<BullRunCalendarHorizon, BatchResearchReportHorizonMatrix['cells']>();
  for (const h of BULL_RUN_CALENDAR_HORIZONS) {
    byH.set(h, []);
  }
  for (const c of cells) {
    if (!c?.h || c.t == null) continue;
    const list = byH.get(c.h as BullRunCalendarHorizon) ?? [];
    if (c.p != null && Number.isFinite(c.p) && (c.status == null || c.status === 'AVAILABLE')) {
      list.push({
        targetReturn: c.t,
        status: 'AVAILABLE',
        p: c.p,
        conf: c.conf,
      });
    }
    byH.set(c.h as BullRunCalendarHorizon, list);
  }
  // Fill matrixTargets gaps as UNAVAILABLE (UI → Not available; never 0).
  const out: BatchResearchReportHorizonMatrix[] = [];
  for (const h of BULL_RUN_CALENDAR_HORIZONS) {
    const present = byH.get(h) ?? [];
    const cellsOut = COMMAND_CENTER_MATRIX_TARGETS.map((t) => {
      const hit = present.find((c) => Math.abs(c.targetReturn - t) < 1e-9);
      if (hit) return hit;
      return { targetReturn: t, status: 'UNAVAILABLE' as const, p: null };
    });
    out.push({ horizon: h, cells: cellsOut });
  }
  return out;
}

export function buildBatchResearchReport(
  input: BuildBatchResearchReportInput,
): BatchResearchReport {
  const rankings = input.rankings ?? [];
  const sectorMap = new Map<string, BatchResearchReportSectorSummary>();
  let quoteGaps = 0;
  let incomplete = 0;
  let insufficientHistory = 0;
  const integritySummary: BatchResearchReportIntegritySummary = {
    normal: 0,
    investigate: 0,
    suspicious: 0,
    unknown: 0,
  };

  for (const row of rankings) {
    const ctx = row.intelligenceContext ?? {};
    const sector = String(row.sector || 'UNCLASSIFIED').toUpperCase();
    const entry = sectorMap.get(sector) ?? {
      sector,
      state: ctx.sectorState,
      memberCount: 0,
      bullCandidates: 0,
      leaders: [],
      laggards: [],
    };
    entry.memberCount += 1;
    if (ctx.sectorState && !entry.state) entry.state = ctx.sectorState;
    const hasBull =
      (ctx.bullRunStage && ctx.bullRunStage !== 'UNKNOWN') ||
      (Array.isArray(ctx.bullRunV2Cells) && ctx.bullRunV2Cells.length > 0);
    if (hasBull) entry.bullCandidates += 1;
    if (ctx.quoteStatus === 'MDS_UNAVAILABLE') quoteGaps += 1;
    if (ctx.tradePlanStatus === 'PARTIAL' || ctx.tradePlanStatus === 'UNAVAILABLE') {
      incomplete += 1;
    }
    if (
      (!Array.isArray(ctx.bullRunV2Cells) || ctx.bullRunV2Cells.length === 0) &&
      !ctx.bullRunStage
    ) {
      insufficientHistory += 1;
    }
    const integ = ctx.integrityStatus;
    if (integ === 'NORMAL') integritySummary.normal += 1;
    else if (integ === 'INVESTIGATE') integritySummary.investigate += 1;
    else if (integ === 'SUSPICIOUS') integritySummary.suspicious += 1;
    else integritySummary.unknown += 1;
    sectorMap.set(sector, entry);
  }

  const sectorSummary = [...sectorMap.values()].sort((a, b) => a.sector.localeCompare(b.sector));

  const rotation = {
    leading: sectorSummary.filter((s) => s.state === 'LEADING').map((s) => s.sector),
    improving: sectorSummary.filter((s) => s.state === 'IMPROVING').map((s) => s.sector),
    weakening: sectorSummary.filter((s) => s.state === 'WEAKENING').map((s) => s.sector),
    lagging: sectorSummary.filter((s) => s.state === 'LAGGING').map((s) => s.sector),
  };

  const countKey = (h: BullRunCalendarHorizon, t: number) => `${h}|${t}`;
  const counts = new Map<string, number>();
  for (const h of BULL_RUN_CALENDAR_HORIZONS) {
    for (const t of BULL_RUN_DEFAULT_TARGETS) {
      counts.set(countKey(h, t), 0);
    }
  }
  for (const row of rankings) {
    const cells = row.intelligenceContext?.bullRunV2Cells;
    if (!Array.isArray(cells)) continue;
    for (const c of cells) {
      if (c.p == null || !Number.isFinite(c.p)) continue;
      if (c.p >= 0.5) {
        const k = countKey(c.h, c.t);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  const bullRunCountsByHorizon: BatchResearchReportBullRunCounts[] = [];
  for (const h of BULL_RUN_CALENDAR_HORIZONS) {
    for (const t of BULL_RUN_DEFAULT_TARGETS) {
      bullRunCountsByHorizon.push({
        horizon: h,
        targetReturn: t,
        candidateCount: counts.get(countKey(h, t)) ?? 0,
      });
    }
  }

  const sorted = [...rankings].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const bestOpportunities: BatchResearchReportBestOpportunity[] = sorted.slice(0, 50).map((row) => {
    const ctx = row.intelligenceContext ?? {};
    const cells = ctx.bullRunV2Cells ?? [];
    const preferred =
      cells.find((c) => c.h === '3M' && c.t === 0.2 && c.p != null) ??
      cells.find((c) => c.p != null) ??
      null;
    const integrity =
      ctx.integrityStatus === 'NORMAL' ||
      ctx.integrityStatus === 'INVESTIGATE' ||
      ctx.integrityStatus === 'SUSPICIOUS'
        ? ctx.integrityStatus
        : undefined;
    return {
      symbol: row.symbol,
      rank: row.rank,
      companyName: row.companyName,
      sector: row.sector,
      recommendation: ctx.tradePlanRecommendation,
      tradePlanStatus: ctx.tradePlanStatus,
      tradePlanExecutionReady: ctx.tradePlanExecutionReady,
      bullRunStage: ctx.bullRunStage,
      isBestPick: isBestOpportunityRow(row),
      integrityStatus: integrity,
      targetReturn: preferred?.t,
      horizon: preferred?.h,
      probability: preferred?.p ?? null,
      confidence: preferred?.conf,
      bullRunMatrix: buildBullRunMatrix(cells),
      thesis: ctx.thesis,
      tradePlanExpectedR: ctx.tradePlanExpectedR,
      tradePlanHorizon: ctx.tradePlanHorizon,
      invalidationPrice: ctx.invalidationPrice,
    };
  });

  const bestPicks = bestOpportunities.filter((o) => o.isBestPick);

  const bullRunOpportunities: BatchResearchReportBullRunOpportunity[] = [];
  for (const row of sorted) {
    const ctx = row.intelligenceContext ?? {};
    const cells = ctx.bullRunV2Cells ?? [];
    const integrity =
      ctx.integrityStatus === 'NORMAL' ||
      ctx.integrityStatus === 'INVESTIGATE' ||
      ctx.integrityStatus === 'SUSPICIOUS'
        ? ctx.integrityStatus
        : undefined;
    for (const c of cells) {
      if (c.p == null || !Number.isFinite(c.p)) continue;
      if (c.status != null && c.status !== 'AVAILABLE') continue;
      bullRunOpportunities.push({
        symbol: row.symbol,
        rank: row.rank,
        sector: row.sector,
        targetReturn: c.t,
        horizon: c.h,
        probability: c.p,
        confidence: c.conf,
        integrityStatus: integrity,
        recommendation: ctx.tradePlanRecommendation,
        tradePlanExecutionReady: ctx.tradePlanExecutionReady,
        isBestPick: isBestOpportunityRow(row),
      });
    }
  }

  const hasApprove = bestOpportunities.some((o) => o.recommendation === 'APPROVE');
  const anyBullCandidate = bullRunCountsByHorizon.some((c) => c.candidateCount > 0);
  const finalOutcome =
    input.coverage.failed > 0 && input.coverage.processed < input.coverage.total
      ? 'PARTIAL_COVERAGE'
      : !hasApprove && !anyBullCandidate
        ? 'NO_SUITABLE_OPPORTUNITY'
        : 'HAS_OPPORTUNITIES';

  const stages = [
    ...new Set(
      rankings
        .map((r) => r.intelligenceContext?.bullRunStage)
        .filter((s): s is string => !!s && s !== 'UNKNOWN'),
    ),
  ];

  return {
    schemaVersion: 'batch-research-report.v2',
    batchId: input.batchId,
    completedAt: input.completedAt,
    universe: input.universe,
    coverage: input.coverage,
    outcome: finalOutcome,
    commandCenterHorizon: COMMAND_CENTER_DEFAULT_HORIZON,
    matrixTargets: [...COMMAND_CENTER_MATRIX_TARGETS],
    marketSummary: input.marketRegime
      ? { regime: input.marketRegime, note: 'From existing TI market context when present.' }
      : { note: 'Market regime Not available for this batch.' },
    sectorSummary,
    sectorRotation: rotation,
    bullRunSummary: {
      stagesPresent: stages,
      note: 'Bull-Run counts use AVAILABLE Target×Horizon cells only (p≥0.5). Best Picks use RankingContext, not Bull-Run sort.',
    },
    bullRunCountsByHorizon,
    bestOpportunities,
    bestPicks,
    bullRunOpportunities,
    integritySummary,
    calibrationNote: CALIBRATION_NOTE,
    dataQuality: {
      analyzed: rankings.length,
      incomplete,
      quoteGaps,
      providerGaps: 0,
      insufficientHistory,
      fabricated: 0,
    },
    dataAsOf: input.dataAsOf,
    dataStatus: input.dataStatus ?? 'UNKNOWN',
    provenance: provenance('batch-research-report', {
      dataAsOf: input.dataAsOf ?? undefined,
      dataStatus: input.dataStatus,
      sampleSize: rankings.length,
      modelVersion: 'batch-research-report.v2',
    }),
    disclaimer: DISCLAIMER,
  };
}
