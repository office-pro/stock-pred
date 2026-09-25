import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import type { DataSourceStatus } from '@stockpred/shared-types';
import {
  batchReadinessHeadline,
  contextNumeric,
  coverageStatusTone,
  displayRecommendation,
  filterHistoryRows,
  formatBatchDuration,
  formatCoveragePct,
  formatTimestamp,
  frozenResultIdentity,
  hasBatchReadinessDenominator,
  resultNumericField,
  statusChipColor,
  validResultRows,
  type FrozenResultIdentity,
  type HistoryBatchLike,
  type OverviewKpi,
  type SnapshotCoverageRow,
  type WizardStageState,
} from '../../lib/multi-asset-batch';
import { KPI_SX, PANEL_SX, QueryState, WorkstationPanel } from './workstation-chrome';

export function UniverseSummary({
  name,
  description,
  instrumentCount,
  assetClass,
  venue,
  market,
  onEdit,
}: {
  name: string;
  description: string;
  instrumentCount?: number;
  assetClass?: string;
  venue?: string;
  market: string;
  onEdit?: () => void;
}): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography fontWeight={700}>Selected Universe Summary</Typography>
        {onEdit ? (
          <Button size="small" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </Stack>
      <Typography mt={1}>{name}</Typography>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
      <Typography variant="body2" mt={1}>
        Total symbols {instrumentCount ?? 'Not available'}
      </Typography>
      <Typography variant="body2">Asset Class {assetClass ?? 'Not available'}</Typography>
      <Typography variant="body2">Exchange {venue ?? 'Not available'}</Typography>
      <Typography variant="body2">Market {market}</Typography>
    </Paper>
  );
}

export function AnalysisConfiguration({
  universeName,
  totalSymbols,
  analysisPeriod,
  predictionHorizon,
  mode,
  analysisResolution,
  predefinedNote,
  onEdit,
}: {
  universeName: string;
  totalSymbols: string | number;
  analysisPeriod: string;
  predictionHorizon: string;
  mode: string;
  analysisResolution: string;
  predefinedNote?: string;
  onEdit?: () => void;
}): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography fontWeight={700}>Analysis Configuration</Typography>
        {onEdit ? (
          <Button size="small" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </Stack>
      <Typography variant="body2" mt={1}>
        Universe {universeName}
      </Typography>
      <Typography variant="body2">Total Symbols {totalSymbols}</Typography>
      <Typography variant="body2">Analysis Period {analysisPeriod}</Typography>
      <Typography variant="body2">Prediction Horizon {predictionHorizon}</Typography>
      <Typography variant="body2">Mode {mode}</Typography>
      <Typography variant="body2">Analysis Resolution {analysisResolution}</Typography>
      {predefinedNote ? (
        <Typography variant="body2" color="text.secondary" mt={1}>
          {predefinedNote}
        </Typography>
      ) : null}
    </Paper>
  );
}

export function CapabilityCoverageTable({
  rows,
  onSelect,
}: {
  rows: SnapshotCoverageRow[];
  onSelect?: (row: SnapshotCoverageRow) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" mt={1}>
        Not available until this batch produces a frozen snapshot.
      </Typography>
    );
  }
  return (
    <Table size="small" data-testid="coverage-table">
      <TableHead>
        <TableRow>
          <TableCell>Capability</TableCell>
          <TableCell>Required</TableCell>
          <TableCell align="right">Eligible</TableCell>
          <TableCell align="right">Available</TableCell>
          <TableCell align="right">Partial</TableCell>
          <TableCell align="right">Unavailable</TableCell>
          <TableCell align="right">N/A</TableCell>
          <TableCell align="right">Coverage</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.capability}
            hover={Boolean(onSelect)}
            onClick={() => onSelect?.(row)}
            sx={{ cursor: onSelect ? 'pointer' : undefined }}
          >
            <TableCell>{row.capability}</TableCell>
            <TableCell>{row.status === 'N/A' ? 'No' : 'Yes'}</TableCell>
            <TableCell align="right">{row.eligible}</TableCell>
            <TableCell align="right">{row.available}</TableCell>
            <TableCell align="right">{row.partial}</TableCell>
            <TableCell align="right">{row.unavailable}</TableCell>
            <TableCell align="right">{row.na}</TableCell>
            <TableCell align="right">{formatCoveragePct(row.coveragePct, row.status)}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={row.status}
                color={coverageStatusTone(row.status)}
                variant={row.status === 'N/A' || row.status === 'PENDING' ? 'outlined' : 'filled'}
                data-testid={`coverage-status-${row.capability}`}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CoverageDonut({
  coveragePct,
}: {
  rows?: SnapshotCoverageRow[];
  coveragePct?: number | null;
}): JSX.Element {
  const headline = batchReadinessHeadline(coveragePct);
  const showDonut = hasBatchReadinessDenominator(coveragePct);
  return (
    <Paper variant="outlined" sx={{ ...PANEL_SX, height: '100%' }} data-testid="coverage-overview">
      <Typography fontWeight={700}>Batch Readiness</Typography>
      <Typography variant="h4" fontWeight={800} mt={1} data-testid="readiness-headline">
        {headline}
      </Typography>
      <Typography variant="body2" color="text.secondary" mt={1}>
        {showDonut
          ? 'Single backend batch-level coveragePct'
          : 'Not available — no single batch-level denominator'}
      </Typography>
    </Paper>
  );
}

