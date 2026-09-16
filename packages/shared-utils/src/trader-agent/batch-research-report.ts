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
  BatchResearchReportDashboardSummary,
  BatchResearchReportExpectedRBin,
  BatchResearchReportExpectedRCoverage,
  BatchResearchReportHorizonMatrix,
  BatchResearchReportIntegritySummary,
  BatchResearchReportSectorOpportunityCount,
  BatchResearchReportSectorSummary,
  BatchResearchReportVsPrevious,
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
import { evidenceFromAdvisoryLabels, validateEvidencePackage } from './evidence-validation-layer';

export interface BuildBatchResearchReportInput {
  batchId: string;
  completedAt: number;
  universe: string;
  coverage: { total: number; processed: number; failed: number };
  rankings: IntelligenceBatchResultRow[];
  dataStatus?: BullRunDataStatus;
  dataAsOf?: number | string | null;
  marketRegime?: string | null;
  /** Breadth from the same finalize market-context fetch — never invent. */
  marketBreadth?: string | null;
  /**
   * Optional prior same-universe research report for KPI deltas.
   * Must be a stored BatchResearchReport — never fabricate deltas.
   */
  priorReport?: BatchResearchReport | null;
  /**
   * Optional MDS sector leaders/laggards snapped at finalize (batch-as-of).
   * Keys are uppercased sector names; values are symbol lists.
   */
  sectorLeadersBySector?: Record<string, { leaders?: string[]; laggards?: string[] }>;
}

/** Signed KPI deltas from two dashboard summaries — batch-owned only. */
export function buildVsPreviousFromReports(
  current: Pick<
    BatchResearchReportDashboardSummary,
    'total' | 'actionable' | 'watchlist' | 'avoid'
  >,
  priorReport: BatchResearchReport | null | undefined,
  opts?: { expectedUniverse?: string },
): BatchResearchReportVsPrevious {
  if (!priorReport) {
    return { available: false, reason: 'NO_PRIOR_SAME_UNIVERSE' };
  }
  if (opts?.expectedUniverse && String(priorReport.universe) !== String(opts.expectedUniverse)) {
    return { available: false, reason: 'NO_PRIOR_SAME_UNIVERSE' };
  }
  const prior = priorReport.dashboardSummary;
  if (!prior) {
    return {
      available: false,
      priorBatchId: priorReport.batchId,
      priorCompletedAt: priorReport.completedAt,
      reason: 'PRIOR_SUMMARY_MISSING',
    };
  }
  return {
    available: true,
    priorBatchId: priorReport.batchId,
    priorCompletedAt: priorReport.completedAt,
    deltaTotal: current.total - prior.total,
    deltaActionable: current.actionable - prior.actionable,
    deltaWatchlist: current.watchlist - prior.watchlist,
    deltaAvoid: current.avoid - prior.avoid,
  };
}

/** Compare payload for GET research-report/compare — derived from two stored reports only. */
export function compareBatchResearchReports(
  current: BatchResearchReport,
  prior: BatchResearchReport | null,
): {
  available: boolean;
  priorBatchId?: string;
  priorCompletedAt?: number;
  current: BatchResearchReportDashboardSummary | null;
  prior: BatchResearchReportDashboardSummary | null;
  deltas: BatchResearchReportVsPrevious;
  reason?: string;
} {
  const currentSummary = current.dashboardSummary ?? null;
  if (!currentSummary) {
    return {
      available: false,
      current: null,
      prior: prior?.dashboardSummary ?? null,
      deltas: { available: false, reason: 'CURRENT_SUMMARY_MISSING' },
      reason: 'CURRENT_SUMMARY_MISSING',
    };
  }
  const deltas = buildVsPreviousFromReports(currentSummary, prior, {
    expectedUniverse: current.universe,
  });
  return {
    available: deltas.available,
    priorBatchId: deltas.priorBatchId,
    priorCompletedAt: deltas.priorCompletedAt,
    current: currentSummary,
    prior: prior?.dashboardSummary ?? null,
    deltas,
    reason: deltas.reason,
  };
}

const DISCLAIMER =
  'Probabilities are model estimates derived from forward-return distributions and historical evidence, not guarantees. Offline/stale analysis is not execution readiness. Column values are P(max forward return within horizon ≥ target), not predicted returns.';

