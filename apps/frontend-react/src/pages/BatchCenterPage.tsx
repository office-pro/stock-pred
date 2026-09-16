import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  useCancelIntelligenceBatchMutation,
  useCreateIntelligenceBatchMutation,
  useGetIntelligenceBatchQuery,
  useGetIntelligenceBatchResultsBySectorQuery,
  useGetIntelligenceBatchResultsQuery,
  useListIntelligenceBatchesQuery,
  usePauseIntelligenceBatchMutation,
  useResumeIntelligenceBatchMutation,
} from '../store/api';
import OpportunityDetailPanel from '../components/OpportunityDetailPanel';
import {
  COMMAND_CENTER_DISPLAY_TARGETS,
  confidenceChipColor,
  formatConfidence,
  formatProbabilityCell,
  formatProbabilityPercent,
  formatSetupLabel,
  matchCompactCell,
  probabilityFromCompactCells,
  readBullRunV2Cells,
  type CompactBullRunCell,
} from '../lib/bull-run-display';

const SELECTED_KEY = 'intel-batch-selected-id';

const ACTIVE_POLL = new Set(['CREATED', 'QUEUED', 'RUNNING', 'RESUMING', 'PAUSED']);

const PRESET_CHIPS = [
  { id: 'BEST_OPPORTUNITIES', label: 'Best Picks' },
  { id: 'HIGH_CONFIDENCE', label: 'High Confidence' },
  { id: 'BULL_RUN', label: 'Bull-Run' },
  { id: 'HIGHEST_EXPECTED_RETURN', label: 'Opportunities' },
  { id: '', label: 'All Stocks' },
] as const;

function canPauseStatus(status: string): boolean {
  return status === 'RUNNING' || status === 'RESUMING' || status === 'QUEUED';
}

function canResumeStatus(status: string): boolean {
  return status === 'PAUSED';
}

function canCancelStatus(status: string): boolean {
  return (
    status === 'RUNNING' ||
    status === 'RESUMING' ||
    status === 'QUEUED' ||
    status === 'PAUSED' ||
    status === 'CREATED'
  );
}

function fmtNum(v: unknown, digits = 2): string {
  if (v == null || !Number.isFinite(Number(v))) return 'Not available';
  return Number(v).toFixed(digits);
}

function fmtRange(low: unknown, high: unknown, prefix = ''): string {
  if (low == null && high == null) return 'Not available';
  if (low != null && high != null) return `${prefix}${fmtNum(low)}–${prefix}${fmtNum(high)}`;
  return `${prefix}${fmtNum(low ?? high)}`;
}

/** Compact batch Bull-Run v2 cell — display mapping only; never recalculate. */
type BullRunV2CompactCell = CompactBullRunCell;

function matchDisplayCell(
  ctx: Record<string, unknown> | undefined,
  targetReturn?: number,
  horizon?: string,
): BullRunV2CompactCell | undefined {
  return matchCompactCell(readBullRunV2Cells(ctx), targetReturn, horizon);
}

function fmtCellProb(p: number | undefined): string {
  return formatProbabilityPercent(p);
}

const TARGET_OPTIONS = [
  { value: '', label: 'All targets' },
  { value: '0.05', label: '≥ +5%' },
  { value: '0.1', label: '≥ +10%' },
  { value: '0.2', label: '≥ +20%' },
  { value: '0.3', label: '≥ +30%' },
  { value: '0.5', label: '≥ +50%' },
  { value: '1', label: '≥ +100%' },
  { value: '2', label: '≥ +200%' },
  { value: '5', label: '≥ +500%' },
] as const;

const HORIZON_OPTIONS = ['', '1D', '1W', '1M', '3M', '6M', '12M'] as const;

const HORIZON_SORT_ORDER: Record<string, number> = {
  '1D': 1,
  '1W': 2,
  '1M': 3,
  '3M': 4,
  '6M': 5,
  '12M': 6,
};

function reliabilitySortRank(conf: string | undefined): number {
  const c = String(conf ?? '').toUpperCase();
  if (c === 'HIGH') return 3;
  if (c === 'MEDIUM') return 2;
  if (c === 'LOW') return 1;
  return 0;
}

function rowDisplayCell(
  row: ResultRow,
  targetNum?: number,
  horizon?: string,
): CompactBullRunCell | undefined {
  const ctx = row.intelligenceContext ?? {};
  return matchDisplayCell(ctx, targetNum, horizon) ?? readBullRunV2Cells(ctx)[0];
}

type ResultRow = {
  rank: number;
  symbol: string;
  opportunityId: string;
  companyName?: string;
  exchange?: string;
  identityStatus?: string;
  price?: number;
  sector?: string;
  intelligenceContext?: Record<string, unknown>;
};

