/**
 * Research Reports — Command Center projection from BatchResearchReport (backend-owned).
 * Never fabricates rankings, probabilities, KPI deltas, or prices.
 */
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState, type ReactNode } from 'react';
import {
  useGetBatchResearchReportCompareQuery,
  useGetBatchResearchReportQuery,
  useGetLatestBatchResearchReportQuery,
  useListIntelligenceBatchesQuery,
  useRebuildBatchResearchReportMutation,
} from '../store/api';
import OpportunityDetailPanel from '../components/OpportunityDetailPanel';
import { formatProbabilityPercent } from '../lib/bull-run-display';
import { displayRecommendation } from '../lib/multi-asset-batch';

const CARD_BG = '#151921';
const PAGE_BG = '#0A0E14';
const BORDER = 'rgba(148, 163, 184, 0.16)';
const ACCENT = {
  purple: '#8B5CF6',
  green: '#10B981',
  amber: '#F59E0B',
  rose: '#EF4444',
  blue: '#3B82F6',
  slate: '#94A3B8',
};

type ReportPick = {
  symbol: string;
  rank: number;
  companyName?: string;
  sector?: string;
  recommendation?: string;
  tradePlanExecutionReady?: boolean;
  confidence?: string;
  tradePlanStatus?: string;
  isBestPick?: boolean;
  integrityStatus?: string;
  bullRunMatrix?: Array<{
    horizon: string;
    cells: Array<{ targetReturn: number; status: string; p?: number | null; conf?: string }>;
  }>;
  thesis?: string;
  tradePlanExpectedR?: number;
  tradePlanHorizon?: string;
  invalidationPrice?: number;
  evidenceQuality?: string;
  opportunityQuality?: string;
  prob1W20?: number | null;
  prob1M20?: number | null;
  price?: number | null;
  conflictSummary?: string;
  supportingEvidence?: string[];
  conflictingEvidence?: string[];
  missingEvidence?: string[];
  historicalStatus?: string;
  historicalSampleSize?: number | null;
  historicalNote?: string;
};

type SectionTab =
  | 'opportunities'
  | 'insights'
  | 'sectors'
  | 'picks'
  | 'risk'
  | 'batch'
  | 'download';

function recDisplay(rec: string | undefined): string {
  return displayRecommendation(rec);
}

function recColor(rec: string | undefined): 'success' | 'warning' | 'error' | 'default' {
  const r = String(rec ?? '').toUpperCase();
  if (r === 'APPROVE' || r === 'BUY') return 'success';
  if (r === 'WAIT') return 'warning';
  if (r === 'REJECT' || r === 'AVOID') return 'error';
  return 'default';
}

function qualityColor(q: string | undefined): 'success' | 'warning' | 'error' | 'default' {
  const v = String(q ?? '').toUpperCase();
  if (v === 'STRONG' || v === 'HIGH') return 'success';
  if (v === 'MIXED' || v === 'MEDIUM') return 'warning';
  if (v === 'WEAK' || v === 'LOW' || v === 'INSUFFICIENT') return 'error';
  return 'default';
}

function fmtExpectedR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

function fmtKpiDelta(
  delta: number | null | undefined,
  prior: number | null | undefined,
): { text: string; color: string } {
  if (delta == null || !Number.isFinite(delta)) {
    return { text: 'vs previous batch Not available', color: ACCENT.slate };
  }
  const pct = prior != null && Number.isFinite(prior) && prior !== 0 ? (delta / prior) * 100 : null;
  const sign = delta > 0 ? '+' : '';
  const countPart = `${sign}${delta}`;
  const pctPart = pct != null && Number.isFinite(pct) ? ` (${sign}${pct.toFixed(0)}%)` : '';
  return {
    text: `${countPart}${pctPart} vs previous batch`,
    color: delta > 0 ? ACCENT.green : delta < 0 ? ACCENT.rose : ACCENT.slate,
  };
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  iconColor,
  deltaText,
  deltaColor,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  iconColor: string;
  deltaText?: string;
  deltaColor?: string;
}): JSX.Element {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        minWidth: 160,
        flex: '1 1 160px',
        bgcolor: CARD_BG,
        borderColor: BORDER,
        borderRadius: 2,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', letterSpacing: 0.3, fontWeight: 600 }}
          >
            {label}
          </Typography>
          <Typography variant="h4" fontWeight={800} sx={{ mt: 0.5, lineHeight: 1.1 }}>
            {value}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: deltaColor ?? ACCENT.slate,
              display: 'block',
              mt: 0.5,
              fontWeight: 600,
            }}
          >
            {deltaText ?? 'vs previous batch Not available'}
          </Typography>
          {hint ? (
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}
            >
              {hint}
            </Typography>
          ) : null}
        </Box>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1.5,
            bgcolor: `${iconColor}22`,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </Box>
      </Stack>
    </Paper>
  );
}