const CALIBRATION_NOTE =
  'Bull-Run cell calibration: Not available (engine does not populate hit-rate calibration). Sample size on live MDS cells is historical window count, not a live hit rate.';

const COMMAND_CENTER_PROB_TARGET = 0.2;

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

/** AVAILABLE cell p for horizon+target; null when missing — never invent 0. */
export function cellProbabilityAt(
  cells: NonNullable<
    NonNullable<IntelligenceBatchResultRow['intelligenceContext']>['bullRunV2Cells']
  >,
  horizon: BullRunCalendarHorizon,
  targetReturn: number,
): number | null {
  const hit = cells.find(
    (c) =>
      c.h === horizon &&
      Math.abs(c.t - targetReturn) < 1e-9 &&
      (c.status == null || c.status === 'AVAILABLE') &&
      c.p != null &&
      Number.isFinite(c.p),
  );
  return hit?.p ?? null;
}

function expectedRBinId(r: number): BatchResearchReportExpectedRBin['id'] {
  if (r < -1) return 'lt_neg1';
  if (r < 0) return 'neg1_0';
  if (r < 1) return '0_1';
  if (r <= 2) return '1_2';
  return 'gt_2';
}

const EXPECTED_R_BIN_META: Array<{
  id: BatchResearchReportExpectedRBin['id'];
  label: string;
}> = [
  { id: 'lt_neg1', label: '<-1R' },
  { id: 'neg1_0', label: '-1R…0' },
  { id: '0_1', label: '0…1R' },
  { id: '1_2', label: '1R…2R' },
  { id: 'gt_2', label: '>2R' },
];