/**
 * Batch Center — discovery workstation over RankingContext results.
 * UI never invents ranking / ML / bull-run / authorization.
 */
export default function BatchCenterPage(): JSX.Element {
  const [universe, setUniverse] = useState('NIFTY50');
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [preset, setPreset] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [sort, setSort] = useState('rank');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [targetReturn, setTargetReturn] = useState('');
  const [horizon, setHorizon] = useState('');
  const [bullRunConfidence, setBullRunConfidence] = useState('');
  const [bullRunStage, setBullRunStage] = useState('');
  const [integrityStatus, setIntegrityStatus] = useState('');
  const [excludeSuspicious, setExcludeSuspicious] = useState(false);
  const [excludeInvestigate, setExcludeInvestigate] = useState(false);
  const [executionReady, setExecutionReady] = useState('');
  const [dataStatus, setDataStatus] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [drawerRow, setDrawerRow] = useState<ResultRow | null>(null);
  const [diagStage, setDiagStage] = useState<'ml' | 'rs' | null>(null);
  const [viewMode, setViewMode] = useState<'sectors' | 'flat'>('flat');
  /** Presentation-only Opportunities column sort — does not change RankingContext. */
  type OppColSort = 'setup' | 'probability' | 'reliability';
  const [oppColSort, setOppColSort] = useState<{ key: OppColSort; dir: 'asc' | 'desc' } | null>(
    null,
  );

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [
    qDebounced,
    preset,
    recommendation,
    sort,
    order,
    pageSize,
    selectedId,
    targetReturn,
    horizon,
    bullRunConfidence,
    bullRunStage,
    integrityStatus,
    excludeSuspicious,
    excludeInvestigate,
    executionReady,
    dataStatus,
    sectorFilter,
  ]);

  const excludeIntegrity = useMemo(() => {
    const bands: string[] = [];
    if (excludeSuspicious) bands.push('SUSPICIOUS');
    if (excludeInvestigate) bands.push('INVESTIGATE');
    return bands.length ? bands.join(',') : undefined;
  }, [excludeSuspicious, excludeInvestigate]);

  const targetNum =
    targetReturn !== '' && Number.isFinite(Number(targetReturn)) ? Number(targetReturn) : undefined;

  const { data: batches = [], refetch: refetchList } = useListIntelligenceBatchesQuery(
    { limit: 30 },
    { pollingInterval: 3_000 },
  );

  const activeId =
    selectedId && batches.some((b) => b.batchId === selectedId)
      ? selectedId
      : (batches[0]?.batchId ?? null);

  useEffect(() => {
    if (!activeId) return;
    try {
      localStorage.setItem(SELECTED_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  const listSelected = useMemo(
    () => batches.find((b) => b.batchId === activeId) ?? null,
    [batches, activeId],
  );

  const pollDetail =
    !!activeId && !!listSelected && ACTIVE_POLL.has(listSelected.status) ? 2_000 : 0;

  const { data: detail } = useGetIntelligenceBatchQuery(activeId!, {
    skip: !activeId,
    pollingInterval: pollDetail || undefined,
  });

  const status = String(detail?.status ?? listSelected?.status ?? '');
  const progress = (detail?.progress ?? listSelected?.progress) as
    | {
        processed: number;
        total: number;
        percent: number;
        stages: Array<{ id: string; availability: string; done: number; total: number }>;
      }
    | undefined;

  const checkpoint = detail?.checkpoint as
    | { currentSymbol?: string | null; partitionId?: string | null; completedSymbols?: string[] }
    | undefined;

  const tasks = detail?.tasks ?? [];
  const runningNow = tasks.filter((t) => t.status === 'RUNNING');
  const recentDone = [...tasks]
    .filter((t) => t.status === 'DONE' || t.status === 'FAILED')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 12);
  const pendingCount = tasks.filter((t) => t.status === 'PENDING').length;
  const failedCount = tasks.filter((t) => t.status === 'FAILED').length;

  const activityLabel =
    status === 'PAUSED'
      ? 'Paused — press Continue to resume remaining symbols'
      : runningNow.length > 0
        ? `Analyzing: ${runningNow.map((t) => t.symbol).join(', ')}`
        : status === 'RUNNING' || status === 'RESUMING'
          ? pendingCount === 0
            ? 'Finalizing — TI / ML / TradePlan / Ranking…'
            : 'Starting next wave…'
          : status === 'COMPLETED' || status === 'PARTIAL'
            ? 'Finished'
            : status || '—';

  const showResults = status === 'COMPLETED' || status === 'PARTIAL';
  const resultsQuery = {
    id: activeId!,
    page,
    pageSize,
    q: qDebounced || undefined,
    preset: preset || undefined,
    recommendation: recommendation || undefined,
    sort,
    order,
    targetReturn: targetNum,
    horizon: horizon || undefined,
    bullRunConfidence: bullRunConfidence || undefined,
    bullRunStage: bullRunStage || undefined,
    integrityStatus: integrityStatus || undefined,
    excludeIntegrity,
    executionReady:
      executionReady === 'true' ? true : executionReady === 'false' ? false : undefined,
    dataStatus: dataStatus || undefined,
    sector: sectorFilter || undefined,
  };
  const { data: results, isFetching: resultsFetching } = useGetIntelligenceBatchResultsQuery(
    resultsQuery,
    { skip: !activeId || !showResults || viewMode !== 'flat' },
  );
  const { data: sectorResults } = useGetIntelligenceBatchResultsBySectorQuery(activeId!, {
    skip: !activeId || !showResults || viewMode !== 'sectors',
  });

  const stages = results?.stages ?? progress?.stages ?? [];
  const totalPages = Math.max(1, Math.ceil((results?.total ?? 0) / pageSize));

  const [createBatch, createState] = useCreateIntelligenceBatchMutation();
  const [pauseBatch, pauseState] = usePauseIntelligenceBatchMutation();
  const [resumeBatch, resumeState] = useResumeIntelligenceBatchMutation();
  const [cancelBatch, cancelState] = useCancelIntelligenceBatchMutation();

  const busy = pauseState.isLoading || resumeState.isLoading || cancelState.isLoading;

  const onSelect = (id: string): void => {
    setSelectedId(id);
    setActionError(null);
  };

  const isOpportunitiesPreset = preset === 'HIGHEST_EXPECTED_RETURN';

  const toggleOppColSort = (key: OppColSort): void => {
    setOppColSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  const displayRankings = useMemo(() => {
    const rows = [...(results?.rankings ?? [])] as ResultRow[];
    if (!isOpportunitiesPreset || !oppColSort) return rows;
    const dir = oppColSort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const ca = rowDisplayCell(a, targetNum, horizon || undefined);
      const cb = rowDisplayCell(b, targetNum, horizon || undefined);
      if (oppColSort.key === 'probability') {
        const pa = ca?.p != null && Number.isFinite(ca.p) ? ca.p : -1;
        const pb = cb?.p != null && Number.isFinite(cb.p) ? cb.p : -1;
        return (pa - pb) * dir;
      }
      if (oppColSort.key === 'reliability') {
        return (reliabilitySortRank(ca?.conf) - reliabilitySortRank(cb?.conf)) * dir;
      }
      // setup: horizon then target
      const ha = HORIZON_SORT_ORDER[ca?.h ?? ''] ?? 0;
      const hb = HORIZON_SORT_ORDER[cb?.h ?? ''] ?? 0;
      if (ha !== hb) return (ha - hb) * dir;
      const ta = ca?.t != null && Number.isFinite(ca.t) ? ca.t : -1;
      const tb = cb?.t != null && Number.isFinite(cb.t) ? cb.t : -1;
      return (ta - tb) * dir;
    });
    return rows;
  }, [results?.rankings, isOpportunitiesPreset, oppColSort, targetNum, horizon]);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        Batch Center
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 820 }}>
        Professional discovery workstation. Default order is backend RankingContext rank.
        Presentation sorts do not change ranking. Recommendation APPROVE ≠ authorization —
        evaluateTrade() remains required.
      </Typography>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <TextField
            select
            size="small"
            label="Universe"
            value={universe}
            onChange={(e) => setUniverse(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            {['NIFTY50', 'NIFTY100', 'NIFTY150', 'NIFTY500'].map((u) => (
              <MenuItem key={u} value={u}>
                {u}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            disabled={createState.isLoading}
            onClick={async () => {
              try {
                setActionError(null);
                const created = await createBatch({ universe }).unwrap();
                onSelect(created.batchId);
                await refetchList();
              } catch (e: unknown) {
                setActionError(e instanceof Error ? e.message : 'Failed to start batch');
              }
            }}
          >
            Run batch
          </Button>
          <Button component={RouterLink} to="/prep" size="small">
            Prep Focus
          </Button>
        </Stack>
      </Paper>

      {activeId && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap={1}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {detail?.universe ?? listSelected?.universe ?? '—'} · {activeId}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {activityLabel} · {progress?.processed ?? 0}/{progress?.total ?? 0} (
                {progress?.percent ?? 0}%)
              </Typography>
              {checkpoint?.currentSymbol && (
                <Typography variant="caption" color="text.secondary">
                  Checkpoint: {checkpoint.currentSymbol}
                  {checkpoint.partitionId ? ` / ${checkpoint.partitionId}` : ''}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1}>
              <Chip size="small" label={status || '—'} />
              {failedCount > 0 && (
                <Chip size="small" color="warning" label={`${failedCount} failed`} />
              )}
            </Stack>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={progress?.percent ?? 0}
            sx={{ mt: 1.5, mb: 1.5 }}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              disabled={!canPauseStatus(status) || busy}
              onClick={async () => {
                try {
                  await pauseBatch(activeId).unwrap();
                  await refetchList();
                } catch (e: unknown) {
                  setActionError(e instanceof Error ? e.message : 'Pause failed');
                }
              }}
            >
              Pause
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!canResumeStatus(status) || busy}
              onClick={async () => {
                try {
                  await resumeBatch(activeId).unwrap();
                  await refetchList();
                } catch (e: unknown) {
                  setActionError(e instanceof Error ? e.message : 'Continue failed');
                }
              }}
            >
              Continue
            </Button>
            <Button
              size="small"
              color="inherit"
              disabled={!canCancelStatus(status) || busy}
              onClick={async () => {
                try {
                  await cancelBatch(activeId).unwrap();
                  await refetchList();
                } catch (e: unknown) {
                  setActionError(e instanceof Error ? e.message : 'Cancel failed');
                }
              }}
            >
              Cancel
            </Button>
          </Stack>

          {runningNow.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
              {runningNow.map((t) => (
                <Chip key={t.symbol} size="small" color="primary" label={`Running ${t.symbol}`} />
              ))}
            </Stack>
          )}

          {recentDone.length > 0 && ACTIVE_POLL.has(status) && (
            <Table size="small" sx={{ mt: 1.5 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Recent</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Score</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recentDone.map((t) => (
                  <TableRow key={`${t.symbol}-${t.completedAt}`}>
                    <TableCell>{t.symbol}</TableCell>
                    <TableCell>{t.status}</TableCell>
                    <TableCell>{t.intelligenceContext?.overallScore ?? t.error ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      )}

      {stages.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
            Intelligence Coverage
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            From batch.progress.stages — 0/N means unavailable, not “safe”. Click ML / Relative
            Strength for backend omit reasons.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {stages.map((s) => {
              const exitNa =
                s.id === 'exit' &&
                (s.availability === 'prerequisite_missing' ||
                  (s as { unavailableReason?: string }).unavailableReason ===
                    'REQUIRES_OPEN_POSITION');
              const zero = !exitNa && s.done === 0 && s.total > 0;
              const clickable = s.id === 'ml' || s.id === 'relativeStrength';
              const label = exitNa
                ? 'exit: N/A — requires open position'
                : `${s.id}: ${s.done}/${s.total}${
                    s.availability === 'Not available' ? ' (NA)' : ''
                  }`;
              return (
                <Chip
                  key={s.id}
                  size="small"
                  color={zero ? 'warning' : 'default'}
                  variant="outlined"
                  label={label}
                  onClick={clickable ? () => setDiagStage(s.id === 'ml' ? 'ml' : 'rs') : undefined}
                  sx={clickable ? { cursor: 'pointer' } : undefined}
                />
              );
            })}
          </Stack>
        </Paper>
      )}

      <Dialog open={!!diagStage} onClose={() => setDiagStage(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {diagStage === 'ml' ? 'ML Coverage' : 'Relative Strength Coverage'}
        </DialogTitle>
        <DialogContent>
          {(() => {
            const progDiag = (
              detail?.progress as
                | {
                    diagnostics?: {
                      ml?: {
                        usable: number;
                        unavailable: number;
                        byReason: Record<string, number>;
                      };
                      rs?: {
                        usable: number;
                        unavailable: number;
                        byReason: Record<string, number>;
                      };
                    };
                  }
                | undefined
            )?.diagnostics;
            const d =
              diagStage === 'ml'
                ? (results?.diagnostics?.ml ?? progDiag?.ml)
                : (results?.diagnostics?.rs ?? progDiag?.rs);
            if (!d) {
              return (
                <Alert severity="info">
                  Diagnostics appear after finalize on a new batch run. Reasons come from the
                  backend — not inferred in the UI.
                </Alert>
              );
            }
            return (
              <Stack spacing={1} sx={{ mt: 1 }}>
                <Typography variant="body2">Usable: {d.usable}</Typography>
                <Typography variant="body2">Unavailable: {d.unavailable}</Typography>
                <Typography variant="subtitle2" sx={{ mt: 1 }}>
                  By reason (backend)
                </Typography>
                {Object.entries(d.byReason).map(([reason, n]) => (
                  <Typography key={reason} variant="body2">
                    {reason}: {n}
                  </Typography>
                ))}
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {diagStage === 'ml'
                    ? 'mlDone counts only usable predictions. called ≠ usable.'
                    : 'Missing RS is never treated as NEUTRAL or 0.'}
                </Alert>
              </Stack>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ p: 2, pb: 1 }}>
          Batches
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Batch</TableCell>
              <TableCell>Universe</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Progress</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {batches.map((b) => (
              <TableRow
                key={b.batchId}
                hover
                selected={b.batchId === activeId}
                onClick={() => onSelect(b.batchId)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{b.batchId}</TableCell>
                <TableCell>{b.universe}</TableCell>
                <TableCell>
                  <Chip size="small" label={b.status} variant="outlined" />
                </TableCell>
                <TableCell align="right">
                  {b.progress?.processed ?? 0}/{b.progress?.total ?? 0}
                </TableCell>
              </TableRow>
            ))}
            {batches.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Alert severity="info">No batches yet — run one above.</Alert>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {showResults && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>
              Latest Batch · {detail?.universe ?? listSelected?.universe ?? '—'} · {status} ·{' '}
              {progress?.total ?? results?.total ?? '—'} stocks
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {resultsFetching ? 'Loading…' : `${results?.total ?? 0} matching`} · defaultSort=
              {results?.defaultSort ?? 'rank'} · sort={results?.sort ?? sort}
            </Typography>
          </Stack>

          <Alert severity="info" sx={{ mb: 2 }}>
            Best Picks uses backend RankingContext order (`preset=BEST_OPPORTUNITIES`). Filters are
            API query params only — the UI never invents a Best Pick score. APPROVE ≠ authorization.
          </Alert>

          <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              Find Best Opportunities
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Target</InputLabel>
                <Select
                  label="Target"
                  value={targetReturn}
                  onChange={(e) => setTargetReturn(e.target.value)}
                >
                  {TARGET_OPTIONS.map((o) => (
                    <MenuItem key={o.value || 'all'} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <InputLabel>Horizon</InputLabel>
                <Select
                  label="Horizon"
                  value={horizon}
                  onChange={(e) => setHorizon(e.target.value)}
                >
                  {HORIZON_OPTIONS.map((h) => (
                    <MenuItem key={h || 'all'} value={h}>
                      {h || 'All'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Confidence</InputLabel>
                <Select
                  label="Confidence"
                  value={bullRunConfidence}
                  onChange={(e) => setBullRunConfidence(e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="HIGH">HIGH</MenuItem>
                  <MenuItem value="MEDIUM">MEDIUM</MenuItem>
                  <MenuItem value="LOW">LOW</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Integrity</InputLabel>
                <Select
                  label="Integrity"
                  value={integrityStatus}
                  onChange={(e) => setIntegrityStatus(e.target.value)}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="NORMAL">NORMAL</MenuItem>
                  <MenuItem value="INVESTIGATE">INVESTIGATE</MenuItem>
                  <MenuItem value="SUSPICIOUS">SUSPICIOUS</MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="contained"
                onClick={() => {
                  setPreset('BEST_OPPORTUNITIES');
                  setSort('rank');
                  setOrder('asc');
                  setViewMode('flat');
                }}
              >
                Find Best Picks
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Confidence is Bull-Run cell confidence (≠ probability). Integrity is advisory
              filtering only.
            </Typography>
          </Paper>

          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            {PRESET_CHIPS.map((c) => (
              <Chip
                key={c.id || 'all'}
                label={c.label}
                color={preset === c.id ? 'primary' : 'default'}
                variant={preset === c.id ? 'filled' : 'outlined'}
                onClick={() => {
                  setPreset(c.id);
                  setSort('rank');
                  setOrder('asc');
                  setViewMode('flat');
                }}
                disabled={c.id === 'BULL_RUN' && results?.bullRunAvailable === false}
              />
            ))}
          </Stack>

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ mb: 2 }}
            flexWrap="wrap"
            useFlexGap
          >
            <TextField
              size="small"
              label="Search symbol / name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              sx={{ minWidth: 180 }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Recommendation</InputLabel>
              <Select
                label="Recommendation"
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
              >
                <MenuItem value="">Any</MenuItem>
                <MenuItem value="APPROVE">APPROVE</MenuItem>
                <MenuItem value="WAIT">WAIT</MenuItem>
                <MenuItem value="REJECT">REJECT</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Bull-Run Stage</InputLabel>
              <Select
                label="Bull-Run Stage"
                value={bullRunStage}
                onChange={(e) => setBullRunStage(e.target.value)}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="EARLY">EARLY</MenuItem>
                <MenuItem value="ACCELERATING">ACCELERATING</MenuItem>
                <MenuItem value="CONFIRMED">CONFIRMED</MenuItem>
                <MenuItem value="MATURE">MATURE</MenuItem>
                <MenuItem value="EARLY,ACCELERATING,CONFIRMED">EARLY / ACCEL / CONF</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Execution Ready</InputLabel>
              <Select
                label="Execution Ready"
                value={executionReady}
                onChange={(e) => setExecutionReady(e.target.value)}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="true">YES</MenuItem>
                <MenuItem value="false">NO</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Data Status</InputLabel>
              <Select
                label="Data Status"
                value={dataStatus}
                onChange={(e) => setDataStatus(e.target.value)}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="LIVE">LIVE</MenuItem>
                <MenuItem value="DELAYED">DELAYED</MenuItem>
                <MenuItem value="STALE">STALE</MenuItem>
                <MenuItem value="OFFLINE">OFFLINE</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Sector"
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              sx={{ minWidth: 140 }}
              placeholder="All"
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={excludeSuspicious}
                  onChange={(e) => setExcludeSuspicious(e.target.checked)}
                />
              }
              label="Exclude Suspicious"
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={excludeInvestigate}
                  onChange={(e) => setExcludeInvestigate(e.target.checked)}
                />
              }
              label="Exclude Investigate"
            />
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Sort</InputLabel>
              <Select
                label="Sort"
                value={sort}
                onChange={(e) => {
                  const next = e.target.value;
                  setSort(next);
                  setOrder(
                    next === 'rank' ||
                      next === 'symbol' ||
                      next === 'direction' ||
                      next === 'horizon'
                      ? 'asc'
                      : 'desc',
                  );
                }}
              >
                <MenuItem value="rank">Backend Rank (default)</MenuItem>
                <MenuItem value="expectedReturn">Expected Return</MenuItem>
                <MenuItem value="upsideProb">Upside Probability</MenuItem>
                <MenuItem value="expectedR">Expected R</MenuItem>
                <MenuItem value="confidence">Confidence</MenuItem>
                <MenuItem value="preferredEntry">Preferred Entry</MenuItem>
                <MenuItem value="target">Target</MenuItem>
                <MenuItem value="direction">Direction</MenuItem>
                <MenuItem value="horizon">Horizon</MenuItem>
                <MenuItem value="recommendation">Recommendation</MenuItem>
                <MenuItem value="symbol">Symbol</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Direction</InputLabel>
              <Select
                label="Direction"
                value={order}
                onChange={(e) => setOrder(e.target.value as 'asc' | 'desc')}
              >
                <MenuItem value="asc">↑ Asc</MenuItem>
                <MenuItem value="desc">↓ Desc</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Page size</InputLabel>
              <Select
                label="Page size"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                {[25, 50, 100].map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            {sort === 'rank'
              ? 'Backend rank (default) — RankingContext canonical order'
              : `Presentation sort: ${sort} ${order === 'desc' ? '↓' : '↑'} — does not change rank`}
            {targetNum != null || horizon
              ? ` · Cell focus: ${horizon || 'any H'} ≥ +${
                  targetNum != null ? Math.round(targetNum * 100) : '?'
                }%`
              : ''}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
            <ToggleButtonGroup
              exclusive
              size="small"
              value={viewMode}
              onChange={(_, v) => v && setViewMode(v)}
            >
              <ToggleButton value="sectors">Sectors first</ToggleButton>
              <ToggleButton value="flat">Flat table</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              Sector grouping is presentation-only.
            </Typography>
          </Stack>

          {(preset === 'BULL_RUN' || results?.preset === 'BULL_RUN') &&
            results?.bullRunAvailable === false && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Bull Run advisory labels are not present on this batch — preset stays empty until
                finalize writes bullRunStage evidence.
              </Alert>
            )}

          {viewMode === 'sectors' ? (
            <Box sx={{ mb: 2 }}>
              {(sectorResults?.sectors ?? []).map((g) => (
                <Accordion key={g.sector} disableGutters>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                      <Typography fontWeight={600} sx={{ flex: 1 }}>
                        {g.sector}
                      </Typography>
                      {g.state ? <Chip size="small" label={g.state} /> : null}
                      <Typography variant="caption" color="text.secondary">
                        {g.memberCount} stocks · {g.bullCandidates} bull candidates
                      </Typography>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>#</TableCell>
                          <TableCell>Symbol</TableCell>
                          <TableCell>Rec</TableCell>
                          <TableCell>Execution Ready</TableCell>
                          <TableCell>Bull stage</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(g.rankings as ResultRow[]).slice(0, 40).map((row) => {
                          const ctx = row.intelligenceContext ?? {};
                          return (
                            <TableRow
                              key={row.symbol}
                              hover
                              sx={{ cursor: 'pointer' }}
                              onClick={() => setDrawerRow(row)}
                            >
                              <TableCell>{row.rank}</TableCell>
                              <TableCell>{row.symbol}</TableCell>
                              <TableCell>
                                {String(ctx.tradePlanRecommendation ?? 'Not available')}
                              </TableCell>
                              <TableCell>
                                {ctx.tradePlanExecutionReady === true
                                  ? 'YES'
                                  : ctx.tradePlanExecutionReady === false
                                    ? 'NO'
                                    : 'Not available'}
                              </TableCell>
                              <TableCell>{String(ctx.bullRunStage ?? 'Not available')}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
              ))}
              {!sectorResults?.sectors?.length ? (
                <Typography variant="body2" color="text.secondary">
                  Sector groups Not available yet for this batch.
                </Typography>
              ) : null}
            </Box>
          ) : null}

          {viewMode === 'flat' ? (
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              spacing={2}
              alignItems="stretch"
              sx={{ minHeight: drawerRow ? 560 : undefined }}
            >
              <Box sx={{ flex: drawerRow ? { lg: '0 0 42%' } : 1, minWidth: 0 }}>
                {horizon && !isOpportunitiesPreset ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mb: 1 }}
                  >
                    Matrix columns = P(≥T within {horizon}) — same semantics as Overview. Missing →
                    —.
                  </Typography>
                ) : null}
                {isOpportunitiesPreset ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mb: 1 }}
                  >
                    Opportunities list — Best Validated Setup from backend Bull-Run cells. Click a
                    row for the detail workspace. Column sort is presentation-only (RankingContext #
                    unchanged).
                  </Typography>
                ) : null}
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Stock</TableCell>
                      {isOpportunitiesPreset ? (
                        <>
                          <TableCell
                            sortDirection={oppColSort?.key === 'setup' ? oppColSort.dir : false}
                          >
                            <TableSortLabel
                              active={oppColSort?.key === 'setup'}
                              direction={oppColSort?.key === 'setup' ? oppColSort.dir : 'desc'}
                              onClick={() => toggleOppColSort('setup')}
                            >
                              Best Validated Setup
                            </TableSortLabel>
                          </TableCell>
                          <TableCell
                            sortDirection={
                              oppColSort?.key === 'probability' ? oppColSort.dir : false
                            }
                          >
                            <TableSortLabel
                              active={oppColSort?.key === 'probability'}
                              direction={
                                oppColSort?.key === 'probability' ? oppColSort.dir : 'desc'
                              }
                              onClick={() => toggleOppColSort('probability')}
                            >
                              Probability
                            </TableSortLabel>
                          </TableCell>
                          <TableCell
                            sortDirection={
                              oppColSort?.key === 'reliability' ? oppColSort.dir : false
                            }
                          >
                            <TableSortLabel
                              active={oppColSort?.key === 'reliability'}
                              direction={
                                oppColSort?.key === 'reliability' ? oppColSort.dir : 'desc'
                              }
                              onClick={() => toggleOppColSort('reliability')}
                            >
                              Reliability
                            </TableSortLabel>
                          </TableCell>
                        </>
                      ) : horizon ? (
                        <>
                          {COMMAND_CENTER_DISPLAY_TARGETS.map((t) => (
                            <TableCell key={t} align="right">
                              +{Math.round(t * 100)}%
                            </TableCell>
                          ))}
                          <TableCell>Confidence</TableCell>
                          <TableCell>Integrity</TableCell>
                          <TableCell>Expected</TableCell>
                          <TableCell>Stage</TableCell>
                          <TableCell>Rec</TableCell>
                          <TableCell>Ready</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell>Target</TableCell>
                          <TableCell>Horizon</TableCell>
                          <TableCell>Probability</TableCell>
                          <TableCell>Confidence</TableCell>
                          <TableCell>Integrity</TableCell>
                          <TableCell>Expected</TableCell>
                          <TableCell>Stage</TableCell>
                          <TableCell>Rec</TableCell>
                          <TableCell>Ready</TableCell>
                        </>
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(displayRankings ?? []).map((r) => {
                      const ctx = r.intelligenceContext ?? {};
                      const cells = readBullRunV2Cells(ctx);
                      const cell = matchDisplayCell(ctx, targetNum, horizon || undefined);
                      const selected = drawerRow?.opportunityId === r.opportunityId;
                      return (
                        <TableRow
                          key={r.opportunityId}
                          hover
                          selected={selected}
                          sx={{ cursor: 'pointer' }}
                          onClick={() => setDrawerRow(r)}
                        >
                          <TableCell>{r.rank}</TableCell>
                          <TableCell>
                            <Stack spacing={0.25}>
                              <Typography variant="body2" fontWeight={600}>
                                {r.symbol}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {r.companyName ??
                                  (r.identityStatus === 'UNKNOWN_QUOTE'
                                    ? 'quote NA'
                                    : 'Name Not available')}
                              </Typography>
                            </Stack>
                          </TableCell>
                          {isOpportunitiesPreset ? (
                            <>
                              <TableCell>
                                {cell
                                  ? formatSetupLabel(cell.h, cell.t)
                                  : cells[0]
                                    ? formatSetupLabel(cells[0].h, cells[0].t)
                                    : 'Not available'}
                              </TableCell>
                              <TableCell>{fmtCellProb(cell?.p ?? cells[0]?.p)}</TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  color={confidenceChipColor(cell?.conf ?? cells[0]?.conf)}
                                  label={formatConfidence(cell?.conf ?? cells[0]?.conf)}
                                />
                              </TableCell>
                            </>
                          ) : horizon ? (
                            <>
                              {COMMAND_CENTER_DISPLAY_TARGETS.map((t) => (
                                <TableCell key={t} align="right">
                                  {formatProbabilityCell(
                                    probabilityFromCompactCells(cells, horizon, t),
                                  )}
                                </TableCell>
                              ))}
                              <TableCell>
                                {cell?.conf ?? 'Not available'}
                                {cell?.conf ? ' (≠ probability)' : ''}
                              </TableCell>
                              <TableCell>
                                {String(ctx.integrityStatus ?? 'Not available')}
                              </TableCell>
                              <TableCell>
                                {fmtRange(ctx.expectedReturnLow, ctx.expectedReturnHigh, '+')}
                              </TableCell>
                              <TableCell>{String(ctx.bullRunStage ?? 'Not available')}</TableCell>
                              <TableCell>
                                {String(ctx.tradePlanRecommendation ?? 'Not available')}
                              </TableCell>
                              <TableCell>
                                {ctx.tradePlanExecutionReady === true
                                  ? 'YES'
                                  : ctx.tradePlanExecutionReady === false
                                    ? 'NO'
                                    : 'Not available'}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell>
                                {cell ? `≥${Math.round(cell.t * 100)}%` : 'Not available'}
                              </TableCell>
                              <TableCell>{cell?.h ?? 'Not available'}</TableCell>
                              <TableCell>{fmtCellProb(cell?.p)}</TableCell>
                              <TableCell>
                                {cell?.conf ?? 'Not available'}
                                {cell?.conf ? ' (≠ probability)' : ''}
                              </TableCell>
                              <TableCell>
                                {String(ctx.integrityStatus ?? 'Not available')}
                              </TableCell>
                              <TableCell>
                                {fmtRange(ctx.expectedReturnLow, ctx.expectedReturnHigh, '+')}
                              </TableCell>
                              <TableCell>{String(ctx.bullRunStage ?? 'Not available')}</TableCell>
                              <TableCell>
                                {String(ctx.tradePlanRecommendation ?? 'Not available')}
                              </TableCell>
                              <TableCell>
                                {ctx.tradePlanExecutionReady === true
                                  ? 'YES'
                                  : ctx.tradePlanExecutionReady === false
                                    ? 'NO'
                                    : 'Not available'}
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      );
                    })}
                    {showResults && (results?.rankings?.length ?? 0) === 0 && (
                      <TableRow>
                        <TableCell colSpan={11}>
                          <Alert severity="info">
                            No suitable opportunity found for the selected criteria. Clear filters
                            or wait for finalize — never force a pick.
                          </Alert>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
                  <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Prev
                  </Button>
                  <Typography variant="body2">
                    Page {page} / {totalPages}
                  </Typography>
                  <Button
                    size="small"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </Stack>
              </Box>

              {drawerRow ? (
                <Paper
                  variant="outlined"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    p: 2,
                    maxHeight: { lg: '78vh' },
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <OpportunityDetailPanel
                    row={{
                      symbol: drawerRow.symbol,
                      companyName: drawerRow.companyName,
                      rank: drawerRow.rank,
                      exchange: drawerRow.exchange,
                      sector: drawerRow.sector,
                      price: drawerRow.price,
                      opportunityId: drawerRow.opportunityId,
                      intelligenceContext: drawerRow.intelligenceContext,
                    }}
                    selectedTarget={targetNum}
                    selectedHorizon={horizon || undefined}
                    batchId={activeId ?? undefined}
                    onClose={() => setDrawerRow(null)}
                  />
                </Paper>
              ) : null}
            </Stack>
          ) : null}
        </Paper>
      )}
    </Box>
  );
}