function DonutChart({
  slices,
  centerLabel,
}: {
  slices: Array<{ label: string; count: number; color: string }>;
  centerLabel: string;
}): JSX.Element {
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total <= 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Recommendation distribution Not available
      </Typography>
    );
  }
  let acc = 0;
  const stops = slices
    .filter((s) => s.count > 0)
    .map((s) => {
      const start = (acc / total) * 360;
      acc += s.count;
      const end = (acc / total) * 360;
      return `${s.color} ${start}deg ${end}deg`;
    });
  return (
    <Stack direction="row" spacing={2.5} alignItems="center">
      <Box sx={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
        <Box
          sx={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: `conic-gradient(${stops.join(', ')})`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 28,
            borderRadius: '50%',
            bgcolor: CARD_BG,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="h6" fontWeight={800}>
            {centerLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            total
          </Typography>
        </Box>
      </Box>
      <Stack spacing={0.75}>
        {slices.map((s) => (
          <Stack key={s.label} direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 10,
                height: 10,
                bgcolor: s.color,
                borderRadius: 0.5,
                flexShrink: 0,
              }}
            />
            <Typography variant="body2">
              {s.label}{' '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {s.count} ({Math.round((s.count / total) * 100)}%)
              </Box>
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function HorizontalBars({ rows }: { rows: Array<{ label: string; count: number }> }): JSX.Element {
  const max = Math.max(...rows.map((r) => r.count), 1);
  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        Sector opportunity counts Not available
      </Typography>
    );
  }
  return (
    <Stack spacing={1.25}>
      {rows.map((r) => (
        <Box key={r.label}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2" fontWeight={600}>
              {r.label}
            </Typography>
            <Typography variant="body2" fontWeight={700} color="text.secondary">
              {r.count}
            </Typography>
          </Stack>
          <Box sx={{ height: 10, bgcolor: 'rgba(148,163,184,0.12)', borderRadius: 1 }}>
            <Box
              sx={{
                width: `${(r.count / max) * 100}%`,
                height: '100%',
                bgcolor: ACCENT.blue,
                borderRadius: 1,
              }}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function HistogramBars({ bins }: { bins: Array<{ label: string; count: number }> }): JSX.Element {
  const max = Math.max(...bins.map((b) => b.count), 1);
  if (!bins.some((b) => b.count > 0)) {
    return (
      <Typography variant="body2" color="text.secondary">
        Expected R histogram Not available (no finite tradePlanExpectedR)
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.75} alignItems="flex-end" sx={{ height: 140, px: 0.5 }}>
      {bins.map((b, i) => {
        const color =
          i === 0
            ? ACCENT.rose
            : i === 1
              ? '#F97316'
              : i === 2
                ? ACCENT.amber
                : i === 3
                  ? ACCENT.green
                  : '#34D399';
        return (
          <Box
            key={b.label}
            sx={{
              flex: 1,
              textAlign: 'center',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
            }}
          >
            <Box
              sx={{
                height: `${Math.max((b.count / max) * 100, b.count > 0 ? 8 : 0)}%`,
                bgcolor: color,
                borderRadius: '6px 6px 0 0',
                opacity: 0.92,
                minHeight: b.count > 0 ? 8 : 0,
              }}
            />
            <Typography
              variant="caption"
              display="block"
              sx={{ mt: 0.75, fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap' }}
            >
              {b.label}
            </Typography>
            <Typography variant="caption" fontWeight={700} display="block">
              {b.count}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

function pageWindow(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages = new Set<number>([0, total - 1, current]);
  for (let d = 1; d <= 2; d++) {
    if (current - d >= 0) pages.add(current - d);
    if (current + d < total) pages.add(current + d);
  }
  return [...pages].sort((a, b) => a - b);
}

export default function ResearchReportsPage(): JSX.Element {
  const { data: batches, refetch: refetchBatches } = useListIntelligenceBatchesQuery({ limit: 20 });
  const batchList = useMemo(() => {
    const list = Array.isArray(batches) ? batches : [];
    return list as Array<{ batchId: string; status: string; universe?: string }>;
  }, [batches]);
  const [selected, setSelected] = useState<string>('latest');
  const [detail, setDetail] = useState<ReportPick | null>(null);
  const [section, setSection] = useState<SectionTab>('opportunities');
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [recFilter, setRecFilter] = useState('ALL');
  const [qualityFilter, setQualityFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [moreFilters, setMoreFilters] = useState(false);
  const [bestOnly, setBestOnly] = useState(false);

  const latest = useGetLatestBatchResearchReportQuery(undefined, {
    skip: selected !== 'latest',
  });
  const byId = useGetBatchResearchReportQuery(selected, {
    skip: selected === 'latest',
  });
  const payload = selected === 'latest' ? latest.data : byId.data;
  const loading = selected === 'latest' ? latest.isLoading : byId.isLoading;
  const fetching = selected === 'latest' ? latest.isFetching : byId.isFetching;
  const refetchReport = selected === 'latest' ? latest.refetch : byId.refetch;
  const [rebuildReport, rebuildState] = useRebuildBatchResearchReportMutation();

  const report = (payload?.available ? payload.report : undefined) as
    | {
        batchId: string;
        completedAt?: number;
        universe: string;
        outcome: string;
        coverage: { total: number; processed: number; failed: number };
        marketSummary?: { regime?: string; note?: string; breadth?: string };
        commandCenterHorizon?: string;
        disclaimer?: string;
        bestPicks?: ReportPick[];
        bestOpportunities?: ReportPick[];
        opportunities?: ReportPick[];
        dashboardSummary?: {
          total: number;
          actionable: number;
          watchlist: number;
          avoid: number;
          vsPrevious?: {
            available: boolean;
            priorBatchId?: string;
            priorCompletedAt?: number;
            deltaTotal?: number | null;
            deltaActionable?: number | null;
            deltaWatchlist?: number | null;
            deltaAvoid?: number | null;
            reason?: string;
          };
        };
        recommendationDistribution?: {
          approve: number;
          wait: number;
          reject: number;
          unspecified: number;
        };
        sectorOpportunityCounts?: Array<{ sector: string; count: number }>;
        expectedRHistogram?: Array<{ id: string; label: string; count: number }>;
        expectedRCoverage?: { withExpectedR: number; missing: number };
        sectorSummary?: Array<{
          sector: string;
          state?: string;
          memberCount: number;
          bullCandidates: number;
          leaders?: string[];
          laggards?: string[];
        }>;
        integritySummary?: {
          normal: number;
          investigate: number;
          suspicious: number;
          unknown: number;
        };
        dataQuality?: {
          analyzed: number;
          incomplete: number;
          quoteGaps: number;
          providerGaps: number;
          insufficientHistory: number;
          fabricated: number;
        };
        capabilityCoverage?: Array<{
          capability: string;
          available: number;
          partial: number;
          unavailable: number;
          coverageCount: number;
          totalCount: number;
        }>;
        sectorRotation?: {
          leading: string[];
          improving: string[];
          weakening: string[];
          lagging: string[];
        };
        provenance?: { analysisAt?: string | number; dataAsOf?: string | number | null };
      }
    | undefined;

  const rows: ReportPick[] = useMemo(() => {
    if (!report) return [];
    if (report.opportunities?.length) return report.opportunities;
    if (report.bestOpportunities?.length) return report.bestOpportunities;
    return report.bestPicks ?? [];
  }, [report]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows.filter((r) => {
      if (bestOnly && !r.isBestPick) return false;
      if (sectorFilter !== 'ALL' && (r.sector ?? '') !== sectorFilter) return false;
      if (recFilter !== 'ALL' && String(r.recommendation ?? '').toUpperCase() !== recFilter) {
        return false;
      }
      const quality = String(r.evidenceQuality ?? r.opportunityQuality ?? '').toUpperCase();
      if (qualityFilter !== 'ALL' && quality !== qualityFilter) return false;
      if (!q) return true;
      return (
        r.symbol.toUpperCase().includes(q) ||
        String(r.companyName ?? '')
          .toUpperCase()
          .includes(q) ||
        String(r.sector ?? '')
          .toUpperCase()
          .includes(q)
      );
    });
  }, [rows, search, sectorFilter, recFilter, qualityFilter, bestOnly]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const active = detail ?? pageRows[0] ?? filtered[0] ?? null;

  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.sector) set.add(r.sector);
    return [...set].sort();
  }, [rows]);

  const summary = report?.dashboardSummary;
  const dist = report?.recommendationDistribution;
  const compareBatchId = report?.batchId;
  const needsCompare =
    !!compareBatchId && !(summary?.vsPrevious && typeof summary.vsPrevious.available === 'boolean');
  const compareQ = useGetBatchResearchReportCompareQuery(
    { id: compareBatchId ?? '' },
    { skip: !needsCompare || !compareBatchId },
  );
  const vsPrevious = useMemo(() => {
    if (summary?.vsPrevious?.available) return summary.vsPrevious;
    if (compareQ.data?.deltas?.available) return compareQ.data.deltas;
    if (summary?.vsPrevious) return summary.vsPrevious;
    if (compareQ.data?.deltas) return compareQ.data.deltas;
    return undefined;
  }, [summary?.vsPrevious, compareQ.data?.deltas]);
  const priorSummary = compareQ.data?.prior ?? null;
  const priorTotal =
    priorSummary?.total ??
    (vsPrevious?.available && summary && vsPrevious.deltaTotal != null
      ? summary.total - vsPrevious.deltaTotal
      : null);
  const priorActionable =
    priorSummary?.actionable ??
    (vsPrevious?.available && summary && vsPrevious.deltaActionable != null
      ? summary.actionable - vsPrevious.deltaActionable
      : null);
  const priorWatchlist =
    priorSummary?.watchlist ??
    (vsPrevious?.available && summary && vsPrevious.deltaWatchlist != null
      ? summary.watchlist - vsPrevious.deltaWatchlist
      : null);
  const priorAvoid =
    priorSummary?.avoid ??
    (vsPrevious?.available && summary && vsPrevious.deltaAvoid != null
      ? summary.avoid - vsPrevious.deltaAvoid
      : null);
  const deltaTotal = fmtKpiDelta(vsPrevious?.available ? vsPrevious.deltaTotal : null, priorTotal);
  const deltaActionable = fmtKpiDelta(
    vsPrevious?.available ? vsPrevious.deltaActionable : null,
    priorActionable,
  );
  const deltaWatchlist = fmtKpiDelta(
    vsPrevious?.available ? vsPrevious.deltaWatchlist : null,
    priorWatchlist,
  );
  const deltaAvoid = fmtKpiDelta(vsPrevious?.available ? vsPrevious.deltaAvoid : null, priorAvoid);
  const completedAtLabel = useMemo(() => {
    if (!report?.completedAt) return '—';
    try {
      return new Date(report.completedAt).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(report.completedAt);
    }
  }, [report?.completedAt]);

  const exportCsv = (source: ReportPick[]) => {
    const header = [
      'rank',
      'symbol',
      'company',
      'sector',
      'recommendation',
      'evidenceQuality',
      'prob1W20',
      'prob1M20',
      'expectedR',
    ];
    const lines = source.map((r) =>
      [
        r.rank,
        r.symbol,
        JSON.stringify(r.companyName ?? ''),
        r.sector ?? '',
        r.recommendation ?? '',
        r.evidenceQuality ?? '',
        r.prob1W20 ?? '',
        r.prob1M20 ?? '',
        r.tradePlanExpectedR ?? '',
      ].join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-${report?.batchId ?? 'report'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pageStart = filtered.length ? page * pageSize + 1 : 0;
  const pageEnd = Math.min(filtered.length, (page + 1) * pageSize);
  const pages = pageWindow(page, pageCount);

  const detailRow = active
    ? {
        symbol: active.symbol,
        companyName: active.companyName,
        rank: active.rank,
        sector: active.sector,
        exchange: 'NSE',
        price: active.price ?? undefined,
        bullRunMatrix: active.bullRunMatrix,
        supportingEvidence: active.supportingEvidence,
        conflictingEvidence: active.conflictingEvidence,
        missingEvidence: active.missingEvidence,
        evidenceQuality: active.evidenceQuality,
        conflictSummary: active.conflictSummary,
        historicalStatus: active.historicalStatus,
        historicalSampleSize: active.historicalSampleSize,
        historicalNote: active.historicalNote,
        thesis: active.thesis,
        recommendation: active.recommendation,
        tradePlanExecutionReady: active.tradePlanExecutionReady,
        tradePlanStatus: active.tradePlanStatus,
        tradePlanExpectedR: active.tradePlanExpectedR,
        tradePlanHorizon: active.tradePlanHorizon,
        invalidationPrice: active.invalidationPrice,
        integrityStatus: active.integrityStatus,
        intelligenceContext: {
          tradePlanRecommendation: active.recommendation,
          tradePlanExecutionReady: active.tradePlanExecutionReady,
          tradePlanStatus: active.tradePlanStatus,
          tradePlanExpectedR: active.tradePlanExpectedR,
          tradePlanHorizon: active.tradePlanHorizon,
          invalidationPrice: active.invalidationPrice,
          integrityStatus: active.integrityStatus,
          thesis: active.thesis,
          supportingEvidence: active.supportingEvidence,
          conflictingEvidence: active.conflictingEvidence,
          missingEvidence: active.missingEvidence,
          evidenceQuality: active.evidenceQuality,
          conflictSummary: active.conflictSummary,
          historicalStatus: active.historicalStatus,
          historicalSampleSize: active.historicalSampleSize,
          opportunityQuality: active.opportunityQuality,
        },
      }
    : null;

  const cardSx = {
    bgcolor: CARD_BG,
    borderColor: BORDER,
    borderRadius: 2,
  } as const;

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 }, maxWidth: 1520, bgcolor: PAGE_BG, minHeight: '100%' }}>
      <Alert
        severity="warning"
        sx={{
          mb: 2.5,
          borderRadius: 2,
          bgcolor: 'rgba(245, 158, 11, 0.08)',
          border: `1px solid ${ACCENT.amber}55`,
        }}
      >
        This is not investment advice. Predictions are probabilistic; there is no guarantee of
        profits. Paper trading is enabled by default — live trading requires explicit broker
        authorization.
      </Alert>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
        gap={1.5}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1.5,
                bgcolor: `${ACCENT.blue}22`,
                color: ACCENT.blue,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MenuBookOutlinedIcon />
            </Box>
            <Box>
              <Typography variant="h4" fontWeight={800} letterSpacing={-0.5}>
                Research Reports
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                AI-generated investment research from completed intelligence batches.
              </Typography>
            </Box>
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Select
            size="small"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setDetail(null);
              setPage(0);
            }}
            sx={{ minWidth: 220, bgcolor: CARD_BG, borderRadius: 1.5 }}
          >
            <MenuItem value="latest">Latest available</MenuItem>
            {batchList
              .filter((b) => b.status === 'COMPLETED' || b.status === 'PARTIAL')
              .map((b) => (
                <MenuItem key={b.batchId} value={b.batchId}>
                  {b.batchId} ({b.universe ?? '?'})
                </MenuItem>
              ))}
          </Select>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            disabled={rebuildState.isLoading}
            onClick={() => {
              void (async () => {
                void refetchBatches();
                const batchId = report?.batchId;
                const missingVs =
                  !report?.dashboardSummary?.vsPrevious ||
                  report.dashboardSummary.vsPrevious.available === undefined;
                if (batchId && missingVs) {
                  try {
                    await rebuildReport(batchId).unwrap();
                  } catch {
                    /* keep existing report; refetch below */
                  }
                }
                void refetchReport();
                if (needsCompare) void compareQ.refetch();
              })();
            }}
            sx={{ borderRadius: 1.5 }}
          >
            Refresh
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            disabled={!rows.length}
            onClick={() => exportCsv(filtered.length ? filtered : rows)}
            sx={{ borderRadius: 1.5 }}
          >
            Export
          </Button>
        </Stack>
      </Stack>

      {loading ? (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      ) : null}

      {!loading && (!payload?.available || !report) ? (
        <Alert severity="info">
          Research report Not available
          {payload?.reason ? `: ${payload.reason}` : ''}.
          {payload?.missingCapability ? ` Missing capability: ${payload.missingCapability}.` : ''}
        </Alert>
      ) : null}

      {report ? (
        <>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2.5 }}>
            <KpiCard
              label="Total Opportunities"
              value={String(summary?.total ?? report.coverage.processed)}
              hint={fetching ? 'refreshing…' : `${report.universe} ranked`}
              icon={<TrendingUpIcon fontSize="small" />}
              iconColor={ACCENT.purple}
              deltaText={deltaTotal.text}
              deltaColor={deltaTotal.color}
            />
            <KpiCard
              label="Actionable"
              value={String(summary?.actionable ?? '—')}
              hint="APPROVE count from batch rankings"
              icon={<CheckCircleOutlineIcon fontSize="small" />}
              iconColor={ACCENT.green}
              deltaText={deltaActionable.text}
              deltaColor={deltaActionable.color}
            />
            <KpiCard
              label="Watchlist"
              value={String(summary?.watchlist ?? '—')}
              hint="WAIT count from batch rankings"
              icon={<VisibilityOutlinedIcon fontSize="small" />}
              iconColor={ACCENT.amber}
              deltaText={deltaWatchlist.text}
              deltaColor={deltaWatchlist.color}
            />
            <KpiCard
              label="Avoid"
              value={String(summary?.avoid ?? '—')}
              hint="REJECT count from batch rankings"
              icon={<CancelOutlinedIcon fontSize="small" />}
              iconColor={ACCENT.rose}
              deltaText={deltaAvoid.text}
              deltaColor={deltaAvoid.color}
            />
            <Paper
              variant="outlined"
              sx={{
                ...cardSx,
                p: 2,
                minWidth: 220,
                flex: '1 1 220px',
                position: 'relative',
              }}
            >
              <Chip
                size="small"
                color="success"
                label="COMPLETED"
                sx={{ position: 'absolute', top: 12, right: 12, fontWeight: 700 }}
              />
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                Batch
              </Typography>
              <Typography
                variant="body2"
                fontWeight={800}
                sx={{ mt: 0.5, pr: 10, wordBreak: 'break-all' }}
              >
                {report.batchId}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {report.universe} · {report.marketSummary?.regime ?? 'Regime Not available'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {completedAtLabel}
              </Typography>
            </Paper>
          </Stack>

          <Tabs
            value={section}
            onChange={(_, v: SectionTab) => setSection(v)}
            variant="scrollable"
            sx={{
              mb: 2,
              minHeight: 42,
              borderBottom: `1px solid ${BORDER}`,
              '& .MuiTab-root': { textTransform: 'none', minHeight: 42, fontWeight: 600 },
            }}
          >
            <Tab value="opportunities" label="Opportunities" />
            <Tab value="insights" label="Market Insights" />
            <Tab value="sectors" label="Sector Analysis" />
            <Tab value="picks" label="Top Picks" />
            <Tab value="risk" label="Risk & Quality" />
            <Tab value="batch" label="Batch Details" />
            <Tab value="download" label="Download" />
          </Tabs>

          {section === 'opportunities' ? (
            <>
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={2}
                alignItems="stretch"
                sx={{ mb: 2.5 }}
              >
                <Paper variant="outlined" sx={{ ...cardSx, flex: 1.4, minWidth: 0, p: 2 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    gap={1.25}
                    sx={{ mb: 1.75 }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TableChartOutlinedIcon sx={{ color: ACCENT.blue, fontSize: 20 }} />
                      <Typography variant="subtitle1" fontWeight={800}>
                        Opportunities in Report ({filtered.length})
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <TextField
                        size="small"
                        placeholder="Search symbol, company…"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setPage(0);
                        }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <SearchIcon fontSize="small" />
                            </InputAdornment>
                          ),
                        }}
                        sx={{ minWidth: 180, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1.5 }}
                      />
                      <Select
                        size="small"
                        value={sectorFilter}
                        onChange={(e) => {
                          setSectorFilter(String(e.target.value));
                          setPage(0);
                        }}
                        sx={{ minWidth: 130 }}
                      >
                        <MenuItem value="ALL">All Sectors</MenuItem>
                        {sectors.map((s) => (
                          <MenuItem key={s} value={s}>
                            {s}
                          </MenuItem>
                        ))}
                      </Select>
                      <Select
                        size="small"
                        value={recFilter}
                        onChange={(e) => {
                          setRecFilter(String(e.target.value));
                          setPage(0);
                        }}
                        sx={{ minWidth: 150 }}
                      >
                        <MenuItem value="ALL">All Recommendations</MenuItem>
                        <MenuItem value="APPROVE">APPROVE</MenuItem>
                        <MenuItem value="WAIT">WAIT</MenuItem>
                        <MenuItem value="WATCH">WATCH</MenuItem>
                        <MenuItem value="REJECT">REJECT</MenuItem>
                      </Select>
                      <Select
                        size="small"
                        value={qualityFilter}
                        onChange={(e) => {
                          setQualityFilter(String(e.target.value));
                          setPage(0);
                        }}
                        sx={{ minWidth: 120 }}
                      >
                        <MenuItem value="ALL">All Quality</MenuItem>
                        <MenuItem value="STRONG">STRONG</MenuItem>
                        <MenuItem value="MIXED">MIXED</MenuItem>
                        <MenuItem value="WEAK">WEAK</MenuItem>
                        <MenuItem value="INSUFFICIENT">INSUFFICIENT</MenuItem>
                      </Select>
                      <Button
                        size="small"
                        variant={moreFilters ? 'contained' : 'outlined'}
                        startIcon={<FilterListIcon />}
                        onClick={() => setMoreFilters((v) => !v)}
                        sx={{ borderRadius: 1.5 }}
                      >
                        More Filters
                      </Button>
                    </Stack>
                  </Stack>
                  {moreFilters ? (
                    <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} alignItems="center">
                      <Chip
                        size="small"
                        color={bestOnly ? 'primary' : 'default'}
                        variant={bestOnly ? 'filled' : 'outlined'}
                        label="Best picks only"
                        onClick={() => {
                          setBestOnly((v) => !v);
                          setPage(0);
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Extra filters use backend fields only — no invented ranks.
                      </Typography>
                    </Stack>
                  ) : null}
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow
                          sx={{
                            '& .MuiTableCell-head': {
                              color: 'text.secondary',
                              fontWeight: 700,
                              fontSize: 12,
                              borderBottomColor: BORDER,
                              bgcolor: 'rgba(0,0,0,0.18)',
                              whiteSpace: 'nowrap',
                            },
                          }}
                        >
                          <TableCell>#</TableCell>
                          <TableCell>Symbol</TableCell>
                          <TableCell>Company</TableCell>
                          <TableCell align="right">Price</TableCell>
                          <TableCell>Sector</TableCell>
                          <TableCell>Reco</TableCell>
                          <TableCell>Quality</TableCell>
                          <TableCell align="right">1W Prob</TableCell>
                          <TableCell align="right">1M Prob</TableCell>
                          <TableCell align="right">Expected R</TableCell>
                          <TableCell align="right">View</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {pageRows.map((r) => {
                          const q = r.evidenceQuality ?? r.opportunityQuality;
                          const selectedRow =
                            active?.symbol === r.symbol && active?.rank === r.rank;
                          return (
                            <TableRow
                              key={`${r.symbol}-${r.rank}`}
                              hover
                              selected={selectedRow}
                              sx={{
                                cursor: 'pointer',
                                '&.Mui-selected': { bgcolor: 'rgba(59,130,246,0.12)' },
                              }}
                              onClick={() => setDetail(r)}
                            >
                              <TableCell>{r.rank}</TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight={800}>
                                  {r.symbol}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  noWrap
                                  sx={{ maxWidth: 140 }}
                                >
                                  {r.companyName ?? '—'}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                {r.price != null && Number.isFinite(r.price)
                                  ? r.price.toLocaleString('en-IN', {
                                      maximumFractionDigits: 2,
                                    })
                                  : '—'}
                              </TableCell>
                              <TableCell>{r.sector ?? 'Not available'}</TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  color={recColor(r.recommendation)}
                                  label={recDisplay(r.recommendation)}
                                  sx={{ fontWeight: 700 }}
                                />
                              </TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  color={qualityColor(q)}
                                  label={q ?? 'Not available'}
                                  sx={{ fontWeight: 700 }}
                                />
                              </TableCell>
                              <TableCell align="right">
                                {formatProbabilityPercent(r.prob1W20)}
                              </TableCell>
                              <TableCell align="right">
                                {formatProbabilityPercent(r.prob1M20)}
                              </TableCell>
                              <TableCell align="right">
                                <Typography
                                  variant="body2"
                                  fontWeight={700}
                                  sx={{
                                    color:
                                      (r.tradePlanExpectedR ?? 0) > 0
                                        ? ACCENT.green
                                        : (r.tradePlanExpectedR ?? 0) < 0
                                          ? ACCENT.rose
                                          : 'text.secondary',
                                  }}
                                >
                                  {fmtExpectedR(r.tradePlanExpectedR)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                <Button
                                  size="small"
                                  sx={{ textTransform: 'none' }}
                                  onClick={() => setDetail(r)}
                                >
                                  View
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {!pageRows.length ? (
                          <TableRow>
                            <TableCell colSpan={11}>
                              <Typography variant="body2" color="text.secondary">
                                No opportunity rows match filters.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ sm: 'center' }}
                    gap={1}
                    sx={{ mt: 1.5 }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      Showing {pageStart}-{pageEnd} of {filtered.length}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Select
                        size="small"
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(0);
                        }}
                        sx={{ minWidth: 88 }}
                      >
                        <MenuItem value={10}>10 / page</MenuItem>
                        <MenuItem value={25}>25 / page</MenuItem>
                        <MenuItem value={50}>50 / page</MenuItem>
                      </Select>
                      {pages.map((p, idx) => {
                        const prev = pages[idx - 1];
                        const gap = prev != null && p - prev > 1;
                        return (
                          <Box key={p} sx={{ display: 'inline-flex', alignItems: 'center' }}>
                            {gap ? (
                              <Typography variant="caption" sx={{ px: 0.5 }} color="text.secondary">
                                …
                              </Typography>
                            ) : null}
                            <IconButton
                              size="small"
                              onClick={() => setPage(p)}
                              sx={{
                                width: 28,
                                height: 28,
                                fontSize: 12,
                                borderRadius: 1,
                                bgcolor: p === page ? 'primary.main' : 'transparent',
                                color: p === page ? 'primary.contrastText' : 'text.secondary',
                              }}
                            >
                              {p + 1}
                            </IconButton>
                          </Box>
                        );
                      })}
                    </Stack>
                  </Stack>
                </Paper>

                <Paper
                  variant="outlined"
                  sx={{
                    ...cardSx,
                    flex: 1,
                    p: 2,
                    minWidth: 0,
                    maxHeight: { lg: '78vh' },
                    overflow: 'auto',
                  }}
                >
                  {detailRow ? (
                    <OpportunityDetailPanel
                      row={detailRow}
                      selectedHorizon={report.commandCenterHorizon ?? '1W'}
                      selectedTarget={0.2}
                      batchId={report.batchId}
                      initialTab="Overview"
                      livePrice
                      universeLabel={report.universe}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Select a row to open research detail.
                    </Typography>
                  )}
                </Paper>
              </Stack>

              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
                <Paper variant="outlined" sx={{ ...cardSx, flex: 1, p: 2.25 }}>
                  <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.75 }}>
                    Recommendation Distribution
                  </Typography>
                  <DonutChart
                    centerLabel={String(
                      summary?.total ??
                        (dist?.approve ?? 0) +
                          (dist?.wait ?? 0) +
                          (dist?.reject ?? 0) +
                          (dist?.unspecified ?? 0),
                    )}
                    slices={[
                      { label: 'APPROVE', count: dist?.approve ?? 0, color: ACCENT.green },
                      { label: 'WAIT', count: dist?.wait ?? 0, color: ACCENT.amber },
                      { label: 'REJECT', count: dist?.reject ?? 0, color: ACCENT.rose },
                      ...(dist && dist.unspecified > 0
                        ? [{ label: 'Unspecified', count: dist.unspecified, color: ACCENT.blue }]
                        : []),
                    ]}
                  />
                </Paper>
                <Paper variant="outlined" sx={{ ...cardSx, flex: 1, p: 2.25 }}>
                  <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.75 }}>
                    Top Sectors by Opportunities
                  </Typography>
                  <HorizontalBars
                    rows={(report.sectorOpportunityCounts ?? []).slice(0, 5).map((s) => ({
                      label: s.sector,
                      count: s.count,
                    }))}
                  />
                </Paper>
                <Paper variant="outlined" sx={{ ...cardSx, flex: 1, p: 2.25 }}>
                  <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.75 }}>
                    Batch Performance (Expected Returns)
                  </Typography>
                  <HistogramBars
                    bins={(report.expectedRHistogram ?? []).map((b) => ({
                      label: b.label,
                      count: b.count,
                    }))}
                  />
                </Paper>
              </Stack>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                gap={1}
                sx={{ pt: 1, borderTop: `1px solid ${BORDER}` }}
              >
                <Typography variant="caption" color="text.secondary">
                  Predictions are probabilistic and for informational purposes only. Missing cells
                  show Not available — never fabricated 0%.
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {report.batchId} · {completedAtLabel}
                </Typography>
              </Stack>
            </>
          ) : null}

          {section === 'insights' ? (
            <Paper variant="outlined" sx={{ ...cardSx, p: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Market Insights
              </Typography>
              <Typography variant="body2">
                Regime: <strong>{report.marketSummary?.regime ?? 'Not available'}</strong>
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                Breadth: <strong>{report.marketSummary?.breadth ?? 'Not available'}</strong>
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                {report.marketSummary?.note ?? 'No market summary note.'}
              </Typography>
              <Typography variant="body2" sx={{ mt: 2 }} color="text.secondary">
                Leading: {(report.sectorRotation?.leading ?? []).join(', ') || 'Not available'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Improving: {(report.sectorRotation?.improving ?? []).join(', ') || 'Not available'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Weakening: {(report.sectorRotation?.weakening ?? []).join(', ') || 'Not available'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Lagging: {(report.sectorRotation?.lagging ?? []).join(', ') || 'Not available'}
              </Typography>
            </Paper>
          ) : null}

          {section === 'sectors' ? (
            <Paper variant="outlined" sx={{ ...cardSx, p: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                Sector Analysis
              </Typography>
              <HorizontalBars
                rows={(report.sectorOpportunityCounts ?? []).map((s) => ({
                  label: s.sector,
                  count: s.count,
                }))}
              />
              <Stack spacing={1.25} sx={{ mt: 2 }}>
                {(report.sectorSummary ?? []).map((s) => (
                  <Box key={s.sector}>
                    <Typography variant="body2" fontWeight={700}>
                      {s.sector}
                      {s.state ? ` · ${s.state}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Leaders:{' '}
                      {(s.leaders ?? []).length ? (s.leaders ?? []).join(', ') : 'Not available'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Laggards:{' '}
                      {(s.laggards ?? []).length ? (s.laggards ?? []).join(', ') : 'Not available'}
                    </Typography>
                  </Box>
                ))}
                {!(report.sectorSummary ?? []).length ? (
                  <Typography variant="body2" color="text.secondary">
                    Sector leaders Not available on this report.
                  </Typography>
                ) : null}
              </Stack>
            </Paper>
          ) : null}

          {section === 'picks' ? (
            <Paper variant="outlined" sx={{ ...cardSx, p: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Top Picks (BEST_OPPORTUNITIES)
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Symbol</TableCell>
                    <TableCell>Sector</TableCell>
                    <TableCell>Reco</TableCell>
                    <TableCell align="right">Expected R</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(report.bestPicks ?? []).map((r) => (
                    <TableRow
                      key={`pick-${r.symbol}-${r.rank}`}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => {
                        setDetail(r);
                        setSection('opportunities');
                      }}
                    >
                      <TableCell>{r.rank}</TableCell>
                      <TableCell>{r.symbol}</TableCell>
                      <TableCell>{r.sector ?? '—'}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={recColor(r.recommendation)}
                          label={recDisplay(r.recommendation)}
                        />
                      </TableCell>
                      <TableCell align="right">{fmtExpectedR(r.tradePlanExpectedR)}</TableCell>
                    </TableRow>
                  ))}
                  {!(report.bestPicks ?? []).length ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          No best picks in this report.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Paper>
          ) : null}

          {section === 'risk' ? (
            <Paper variant="outlined" sx={{ ...cardSx, p: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Risk & Quality
              </Typography>
              <Typography variant="body2">
                Integrity — normal: {report.integritySummary?.normal ?? '—'}, investigate:{' '}
                {report.integritySummary?.investigate ?? '—'}, suspicious:{' '}
                {report.integritySummary?.suspicious ?? '—'}, unknown:{' '}
                {report.integritySummary?.unknown ?? '—'}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Data quality — analyzed: {report.dataQuality?.analyzed ?? '—'}, incomplete:{' '}
                {report.dataQuality?.incomplete ?? '—'}, quote gaps:{' '}
                {report.dataQuality?.quoteGaps ?? '—'}, fabricated:{' '}
                {report.dataQuality?.fabricated ?? 0}
              </Typography>
              {(report.capabilityCoverage?.length ?? 0) > 0 ? (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                    Capability coverage (backend-owned)
                  </Typography>
                  {report.capabilityCoverage!.map((c) => (
                    <Typography key={c.capability} variant="caption" display="block">
                      {c.capability}: {c.available} available / {c.partial} partial /{' '}
                      {c.unavailable} unavailable ({c.coverageCount}/{c.totalCount})
                    </Typography>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Capability coverage: Not available
                </Typography>
              )}
            </Paper>
          ) : null}

          {section === 'batch' ? (
            <Paper variant="outlined" sx={{ ...cardSx, p: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Batch Details
              </Typography>
              <Typography variant="body2">
                Coverage: {report.coverage.processed}/{report.coverage.total} (failed{' '}
                {report.coverage.failed})
              </Typography>
              <Typography variant="body2">Outcome: {report.outcome}</Typography>
              <Typography variant="body2">Universe: {report.universe}</Typography>
              <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
                {report.disclaimer}
              </Typography>
            </Paper>
          ) : null}

          {section === 'download' ? (
            <Paper variant="outlined" sx={{ ...cardSx, p: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Download
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Export backend opportunity fields only (no FE-invented ranks or probabilities).
              </Typography>
              <Button
                variant="contained"
                startIcon={<DownloadIcon />}
                disabled={!rows.length}
                onClick={() => exportCsv(rows)}
              >
                Export full opportunities CSV
              </Button>
            </Paper>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
