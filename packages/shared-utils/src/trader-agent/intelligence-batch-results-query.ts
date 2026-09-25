/**
 * Batch discovery results query — filter/paginate/preset over stored RankingContext rows.
 * Presentation sorts never mutate RankingContext rank or authorization.
 * Missing values sort last for both ASC and DESC (never treat missing as 0).
 */

import type {
  IntelligenceBatchContextLabels,
  IntelligenceBatchProgressDiagnostics,
  IntelligenceBatchResultRow,
  IntelligenceBatchResults,
  IntelligenceBatchResultsPage,
  IntelligenceBatchResultsPreset,
  IntelligenceBatchResultsQuery,
  IntelligenceBatchResultsSort,
  IntelligencePipelineStageProgress,
  BatchIdentityStatus,
} from '@stockpred/shared-types';
import { isBestOpportunityRow } from './batch-research-report';

export function resolveBatchCanonicalIdentity(input: {
  taskSymbol: string;
  analysisSymbol?: string | null;
  quote?: {
    symbol?: string;
    name?: string;
    exchange?: string;
    price?: number;
  } | null;
}): {
  symbol: string;
  identityStatus: BatchIdentityStatus;
  companyName?: string;
  exchange?: string;
  price?: number;
} {
  const canonical = String(input.taskSymbol ?? '')
    .trim()
    .toUpperCase();
  if (!canonical || canonical === 'UNKNOWN') {
    return { symbol: canonical || 'UNKNOWN', identityStatus: 'UNKNOWN_QUOTE' };
  }

  const analysisSym = String(input.analysisSymbol ?? '')
    .trim()
    .toUpperCase();
  const quoteSym = String(input.quote?.symbol ?? '')
    .trim()
    .toUpperCase();

  let identityStatus: BatchIdentityStatus = 'VALID';
  if (!input.quote) {
    identityStatus = 'UNKNOWN_QUOTE';
  } else if (
    (analysisSym && analysisSym !== 'UNKNOWN' && analysisSym !== canonical) ||
    (quoteSym && quoteSym !== 'UNKNOWN' && quoteSym !== canonical)
  ) {
    identityStatus = 'MISMATCH';
  } else if (!quoteSym || quoteSym === 'UNKNOWN') {
    identityStatus = 'UNKNOWN_QUOTE';
  }

  const companyName = input.quote?.name?.trim() || undefined;
  const exchange = input.quote?.exchange ? String(input.quote.exchange) : undefined;
  const price =
    input.quote?.price != null && Number.isFinite(input.quote.price) && input.quote.price > 0
      ? input.quote.price
      : undefined;

  return { symbol: canonical, identityStatus, companyName, exchange, price };
}

function expectedReturnSortValue(ctx: IntelligenceBatchContextLabels | undefined): number | null {
  if (!ctx) return null;
  const low = ctx.expectedReturnLow;
  const high = ctx.expectedReturnHigh;
  if (low != null && high != null && Number.isFinite(low) && Number.isFinite(high)) {
    return (low + high) / 2;
  }
  if (high != null && Number.isFinite(high)) return high;
  if (low != null && Number.isFinite(low)) return low;
  return null;
}

function matchesPreset(
  row: IntelligenceBatchResultRow,
  preset: IntelligenceBatchResultsPreset,
): boolean {
  const ctx = row.intelligenceContext;
  switch (preset) {
    case 'BEST_OPPORTUNITIES':
      return isBestOpportunityRow(row);
    case 'HIGH_CONFIDENCE':
      return ctx?.opportunityQuality === 'HIGH';
    case 'MULTI_HORIZON_ALIGNED':
      return ctx?.horizonAgreement === 'HIGH';
    case 'HIGHEST_EXPECTED_RETURN':
    case 'HIGHEST_EXPECTED_R':
      return true;
    case 'BULL_RUN': {
      const stage = ctx?.bullRunStage;
      if (!stage || stage === 'UNKNOWN') return false;
      return (
        stage === 'EARLY' || stage === 'ACCELERATING' || stage === 'CONFIRMED' || stage === 'MATURE'
      );
    }
    default:
      return true;
  }
}

type CompactBullCell = NonNullable<IntelligenceBatchContextLabels['bullRunV2Cells']>[number];

