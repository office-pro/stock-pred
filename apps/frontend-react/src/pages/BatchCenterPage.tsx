import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
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

const SELECTED_KEY = 'intel-batch-selected-id';

const ACTIVE_POLL = new Set(['CREATED', 'QUEUED', 'RUNNING', 'RESUMING', 'PAUSED']);

const PRESETS = [
  { id: '', label: 'All (backend rank)' },
  { id: 'BEST_OPPORTUNITIES', label: 'Best Opportunities' },
  { id: 'HIGH_CONFIDENCE', label: 'High Confidence' },
  { id: 'HIGHEST_EXPECTED_RETURN', label: 'Highest Expected Return' },
  { id: 'HIGHEST_EXPECTED_R', label: 'Highest Expected R' },
  { id: 'MULTI_HORIZON_ALIGNED', label: 'Multi-Horizon Aligned' },
  { id: 'BULL_RUN', label: 'Bull Run' },
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

function fmtPct(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  // upsideProbability is [0,1]; expected return already %
  return n <= 1 && n >= 0 ? `${Math.round(n * 100)}%` : `${n.toFixed(1)}%`;
}

function fmtNum(v: unknown, digits = 2): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

function fmtRange(low: unknown, high: unknown, prefix = ''): string {
  if (low == null && high == null) return '—';
  if (low != null && high != null) return `${prefix}${fmtNum(low)}–${prefix}${fmtNum(high)}`;
  return `${prefix}${fmtNum(low ?? high)}`;
}

function na(v: unknown): string {
  if (v == null || v === '') return 'Not available';
  return String(v);
}

type ResultRow = {
  rank: number;
  symbol: string;
  opportunityId: string;
  companyName?: string;
  exchange?: string;
  identityStatus?: string;
  price?: number;
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
  const [drawerRow, setDrawerRow] = useState<ResultRow | null>(null);
  const [diagStage, setDiagStage] = useState<'ml' | 'rs' | null>(null);
  const [viewMode, setViewMode] = useState<'sectors' | 'flat'>('sectors');
  const [easyPro, setEasyPro] = useState<'easy' | 'pro'>('easy');

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [qDebounced, preset, recommendation, sort, order, pageSize, selectedId]);

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

  const drawerCtx = drawerRow?.intelligenceContext ?? {};

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
              Discovery results
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {resultsFetching ? 'Loading…' : `${results?.total ?? 0} matching`} · defaultSort=
              {results?.defaultSort ?? 'rank'} · sort={results?.sort ?? sort}
            </Typography>
          </Stack>

          <Alert severity="info" sx={{ mb: 2 }}>
            Backend rank is canonical. Presentation sort never changes RankingContext. APPROVE is
            advisory only — it does not authorize trades or bypass evaluateTrade().
          </Alert>

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ mb: 2 }}
            flexWrap="wrap"
          >
            <TextField
              size="small"
              label="Search symbol / name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              sx={{ minWidth: 180 }}
            />
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Preset</InputLabel>
              <Select label="Preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {PRESETS.map((p) => (
                  <MenuItem
                    key={p.id || 'all'}
                    value={p.id}
                    disabled={p.id === 'BULL_RUN' && results?.bullRunAvailable === false}
                  >
                    {p.id === 'BULL_RUN' && results?.bullRunAvailable === false
                      ? 'Bull Run (Not available)'
                      : p.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Symbol</TableCell>
                    <TableCell>Direction</TableCell>
                    <TableCell>Upside</TableCell>
                    <TableCell>Expected</TableCell>
                    <TableCell>Buy Zone</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>R</TableCell>
                    <TableCell>Horizon</TableCell>
                    <TableCell>Conf</TableCell>
                    <TableCell>ML</TableCell>
                    <TableCell>Rec</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(results?.rankings ?? []).map((r) => {
                    const ctx = r.intelligenceContext ?? {};
                    return (
                      <TableRow
                        key={r.opportunityId}
                        hover
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
                                (r.identityStatus === 'UNKNOWN_QUOTE' ? 'quote NA' : '')}
                            </Typography>
                            {typeof ctx.tradePlanStatus === 'string' ? (
                              <Chip
                                size="small"
                                label={ctx.tradePlanStatus}
                                color={
                                  ctx.tradePlanStatus === 'COMPLETE'
                                    ? 'success'
                                    : ctx.tradePlanStatus === 'PARTIAL'
                                      ? 'warning'
                                      : 'default'
                                }
                                variant="outlined"
                                sx={{ alignSelf: 'flex-start', height: 20 }}
                              />
                            ) : null}
                            {ctx.tradePlanRecommendation === 'APPROVE' &&
                            ctx.tradePlanExecutionReady === false ? (
                              <Chip
                                size="small"
                                label="Not execution-ready"
                                color="warning"
                                variant="outlined"
                                sx={{ alignSelf: 'flex-start', height: 20 }}
                              />
                            ) : null}
                            {ctx.quoteStatus === 'MDS_UNAVAILABLE' ? (
                              <Chip
                                size="small"
                                label="MDS quote unavailable"
                                variant="outlined"
                                sx={{ alignSelf: 'flex-start', height: 20 }}
                              />
                            ) : null}
                            {typeof ctx.bullRunStage === 'string' ? (
                              <Chip
                                size="small"
                                label={`Bull ${ctx.bullRunStage}`}
                                variant="outlined"
                                sx={{ alignSelf: 'flex-start', height: 20 }}
                              />
                            ) : null}
                            {typeof ctx.sectorState === 'string' ? (
                              <Chip
                                size="small"
                                label={`Sector ${ctx.sectorState}`}
                                variant="outlined"
                                sx={{ alignSelf: 'flex-start', height: 20 }}
                              />
                            ) : null}
                          </Stack>
                        </TableCell>
                        <TableCell>{na(ctx.tradePlanDirection)}</TableCell>
                        <TableCell>
                          {ctx.upsideProbability != null ? fmtPct(ctx.upsideProbability) : '—'}
                        </TableCell>
                        <TableCell>
                          {fmtRange(ctx.expectedReturnLow, ctx.expectedReturnHigh, '+')}
                        </TableCell>
                        <TableCell>{fmtRange(ctx.buyZoneLow, ctx.buyZoneHigh, '₹')}</TableCell>
                        <TableCell>
                          {ctx.target1 != null ? `₹${fmtNum(ctx.target1)}` : '—'}
                        </TableCell>
                        <TableCell>
                          {ctx.tradePlanExpectedR != null
                            ? `${fmtNum(ctx.tradePlanExpectedR, 1)}R`
                            : '—'}
                        </TableCell>
                        <TableCell>{na(ctx.tradePlanHorizon)}</TableCell>
                        <TableCell>
                          {ctx.tradePlanConfidence != null
                            ? fmtNum(ctx.tradePlanConfidence, 0)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {ctx.mlDirection ? `${ctx.mlDirection}` : 'Not available'}
                        </TableCell>
                        <TableCell>{na(ctx.tradePlanRecommendation)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {showResults && (results?.rankings?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={12}>
                        <Alert severity="info">
                          No rows for this filter/preset. Clear filters or wait for finalize.
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
            </>
          ) : null}
        </Paper>
      )}

      <Drawer anchor="right" open={!!drawerRow} onClose={() => setDrawerRow(null)}>
        <Box sx={{ width: { xs: 320, sm: 420 }, p: 2 }}>
          {drawerRow && (
            <>
              <Typography variant="h6" fontWeight={700}>
                {drawerRow.symbol}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {drawerRow.companyName ?? 'Company name Not available'} · rank #{drawerRow.rank}
                {drawerRow.identityStatus ? ` · ${drawerRow.identityStatus}` : ''}
              </Typography>
              <Alert severity="warning" sx={{ mb: 2 }}>
                APPROVE ≠ Authorization. This drawer is presentation-only. Trades still require
                evaluateTrade() → Risk → Portfolio → Policy → Gate.
                {drawerCtx.tradePlanRecommendation === 'APPROVE' &&
                drawerCtx.tradePlanExecutionReady === false
                  ? ' APPROVE + PARTIAL is advisory only — Not execution-ready.'
                  : ''}
              </Alert>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={easyPro}
                onChange={(_, v) => v && setEasyPro(v)}
                sx={{ mb: 2 }}
              >
                <ToggleButton value="easy">Easy</ToggleButton>
                <ToggleButton value="pro">Pro</ToggleButton>
              </ToggleButtonGroup>
              {easyPro === 'easy' ? (
                <Stack spacing={0.75} sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    Recommendation: {String(drawerCtx.tradePlanRecommendation ?? 'Not available')}
                  </Typography>
                  <Typography variant="body2">
                    Execution Ready:{' '}
                    {drawerCtx.tradePlanExecutionReady === true
                      ? 'YES'
                      : drawerCtx.tradePlanExecutionReady === false
                        ? 'NO'
                        : 'Not available'}
                  </Typography>
                  <Typography variant="body2">
                    Bull-Run stage: {String(drawerCtx.bullRunStage ?? 'Not available')}
                  </Typography>
                  <Typography variant="body2">
                    Data:{' '}
                    {String(
                      drawerCtx.bullRunDataStatus ?? drawerCtx.quoteStatus ?? 'Not available',
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Probabilities (if shown) are estimates — not guarantees.
                  </Typography>
                </Stack>
              ) : null}
              {easyPro === 'pro' ? (
                <Stack spacing={0.75}>
                  <Typography variant="body2">
                    TradePlan status: {na(drawerCtx.tradePlanStatus)}
                    {drawerCtx.tradePlanExecutionReady === true
                      ? ' · executionReady'
                      : drawerCtx.tradePlanExecutionReady === false
                        ? ' · Not execution-ready'
                        : ''}
                    {drawerCtx.quoteStatus && drawerCtx.quoteStatus !== 'VALID'
                      ? ` · quote ${drawerCtx.quoteStatus}`
                      : ''}
                    {Array.isArray(drawerCtx.tradePlanMissingFields) &&
                    (drawerCtx.tradePlanMissingFields as string[]).length > 0
                      ? ` (missing: ${(drawerCtx.tradePlanMissingFields as string[]).join(', ')})`
                      : ''}
                  </Typography>
                  <Typography variant="body2">
                    Recommendation: {na(drawerCtx.tradePlanRecommendation)}
                  </Typography>
                  <Typography variant="body2">
                    Direction: {na(drawerCtx.tradePlanDirection)}
                  </Typography>
                  <Typography variant="body2">
                    Upside:{' '}
                    {drawerCtx.upsideProbability != null
                      ? fmtPct(drawerCtx.upsideProbability)
                      : 'Not available'}
                  </Typography>
                  <Typography variant="body2">
                    Expected return:{' '}
                    {fmtRange(drawerCtx.expectedReturnLow, drawerCtx.expectedReturnHigh, '+')}
                  </Typography>
                  <Typography variant="body2">
                    Buy zone: {fmtRange(drawerCtx.buyZoneLow, drawerCtx.buyZoneHigh, '₹')}
                  </Typography>
                  <Typography variant="body2">
                    Preferred entry:{' '}
                    {drawerCtx.preferredEntry != null
                      ? `₹${fmtNum(drawerCtx.preferredEntry)}`
                      : 'Not available'}
                  </Typography>
                  <Typography variant="body2">
                    Targets: t1={drawerCtx.target1 != null ? `₹${fmtNum(drawerCtx.target1)}` : '—'}{' '}
                    t2={drawerCtx.target2 != null ? `₹${fmtNum(drawerCtx.target2)}` : '—'} t3=
                    {drawerCtx.target3 != null ? `₹${fmtNum(drawerCtx.target3)}` : '—'}
                  </Typography>
                  <Typography variant="body2">
                    Invalidation:{' '}
                    {drawerCtx.invalidationPrice != null
                      ? `₹${fmtNum(drawerCtx.invalidationPrice)}`
                      : 'Not available'}
                  </Typography>
                  <Typography variant="body2">
                    Expected R:{' '}
                    {drawerCtx.tradePlanExpectedR != null
                      ? `${fmtNum(drawerCtx.tradePlanExpectedR, 1)}R`
                      : 'Not available'}
                  </Typography>
                  <Typography variant="body2">Horizon: {na(drawerCtx.tradePlanHorizon)}</Typography>
                  <Typography variant="body2">
                    Confidence:{' '}
                    {drawerCtx.tradePlanConfidence != null
                      ? fmtNum(drawerCtx.tradePlanConfidence, 0)
                      : 'Not available'}
                  </Typography>
                  <Typography variant="body2">Exit: {na(drawerCtx.exitStrategy)}</Typography>
                  <Typography variant="body2">
                    Opportunity quality: {na(drawerCtx.opportunityQuality)}
                  </Typography>
                  <Typography variant="body2">Thesis state: {na(drawerCtx.thesisState)}</Typography>
                  <Typography variant="body2">Regime: {na(drawerCtx.regimeCombo)}</Typography>
                  <Typography variant="body2">
                    ML:{' '}
                    {drawerCtx.mlDirection
                      ? `${drawerCtx.mlDirection} (${drawerCtx.mlConfidence ?? '—'})`
                      : 'Not available'}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Why: {na(drawerCtx.thesis)}
                  </Typography>
                </Stack>
              ) : null}
              <Button
                sx={{ mt: 2 }}
                component={RouterLink}
                to={`/desk/trade-plan/${drawerRow.symbol}?opportunityId=${encodeURIComponent(drawerRow.opportunityId)}`}
                size="small"
              >
                Open Trade Plan page
              </Button>
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  );
}