function projectOpportunityRow(
  row: IntelligenceBatchResultRow,
): BatchResearchReportBestOpportunity {
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
  const evidencePkg = validateEvidencePackage({
    items: evidenceFromAdvisoryLabels({
      sector: ctx.sectorState ?? ctx.sectorFit ?? null,
      rs: ctx.rsBucket ?? null,
      regime: ctx.regimeCombo ?? null,
      mlDirection: ctx.mlDirection ?? null,
      fundamental: ctx.fundamentalScore ?? null,
      catalyst: ctx.eventRisk ?? null,
      historicalStatus: 'UNAVAILABLE',
      historicalSampleSize: null,
      bullRunStage: ctx.bullRunStage ?? null,
      bullRunProbability: ctx.bullRunProbability3m ?? null,
      integrity: integrity ?? null,
      globalImpact: ctx.globalEventImpact ?? null,
      fnoStatus: ctx.fnoStatus ?? null,
    }),
  });
  const price = row.price != null && Number.isFinite(row.price) && row.price > 0 ? row.price : null;
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
    evidenceQuality: evidencePkg.evidenceQuality,
    opportunityQuality: ctx.opportunityQuality,
    prob1W20: cellProbabilityAt(cells, '1W', COMMAND_CENTER_PROB_TARGET),
    prob1M20: cellProbabilityAt(cells, '1M', COMMAND_CENTER_PROB_TARGET),
    price,
    conflictSummary: evidencePkg.conflictSummary,
    supportingEvidence: evidencePkg.supportingEvidence.map((e) => e.engine),
    conflictingEvidence: evidencePkg.conflictingEvidence.map((e) => e.engine),
    missingEvidence: evidencePkg.missingEvidence.map((e) => e.engine),
    historicalStatus: 'UNAVAILABLE',
    historicalSampleSize: null,
    historicalNote:
      'Historical analogues require candle series at stock detail / MDS refresh. Batch report does not invent matches. Min sample threshold applies.',
  };
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

  let actionable = 0;
  let watchlist = 0;
  let avoid = 0;
  let unspecified = 0;
  let withExpectedR = 0;
  let missingExpectedR = 0;
  const sectorOppMap = new Map<string, number>();
  const expectedRCounts: Record<BatchResearchReportExpectedRBin['id'], number> = {
    lt_neg1: 0,
    neg1_0: 0,
    '0_1': 0,
    '1_2': 0,
    gt_2: 0,
  };

  for (const row of rankings) {
    const ctx = row.intelligenceContext ?? {};
    const sector = String(row.sector || 'UNCLASSIFIED').toUpperCase();
    const entry = sectorMap.get(sector) ?? {
      sector,
      state: ctx.sectorState,
      memberCount: 0,
      bullCandidates: 0,
      leaders: [] as string[],
      laggards: [] as string[],
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

    sectorOppMap.set(sector, (sectorOppMap.get(sector) ?? 0) + 1);
    const rec = ctx.tradePlanRecommendation;
    if (rec === 'APPROVE') actionable += 1;
    else if (rec === 'WAIT') watchlist += 1;
    else if (rec === 'REJECT') avoid += 1;
    else unspecified += 1;
    const er = ctx.tradePlanExpectedR;
    if (er != null && Number.isFinite(er)) {
      expectedRCounts[expectedRBinId(er)] += 1;
      withExpectedR += 1;
    } else {
      missingExpectedR += 1;
    }
  }

  // Batch-owned leaders/laggards: best/worst RankingContext rank within sector (top/bottom 3).
  const bySectorRows = new Map<string, IntelligenceBatchResultRow[]>();
  for (const row of rankings) {
    const sector = String(row.sector || 'UNCLASSIFIED').toUpperCase();
    const list = bySectorRows.get(sector) ?? [];
    list.push(row);
    bySectorRows.set(sector, list);
  }
  for (const [sector, rows] of bySectorRows) {
    const entry = sectorMap.get(sector);
    if (!entry) continue;
    const sortedRows = [...rows].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    entry.leaders = sortedRows.slice(0, 3).map((r) => r.symbol);
    entry.laggards = sortedRows
      .slice(Math.max(0, sortedRows.length - 3))
      .reverse()
      .map((r) => r.symbol);
    const overlay = input.sectorLeadersBySector?.[sector];
    if (overlay?.leaders?.length) entry.leaders = overlay.leaders.slice(0, 5);
    if (overlay?.laggards?.length) entry.laggards = overlay.laggards.slice(0, 5);
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
  const opportunities: BatchResearchReportBestOpportunity[] = sorted.map(projectOpportunityRow);
  const bestOpportunities = opportunities.slice(0, 50);
  const bestPicks = opportunities.filter((o) => o.isBestPick);

  const sectorOpportunityCounts: BatchResearchReportSectorOpportunityCount[] = [
    ...sectorOppMap.entries(),
  ]
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));

  const expectedRHistogram: BatchResearchReportExpectedRBin[] = EXPECTED_R_BIN_META.map((b) => ({
    id: b.id,
    label: b.label,
    count: expectedRCounts[b.id],
  }));

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

  const hasApprove = opportunities.some((o) => o.recommendation === 'APPROVE');
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

  const dashboardBase = {
    total: rankings.length,
    actionable,
    watchlist,
    avoid,
  };
  const vsPrevious = buildVsPreviousFromReports(dashboardBase, input.priorReport, {
    expectedUniverse: input.universe,
  });
  const expectedRCoverage: BatchResearchReportExpectedRCoverage = {
    withExpectedR,
    missing: missingExpectedR,
  };

  const breadthNote =
    input.marketBreadth != null && String(input.marketBreadth).trim()
      ? String(input.marketBreadth).trim()
      : undefined;

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
      ? {
          regime: input.marketRegime,
          note: 'From existing TI market context when present.',
          ...(breadthNote ? { breadth: breadthNote } : {}),
        }
      : {
          note: 'Market regime Not available for this batch.',
          ...(breadthNote ? { breadth: breadthNote } : {}),
        },
    sectorSummary,
    sectorRotation: rotation,
    bullRunSummary: {
      stagesPresent: stages,
      note: 'Bull-Run counts use AVAILABLE Target×Horizon cells only (p≥0.5). Best Picks use RankingContext, not Bull-Run sort.',
    },
    bullRunCountsByHorizon,
    bestOpportunities,
    bestPicks,
    opportunities,
    dashboardSummary: {
      ...dashboardBase,
      vsPrevious,
    },
    recommendationDistribution: {
      approve: actionable,
      wait: watchlist,
      reject: avoid,
      unspecified,
    },
    sectorOpportunityCounts,
    expectedRHistogram,
    expectedRCoverage,
    bullRunOpportunities,
    integritySummary,
    calibrationNote: CALIBRATION_NOTE,
    predictionImprovementNote:
      'IMPROVEMENT NOT VERIFIED — historical intelligence attached as evidence does not by itself prove better predictions without matched walk-forward comparison.',
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
      featureVersion: 'batch-research-report.dashboard.v2',
    }),
    disclaimer: DISCLAIMER,
  };
}