export function DataQualityPanel({
  identityCounts,
}: {
  identityCounts?: { eligible: number; valid: number; quarantined: number };
}): JSX.Element {
  return (
    <Paper variant="outlined" sx={PANEL_SX} data-testid="data-quality">
      <Typography fontWeight={700}>Data Quality</Typography>
      <Stack spacing={0.75} mt={1}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Valid Symbols</Typography>
          <Typography variant="body2">{identityCounts?.valid ?? 'Not available'}</Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Quarantined</Typography>
          <Typography variant="body2">{identityCounts?.quarantined ?? 'Not available'}</Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="body2">Total Symbols</Typography>
          <Typography variant="body2">{identityCounts?.eligible ?? 'Not available'}</Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function DataSourceList({ sources }: { sources: DataSourceStatus[] }): JSX.Element {
  if (sources.length === 0) {
    return (
      <Typography color="text.secondary">
        Not available until a canonical source is configured.
      </Typography>
    );
  }
  return (
    <Stack spacing={1.25} data-testid="data-source-list">
      {sources.map((row) => (
        <Box key={row.id}>
          <Stack direction="row" justifyContent="space-between" gap={1}>
            <Typography variant="body2">{row.label}</Typography>
            <Chip
              size="small"
              label={row.capabilityState ?? 'UNKNOWN'}
              color={coverageStatusTone(row.capabilityState)}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Provider: {row.provider ?? 'Not available'} · Status:{' '}
            {row.dataStatus ?? 'Not available'}
            {row.dataAsOf != null ? ` · as of ${formatTimestamp(Number(row.dataAsOf))}` : ''}
            {row.dataAgeMs != null ? ` · age ${row.dataAgeMs}ms` : ''}
          </Typography>
          {row.reason ? (
            <Typography variant="caption" display="block" color="text.secondary">
              {row.reason}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Stack>
  );
}

type ResultRow = {
  rank: number;
  symbol: string;
  opportunityId: string;
  companyName?: string;
  exchange?: string;
  sector?: string;
  instrument?: { symbol?: string; venue?: string; assetClass?: string };
  recommendation?: string;
  reason?: string;
  reasonCode?: string;
  quarantined?: boolean;
  quarantineStatus?: string;
  intelligenceContext?: Record<string, unknown>;
};

function RecommendationChip({ value }: { value?: string }): JSX.Element {
  const label = displayRecommendation(value);
  return (
    <Chip
      size="small"
      label={label}
      color={label === 'Not available' ? 'default' : coverageStatusTone(label)}
    />
  );
}

export function ResultsSummary({
  rankings,
  onSelect,
}: {
  rankings: ResultRow[] | undefined;
  onSelect?: (row: FrozenResultIdentity) => void;
}): JSX.Element {
  const rows = validResultRows(rankings).map(frozenResultIdentity);
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" data-testid="batch-results-table">
        Not available
      </Typography>
    );
  }
  return (
    <Table size="small" data-testid="batch-results-table">
      <TableHead>
        <TableRow>
          <TableCell>Rank</TableCell>
          <TableCell>Symbol</TableCell>
          <TableCell>Name</TableCell>
          <TableCell>Sector</TableCell>
          <TableCell>Asset Class</TableCell>
          <TableCell>Score</TableCell>
          <TableCell>Expected R</TableCell>
          <TableCell>ML Conf</TableCell>
          <TableCell>Plan Conf</TableCell>
          <TableCell>Recommendation</TableCell>
          <TableCell>Reason</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow
            key={`${row.symbol}-${index}`}
            hover={Boolean(onSelect)}
            onClick={() => onSelect?.(row)}
            sx={{ cursor: onSelect ? 'pointer' : undefined }}
          >
            <TableCell>{resultNumericField(row.rank)}</TableCell>
            <TableCell>{row.symbol}</TableCell>
            <TableCell>{row.companyName ?? 'Not available'}</TableCell>
            <TableCell>{row.sector ?? 'Not available'}</TableCell>
            <TableCell>{row.assetClass ?? 'Not available'}</TableCell>
            <TableCell>{contextNumeric(row.intelligenceContext, 'overallScore')}</TableCell>
            <TableCell>{contextNumeric(row.intelligenceContext, 'tradePlanExpectedR')}</TableCell>
            <TableCell>{contextNumeric(row.intelligenceContext, 'mlConfidence')}</TableCell>
            <TableCell>{contextNumeric(row.intelligenceContext, 'tradePlanConfidence')}</TableCell>
            <TableCell>
              <RecommendationChip value={row.recommendation} />
            </TableCell>
            <TableCell>{row.reason ?? 'Not available'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TopOpportunities({
  rankings,
  onSelect,
}: {
  rankings: ResultRow[] | undefined;
  onSelect?: (row: FrozenResultIdentity) => void;
}): JSX.Element {
  const rows = validResultRows(rankings).slice(0, 10).map(frozenResultIdentity);
  return (
    <Paper variant="outlined" sx={PANEL_SX} data-testid="top-opportunities">
      <Typography fontWeight={700}>Top Opportunities</Typography>
      <Stack spacing={1} mt={1.5}>
        {rows.length === 0 ? (
          <Typography color="text.secondary">Not available</Typography>
        ) : (
          rows.map((row) => (
            <Stack
              key={`${row.symbol}-${row.rank ?? ''}`}
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              gap={1}
              onClick={() => onSelect?.(row)}
              sx={{ cursor: onSelect ? 'pointer' : undefined }}
            >
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {resultNumericField(row.rank)} {row.symbol}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Score {contextNumeric(row.intelligenceContext, 'overallScore')} · R{' '}
                  {contextNumeric(row.intelligenceContext, 'tradePlanExpectedR')}
                </Typography>
              </Box>
              <RecommendationChip value={row.recommendation} />
            </Stack>
          ))
        )}
      </Stack>
    </Paper>
  );
}

export function BatchProgress({
  stages,
  percent,
  copy,
  backendStages,
}: {
  stages: ReadonlyArray<{ id: string; label: string; state: WizardStageState }>;
  percent?: number;
  copy?: string;
  backendStages?: Array<{ id: string; availability: string; done: number; total: number }>;
}): JSX.Element {
  const byId = new Map((backendStages ?? []).map((row) => [row.id, row]));
  return (
    <Box data-testid="batch-progress">
      {copy ? (
        <Typography variant="body2" color="text.secondary" mb={1}>
          {copy}
        </Typography>
      ) : null}
      <Typography variant="body2" fontWeight={700} mb={1}>
        Overall {percent == null ? 'Not available' : `${percent}%`}
      </Typography>
      {percent != null ? (
        <LinearProgress
          variant="determinate"
          value={percent}
          sx={{ mb: 2, height: 8, borderRadius: 1 }}
        />
      ) : null}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Stage</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Progress</TableCell>
            <TableCell>Processed/Total</TableCell>
            <TableCell>ETA</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {stages.map((stage) => {
            const backend = byId.get(stage.id);
            const processed =
              backend != null ? `${backend.done}/${backend.total}` : 'Not available';
            return (
              <TableRow key={stage.id}>
                <TableCell>{stage.label}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={stage.state}
                    data-testid={`progress-stage-${stage.id}`}
                    data-state={stage.state}
                    color={
                      stage.state === 'complete' || stage.state === 'active'
                        ? 'success'
                        : stage.state === 'unavailable'
                          ? 'error'
                          : 'default'
                    }
                  />
                </TableCell>
                <TableCell>
                  {backend != null && backend.total > 0
                    ? `${Math.round((backend.done / backend.total) * 100)}%`
                    : 'Not available'}
                </TableCell>
                <TableCell>{processed}</TableCell>
                <TableCell>Not available</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

export function ResultDetailsDrawer({
  row,
  onClose,
}: {
  row: FrozenResultIdentity | null;
  onClose: () => void;
}): JSX.Element {
  const ctx = row?.intelligenceContext;
  return (
    <Drawer anchor="right" open={Boolean(row)} onClose={onClose}>
      <Box sx={{ width: { xs: 320, sm: 400 }, p: 2 }} data-testid="result-details-drawer">
        <Typography fontWeight={750}>Result Details</Typography>
        {row ? (
          <Stack spacing={1} mt={2}>
            <Typography variant="h6">{row.symbol}</Typography>
            <Typography variant="body2">
              {row.venue ?? 'Not available'} / {row.assetClass ?? 'Not available'}
            </Typography>
            <RecommendationChip value={row.recommendation} />
            <Typography variant="body2">Reason {row.reason ?? 'Not available'}</Typography>
            <Typography variant="body2">Reason code {row.reasonCode ?? 'Not available'}</Typography>
            <Typography variant="body2">Sector {row.sector ?? 'Not available'}</Typography>
            <Typography variant="body2">Rank {resultNumericField(row.rank)}</Typography>
            <Typography variant="body2">Score {contextNumeric(ctx, 'overallScore')}</Typography>
            <Typography variant="body2">
              Expected R {contextNumeric(ctx, 'tradePlanExpectedR')}
            </Typography>
            <Typography variant="body2">
              ML confidence {contextNumeric(ctx, 'mlConfidence')}
            </Typography>
            <Typography variant="body2">
              Trade plan confidence {contextNumeric(ctx, 'tradePlanConfidence')}
            </Typography>
            <Typography variant="body2">
              Thesis {typeof ctx?.thesis === 'string' ? ctx.thesis : 'Not available'}
            </Typography>
            <Typography variant="body2">
              Decision {typeof ctx?.decision === 'string' ? ctx.decision : 'Not available'}
            </Typography>
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  );
}

export function CapabilityDetailsDrawer({
  row,
  onClose,
}: {
  row: SnapshotCoverageRow | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Drawer anchor="right" open={Boolean(row)} onClose={onClose}>
      <Box sx={{ width: 360, p: 2 }} data-testid="capability-details-drawer">
        <Typography fontWeight={750}>Capability details</Typography>
        {row ? (
          <Stack spacing={1} mt={2}>
            <Typography variant="body2">Capability {row.capability}</Typography>
            <Typography variant="body2">Status {row.status}</Typography>
            <Typography variant="body2">
              Coverage {formatCoveragePct(row.coveragePct, row.status)}
            </Typography>
            <Typography variant="body2">Reason {row.reason ?? 'Not available'}</Typography>
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  );
}

export function OptionChips({
  options,
  value,
  onChange,
  testId,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  testId?: string;
}): JSX.Element {
  return (
    <Stack direction="row" flexWrap="wrap" gap={1} data-testid={testId}>
      {options.map((opt) => (
        <Chip
          key={opt.id}
          label={opt.label}
          clickable
          color={value === opt.id ? 'primary' : 'default'}
          variant={value === opt.id ? 'filled' : 'outlined'}
          onClick={() => onChange(opt.id)}
        />
      ))}
    </Stack>
  );
}

export function OverviewHome({
  kpis,
  recent,
  recentLoading,
  recentError,
  onRetryRecent,
  onViewAll,
  onView,
  onNewBatch,
}: {
  kpis: OverviewKpi[];
  recent: HistoryBatchLike[];
  recentLoading: boolean;
  recentError: boolean;
  onRetryRecent: () => void;
  onViewAll: () => void;
  onView: (batchId: string) => void;
  onNewBatch: () => void;
}): JSX.Element {
  return (
    <Stack spacing={2} data-testid="screen-overview">
      <WorkstationPanel>
        <Typography fontWeight={750} mb={1.5}>
          Latest Batch Status / Health
        </Typography>
        <QueryState
          loading={recentLoading}
          error={recentError}
          errorMessage="Unable to load batch history"
          onRetry={onRetryRecent}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, 1fr)',
                md: 'repeat(3, 1fr)',
                lg: 'repeat(6, 1fr)',
              },
              gap: 1.25,
            }}
          >
            {kpis.map((kpi) => (
              <Paper key={kpi.id} variant="outlined" sx={KPI_SX} data-testid={`kpi-${kpi.id}`}>
                <Typography variant="h5" fontWeight={800} color="primary.light">
                  {kpi.value}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {kpi.label}
                </Typography>
                <Typography variant="caption" color="success.light">
                  {kpi.detail}
                </Typography>
              </Paper>
            ))}
          </Box>
        </QueryState>
      </WorkstationPanel>
      <WorkstationPanel>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
          <Typography fontWeight={750}>Recent Batches</Typography>
          <Button size="small" onClick={onViewAll}>
            View All →
          </Button>
        </Stack>
        <QueryState
          loading={recentLoading}
          error={recentError}
          errorMessage="Unable to load batch history"
          onRetry={onRetryRecent}
        >
          {recent.length === 0 ? (
            <Typography color="text.secondary">Not available</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Batch ID</TableCell>
                  <TableCell>Universe</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recent.slice(0, 5).map((row) => (
                  <TableRow key={row.batchId}>
                    <TableCell>{row.batchId}</TableCell>
                    <TableCell>{row.universe}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.status} color={statusChipColor(row.status)} />
                    </TableCell>
                    <TableCell>{formatTimestamp(row.startedAt ?? row.createdAt)}</TableCell>
                    <TableCell>{formatBatchDuration(row.startedAt, row.completedAt)}</TableCell>
                    <TableCell>
                      <Button size="small" onClick={() => onView(row.batchId)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryState>
      </WorkstationPanel>
      <WorkstationPanel>
        <Typography fontWeight={750} mb={1}>
          Create New Batch
        </Typography>
        <Button variant="contained" onClick={onNewBatch} data-testid="overview-new-batch">
          + New Batch
        </Button>
      </WorkstationPanel>
    </Stack>
  );
}

export type HistoryBatchRow = HistoryBatchLike;

export function BatchHistoryTable({
  rows,
  loading,
  error,
  onRetry,
  query,
  universeFilter,
  statusFilter,
  startDate,
  endDate,
  onQuery,
  onUniverseFilter,
  onStatusFilter,
  onStartDate,
  onEndDate,
  onClear,
  onView,
  onNewBatch,
  page,
  onPage,
}: {
  rows: HistoryBatchLike[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  query: string;
  universeFilter: string;
  statusFilter: string;
  startDate: string;
  endDate: string;
  onQuery: (value: string) => void;
  onUniverseFilter: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onStartDate: (value: string) => void;
  onEndDate: (value: string) => void;
  onClear: () => void;
  onView: (batchId: string) => void;
  onNewBatch: () => void;
  page: number;
  onPage: (page: number) => void;
}): JSX.Element {
  const source = rows ?? [];
  const universes = [...new Set(source.map((row) => row.universe))].sort();
  const statuses = [...new Set(source.map((row) => row.status))].sort();
  const filtered = filterHistoryRows(source, {
    query,
    universe: universeFilter,
    status: statusFilter,
    startDate,
    endDate,
  });
  const pageSize = 8;
  const start = page * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  const emptySuccess = !loading && !error && source.length === 0;
  const filteredEmpty = !loading && !error && source.length > 0 && filtered.length === 0;

  const filters = (
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} mb={2} flexWrap="wrap">
      <TextField
        size="small"
        label="Search by batch ID, universe or notes…"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        sx={{ flex: 1, minWidth: 220 }}
      />
      <TextField
        select
        size="small"
        label="All Universes"
        value={universeFilter}
        onChange={(event) => onUniverseFilter(event.target.value)}
        sx={{ minWidth: 160 }}
      >
        <MenuItem value="">All Universes</MenuItem>
        {universes.map((id) => (
          <MenuItem key={id} value={id}>
            {id}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="All Status"
        value={statusFilter}
        onChange={(event) => onStatusFilter(event.target.value)}
        sx={{ minWidth: 140 }}
      >
        <MenuItem value="">All Status</MenuItem>
        {statuses.map((id) => (
          <MenuItem key={id} value={id}>
            {id}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        type="date"
        label="Start date"
        value={startDate}
        InputLabelProps={{ shrink: true }}
        onChange={(event) => onStartDate(event.target.value)}
      />
      <TextField
        size="small"
        type="date"
        label="End date"
        value={endDate}
        InputLabelProps={{ shrink: true }}
        onChange={(event) => onEndDate(event.target.value)}
      />
      <Button onClick={onClear}>Clear</Button>
    </Stack>
  );

  if (emptySuccess) {
    return (
      <Box data-testid="screen-history">
        {filters}
        <Paper
          variant="outlined"
          sx={{ ...PANEL_SX, py: 6, textAlign: 'center' }}
          data-testid="screen-history-empty"
        >
          <Box
            sx={{
              width: 88,
              height: 88,
              mx: 'auto',
              mb: 2,
              borderRadius: 3,
              bgcolor: 'rgba(56,189,248,0.12)',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 0 40px rgba(56,189,248,0.25)',
              fontSize: 36,
            }}
          >
            ⌕
          </Box>
          <Typography variant="h5" fontWeight={800}>
            No Batch History Found
          </Typography>
          <Typography color="text.secondary" mt={1} mb={2} maxWidth={480} mx="auto">
            You haven't run any analysis batches yet. Start your first batch to analyze stocks,
            indices, commodities, crypto and more across global markets.
          </Typography>
          <Button variant="contained" onClick={onNewBatch} data-testid="create-first-batch">
            + Create Your First Batch
          </Button>
        </Paper>
        <Typography fontWeight={750} mt={3} mb={1.5}>
          What you can do next
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
            gap: 1.5,
          }}
        >
          <Paper variant="outlined" sx={PANEL_SX}>
            <Typography fontWeight={700}>1. Create a New Batch</Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5} mb={1.5}>
              Start an analysis for NSE, BSE, US markets, commodities, crypto and more.
            </Typography>
            <Button variant="contained" size="small" onClick={onNewBatch}>
              New Batch
            </Button>
          </Paper>
          <Paper variant="outlined" sx={PANEL_SX}>
            <Typography fontWeight={700}>2. Learn How It Works</Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5} mb={1.5}>
              Follow our quick guide to understand batch analysis and results.
            </Typography>
            <Button size="small" variant="outlined" disabled>
              Not available
            </Button>
          </Paper>
          <Paper variant="outlined" sx={PANEL_SX}>
            <Typography fontWeight={700}>3. Configure Settings</Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5} mb={1.5}>
              Set your preferred data sources, analysis period and options.
            </Typography>
            <Button size="small" variant="outlined" onClick={onNewBatch}>
              Open Settings
            </Button>
          </Paper>
          <Paper variant="outlined" sx={PANEL_SX}>
            <Typography fontWeight={700}>4. Explore Sample Results</Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5} mb={1.5}>
              See a sample batch result with insights and opportunities.
            </Typography>
            <Button size="small" variant="outlined" disabled>
              Not available
            </Button>
          </Paper>
        </Box>
        <Alert severity="info" sx={{ mt: 2 }}>
          Tip: Batch analysis runs in the background and may take several minutes depending on the
          universe size. You can view progress in Live Progress.
        </Alert>
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={PANEL_SX} data-testid="screen-history">
      {filters}
      <QueryState
        loading={loading}
        error={error}
        errorMessage="Unable to load batch history"
        onRetry={onRetry}
      >
        {filteredEmpty ? (
          <Typography color="text.secondary">No batches match these filters</Typography>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Batch ID</TableCell>
                  <TableCell>Universe</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {slice.map((row) => (
                  <TableRow key={row.batchId} hover>
                    <TableCell>{row.batchId}</TableCell>
                    <TableCell>{row.universe}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.status} color={statusChipColor(row.status)} />
                    </TableCell>
                    <TableCell>{formatTimestamp(row.startedAt ?? row.createdAt)}</TableCell>
                    <TableCell>{formatBatchDuration(row.startedAt, row.completedAt)}</TableCell>
                    <TableCell>
                      <Button size="small" onClick={() => onView(row.batchId)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_, next) => onPage(next)}
              rowsPerPage={pageSize}
              rowsPerPageOptions={[pageSize]}
            />
          </>
        )}
      </QueryState>
    </Paper>
  );
}

export function BatchDetailsPanel({
  universe,
  analysisPeriod,
  analysisResolution,
  predictionHorizon,
  createdAt,
  completedAt,
  eligible,
  processed,
  failed,
  status,
  elapsed,
}: {
  universe?: string;
  analysisPeriod?: string;
  analysisResolution?: string;
  predictionHorizon?: string;
  createdAt?: number;
  completedAt?: number;
  eligible?: number;
  processed?: number;
  failed?: number;
  status?: string;
  elapsed?: string;
}): JSX.Element {
  return (
    <Paper variant="outlined" sx={PANEL_SX} data-testid="batch-details">
      <Typography fontWeight={700}>Batch Details</Typography>
      <Stack spacing={0.75} mt={1}>
        <Typography variant="body2">Universe {universe ?? 'Not available'}</Typography>
        <Typography variant="body2">Analysis Period {analysisPeriod ?? 'Not available'}</Typography>
        <Typography variant="body2">Resolution {analysisResolution ?? 'Not available'}</Typography>
        <Typography variant="body2">
          Prediction Horizon {predictionHorizon ?? 'Not available'}
        </Typography>
        <Typography variant="body2">Status {status ?? 'Not available'}</Typography>
        <Typography variant="body2">Created {formatTimestamp(createdAt)}</Typography>
        <Typography variant="body2">Completed {formatTimestamp(completedAt)}</Typography>
        <Typography variant="body2">Duration {elapsed ?? 'Not available'}</Typography>
        <Typography variant="body2">Eligible {eligible ?? 'Not available'}</Typography>
        <Typography variant="body2">Processed {processed ?? 'Not available'}</Typography>
        <Typography variant="body2">Failed {failed ?? 'Not available'}</Typography>
      </Stack>
    </Paper>
  );
}

export function TaskEventsPanel({
  tasks,
}: {
  tasks:
    | Array<{
        symbol: string;
        status: string;
        error?: string;
        startedAt?: number;
        completedAt?: number;
      }>
    | undefined;
}): JSX.Element {
  if (tasks == null) {
    return (
      <Typography color="text.secondary" data-testid="batch-task-events">
        Not available
      </Typography>
    );
  }
  if (tasks.length === 0) {
    return (
      <Typography color="text.secondary" data-testid="batch-task-events">
        No task events available
      </Typography>
    );
  }
  return (
    <Table size="small" data-testid="batch-task-events">
      <TableHead>
        <TableRow>
          <TableCell>Symbol</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Started</TableCell>
          <TableCell>Completed</TableCell>
          <TableCell>Error</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {tasks.slice(0, 100).map((row, index) => (
          <TableRow key={`${row.symbol}-${index}`}>
            <TableCell>{row.symbol}</TableCell>
            <TableCell>{row.status}</TableCell>
            <TableCell>{formatTimestamp(row.startedAt)}</TableCell>
            <TableCell>{formatTimestamp(row.completedAt)}</TableCell>
            <TableCell>{row.error ?? 'Not available'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ArtifactsPanel({
  batchId,
  hasResearchReport,
  hasResults,
}: {
  batchId?: string;
  hasResearchReport: boolean;
  hasResults: boolean;
}): JSX.Element {
  return (
    <Stack spacing={1} data-testid="batch-artifacts">
      <Typography fontWeight={700}>Artifacts</Typography>
      {!batchId ? (
        <Typography color="text.secondary">Not available</Typography>
      ) : (
        <>
          <Typography variant="body2">
            Research report {hasResearchReport ? batchId : 'Not available'}
          </Typography>
          <Typography variant="body2">Results {hasResults ? batchId : 'Not available'}</Typography>
        </>
      )}
    </Stack>
  );
}

export function TerminalContextBar({
  universe,
  eligible,
  analysisPeriod,
  analysisResolution,
  predictionHorizon,
  status,
  duration,
}: {
  universe?: string;
  eligible?: number;
  analysisPeriod?: string;
  analysisResolution?: string;
  predictionHorizon?: string;
  status?: string;
  duration: string;
}): JSX.Element {
  return (
    <Stack direction="row" flexWrap="wrap" gap={1.5} mb={2} data-testid="terminal-context">
      <Typography variant="body2" fontWeight={700}>
        {universe ?? 'Not available'}
        {eligible != null ? ` • ${eligible.toLocaleString()} instruments` : ' • Not available'}
      </Typography>
      <Typography variant="body2">Analysis: {analysisPeriod ?? 'Not available'}</Typography>
      <Typography variant="body2">Resolution: {analysisResolution ?? 'Not available'}</Typography>
      <Typography variant="body2">Prediction: {predictionHorizon ?? 'Not available'}</Typography>
      <Chip size="small" label={status ?? 'Not available'} color={statusChipColor(status)} />
      <Typography variant="body2">Duration: {duration}</Typography>
    </Stack>
  );
}