/** Find AVAILABLE cell matching optional target/horizon/conf — display/filter only. */
export function matchBullRunV2Cell(
  ctx: IntelligenceBatchContextLabels | undefined,
  opts: {
    targetReturn?: number;
    horizon?: '1D' | '1W' | '1M' | '3M' | '6M' | '12M';
    bullRunConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  },
): CompactBullCell | undefined {
  const cells = ctx?.bullRunV2Cells;
  if (!Array.isArray(cells) || cells.length === 0) return undefined;
  return cells.find((c) => {
    if (c.status != null && c.status !== 'AVAILABLE') return false;
    if (opts.targetReturn != null && Number.isFinite(opts.targetReturn)) {
      if (Math.abs(c.t - opts.targetReturn) > 1e-9) return false;
    }
    if (opts.horizon && c.h !== opts.horizon) return false;
    if (opts.bullRunConfidence && c.conf !== opts.bullRunConfidence) return false;
    return Number.isFinite(c.p);
  });
}

function parseCsvBands(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

function matchesDiscoveryFilters(
  row: IntelligenceBatchResultRow,
  query: IntelligenceBatchResultsQuery,
): boolean {
  const ctx = row.intelligenceContext;
  const needsCell =
    query.targetReturn != null || query.horizon != null || query.bullRunConfidence != null;

  if (needsCell) {
    const cell = matchBullRunV2Cell(ctx, {
      targetReturn: query.targetReturn,
      horizon: query.horizon,
      bullRunConfidence: query.bullRunConfidence,
    });
    if (!cell) return false;
  }

  if (query.bullRunStage) {
    const allowed = parseCsvBands(query.bullRunStage);
    const stage = String(ctx?.bullRunStage ?? '').toUpperCase();
    if (!stage || !allowed.has(stage)) return false;
  }

  if (query.integrityStatus) {
    if (ctx?.integrityStatus !== query.integrityStatus) return false;
  }

  const exclude = parseCsvBands(query.excludeIntegrity);
  if (exclude.size > 0 && ctx?.integrityStatus && exclude.has(ctx.integrityStatus)) {
    return false;
  }

  if (query.executionReady === true && ctx?.tradePlanExecutionReady !== true) return false;
  if (query.executionReady === false && ctx?.tradePlanExecutionReady !== false) return false;

  if (query.dataStatus) {
    if (ctx?.bullRunDataStatus !== query.dataStatus) return false;
  }

  if (query.sector?.trim()) {
    const want = query.sector.trim().toUpperCase();
    const got = String(row.sector ?? '').toUpperCase();
    if (!got || got !== want) return false;
  }

  return true;
}

/** Returns null when the sort key is missing (must sort last). */
function presentationSortValue(
  row: IntelligenceBatchResultRow,
  sort: IntelligenceBatchResultsSort,
): number | string | null {
  const ctx = row.intelligenceContext;
  switch (sort) {
    case 'expectedReturn':
      return expectedReturnSortValue(ctx);
    case 'upsideProb':
      return ctx?.upsideProbability != null && Number.isFinite(ctx.upsideProbability)
        ? ctx.upsideProbability
        : null;
    case 'expectedR':
      return ctx?.tradePlanExpectedR != null && Number.isFinite(ctx.tradePlanExpectedR)
        ? ctx.tradePlanExpectedR
        : null;
    case 'confidence':
      return ctx?.tradePlanConfidence != null && Number.isFinite(ctx.tradePlanConfidence)
        ? ctx.tradePlanConfidence
        : null;
    case 'preferredEntry':
      return ctx?.preferredEntry != null && Number.isFinite(ctx.preferredEntry)
        ? ctx.preferredEntry
        : ctx?.buyZoneLow != null && Number.isFinite(ctx.buyZoneLow)
          ? ctx.buyZoneLow
          : null;
    case 'target':
      return ctx?.target1 != null && Number.isFinite(ctx.target1) ? ctx.target1 : null;
    case 'direction':
      return ctx?.tradePlanDirection ?? null;
    case 'horizon':
      return ctx?.tradePlanHorizon ?? null;
    case 'recommendation':
      return ctx?.tradePlanRecommendation ?? null;
    case 'symbol':
      return row.symbol;
    case 'rank':
    default:
      return row.rank;
  }
}

/**
 * Comparator: real values ordered by order; missing always last; tie-break canonical rank ASC.
 */
export function compareBatchResultRows(
  a: IntelligenceBatchResultRow,
  b: IntelligenceBatchResultRow,
  sort: IntelligenceBatchResultsSort,
  order: 'asc' | 'desc',
): number {
  if (sort === 'rank') {
    return order === 'asc' ? a.rank - b.rank : b.rank - a.rank;
  }
  const va = presentationSortValue(a, sort);
  const vb = presentationSortValue(b, sort);
  const aMissing = va == null || va === '';
  const bMissing = vb == null || vb === '';
  if (aMissing && bMissing) return a.rank - b.rank;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp = 0;
  if (typeof va === 'string' && typeof vb === 'string') {
    cmp = va.localeCompare(vb);
  } else {
    cmp = (va as number) - (vb as number);
  }
  if (cmp === 0) return a.rank - b.rank;
  return order === 'asc' ? cmp : -cmp;
}

export function queryIntelligenceBatchResultsPage(
  results: IntelligenceBatchResults,
  query: IntelligenceBatchResultsQuery = {},
  stages?: IntelligencePipelineStageProgress[],
  diagnostics?: IntelligenceBatchProgressDiagnostics,
): IntelligenceBatchResultsPage {
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
  const page = Math.max(1, query.page ?? 1);
  const preset = query.preset ?? null;

  const anyBullRunEvidence = results.rankings.some((r) => {
    const stage = r.intelligenceContext?.bullRunStage;
    return stage != null && stage !== '' && stage !== 'UNKNOWN';
  });

  if (preset === 'BULL_RUN' && !anyBullRunEvidence) {
    return {
      batchId: results.batchId,
      rankings: [],
      total: 0,
      page: 1,
      pageSize,
      sort: 'rank',
      order: 'asc',
      defaultSort: 'rank',
      rankingContextVersion: results.rankingEngineVersion,
      bullRunAvailable: false,
      preset: 'BULL_RUN',
      stages,
      diagnostics,
      generatedAt: results.generatedAt,
      dataAsOf: results.dataAsOf,
      dataStatus: results.dataStatus,
    };
  }

  let rows = [...results.rankings];

  if (preset) {
    rows = rows.filter((r) => matchesPreset(r, preset));
  }

  const q = query.q?.trim().toUpperCase();
  if (q) {
    rows = rows.filter((r) => {
      const name = (r.companyName ?? '').toUpperCase();
      return r.symbol.includes(q) || name.includes(q);
    });
  }

  if (query.recommendation) {
    rows = rows.filter(
      (r) => r.intelligenceContext?.tradePlanRecommendation === query.recommendation,
    );
  }

  if (query.thesisState) {
    rows = rows.filter((r) => r.intelligenceContext?.thesisState === query.thesisState);
  }

  if (query.mlAvailable) {
    rows = rows.filter(
      (r) =>
        r.intelligenceContext?.mlModelVersion != null || r.intelligenceContext?.mlDirection != null,
    );
  }

  rows = rows.filter((r) => matchesDiscoveryFilters(r, query));

  let sort: IntelligenceBatchResultsSort = query.sort ?? 'rank';
  let order: 'asc' | 'desc' =
    query.order ?? (sort === 'rank' || sort === 'symbol' ? 'asc' : 'desc');

  if (preset === 'HIGHEST_EXPECTED_RETURN') {
    sort = 'expectedReturn';
    order = 'desc';
  } else if (preset === 'HIGHEST_EXPECTED_R') {
    sort = 'expectedR';
    order = 'desc';
  }

  rows.sort((a, b) => compareBatchResultRows(a, b, sort, order));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const rankings = rows.slice(start, start + pageSize);

  return {
    batchId: results.batchId,
    rankings,
    total,
    page,
    pageSize,
    sort,
    order,
    defaultSort: 'rank',
    rankingContextVersion: results.rankingEngineVersion,
    bullRunAvailable: anyBullRunEvidence,
    preset,
    stages,
    diagnostics,
    generatedAt: results.generatedAt,
    dataAsOf: results.dataAsOf,
    dataStatus: results.dataStatus,
  };
}
