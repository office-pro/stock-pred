import {
  Box,
  Button,
  Chip,
  Drawer,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { DataSourceStatus } from '@stockpred/shared-types';
import {
  coverageStatusTone,
  formatCoveragePct,
  formatTimestamp,
  frozenResultIdentity,
  validResultRows,
  type FrozenResultIdentity,
  type SnapshotCoverageRow,
  type WizardStageState,
} from '../../lib/multi-asset-batch';

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
  rows,
  coveragePct,
}: {
  rows: SnapshotCoverageRow[];
  coveragePct?: number | null;
}): JSX.Element {
  const available = rows.filter((row) => row.status === 'AVAILABLE').length;
  const partial = rows.filter((row) => row.status === 'PARTIAL').length;
  const unavailable = rows.filter((row) => row.status === 'UNAVAILABLE').length;
  const na = rows.filter((row) => row.status === 'N/A').length;
  const pending = rows.filter((row) => row.status === 'PENDING').length;
  const pct = coveragePct == null ? null : coveragePct > 1 ? coveragePct : coveragePct * 100;
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }} data-testid="coverage-overview">
      <Typography fontWeight={700}>Coverage Overview</Typography>
      <Typography variant="h4" fontWeight={800} mt={1}>
        {pct == null ? 'N/A' : `${pct.toFixed(1)}%`}
      </Typography>
      <Stack spacing={0.5} mt={1}>
        <Typography variant="caption">Available {available}</Typography>
        <Typography variant="caption">Partial {partial}</Typography>
        <Typography variant="caption">Unavailable {unavailable}</Typography>
        <Typography variant="caption">Pending {pending}</Typography>
        <Typography variant="caption">N/A {na}</Typography>
      </Stack>
    </Paper>
  );
}

export function DataQualityPanel({
  identityCounts,
}: {
  identityCounts?: { eligible: number; valid: number; quarantined: number };
}): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="data-quality">
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
  exchange?: string;
  sector?: string;
  instrument?: { symbol?: string; venue?: string; assetClass?: string };
  recommendation?: string;
  reason?: string;
  reasonCode?: string;
  quarantined?: boolean;
  quarantineStatus?: string;
};

export function ResultsSummary({
  rankings,
  onSelect,
}: {
  rankings: ResultRow[];
  onSelect?: (row: FrozenResultIdentity) => void;
}): JSX.Element {
  const rows = validResultRows(rankings).map(frozenResultIdentity);
  if (rows.length === 0) {
    return <Typography color="text.secondary">Not available until ranking completes.</Typography>;
  }
  return (
    <Table size="small" data-testid="batch-results-table">
      <TableHead>
        <TableRow>
          <TableCell>Symbol</TableCell>
          <TableCell>Sector</TableCell>
          <TableCell>Asset Class</TableCell>
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
            <TableCell>{row.symbol}</TableCell>
            <TableCell>{row.sector ?? 'Not available'}</TableCell>
            <TableCell>{row.assetClass ?? 'Not available'}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={row.recommendation ?? 'Not available'}
                color={coverageStatusTone(row.recommendation)}
              />
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
  rankings: ResultRow[];
  onSelect?: (row: FrozenResultIdentity) => void;
}): JSX.Element {
  const rows = validResultRows(rankings).slice(0, 10).map(frozenResultIdentity);
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="top-opportunities">
      <Typography fontWeight={700}>Top Opportunities ({rows.length})</Typography>
      <Stack spacing={0.75} mt={1}>
        {rows.length === 0 ? (
          <Typography color="text.secondary">Not available</Typography>
        ) : (
          rows.map((row) => (
            <Stack
              key={row.symbol}
              direction="row"
              justifyContent="space-between"
              gap={1}
              onClick={() => onSelect?.(row)}
              sx={{ cursor: onSelect ? 'pointer' : undefined }}
            >
              <Typography variant="body2">{row.symbol}</Typography>
              <Chip
                size="small"
                label={row.recommendation ?? 'Not available'}
                color={coverageStatusTone(row.recommendation)}
              />
            </Stack>
          ))
        )}
      </Stack>
    </Paper>
  );
}

function stageColor(state: WizardStageState): string {
  if (state === 'complete' || state === 'active') return 'primary.main';
  if (state === 'unavailable') return 'error.main';
  return 'action.hover';
}

export function BatchProgress({
  stages,
  percent,
  copy,
}: {
  stages: ReadonlyArray<{ id: string; label: string; state: WizardStageState }>;
  percent?: number;
  copy?: string;
}): JSX.Element {
  return (
    <Box data-testid="batch-progress">
      <Stack direction="row" justifyContent="space-between" mb={2}>
        {stages.map((stage, index) => {
          const filled = stage.state === 'complete' || stage.state === 'active';
          return (
            <Stack key={stage.id} alignItems="center" spacing={0.5} sx={{ flex: 1 }}>
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: stageColor(stage.state),
                  color:
                    filled || stage.state === 'unavailable'
                      ? 'primary.contrastText'
                      : 'text.secondary',
                  fontSize: 12,
                  fontWeight: 700,
                  outline: stage.state === 'na' ? '1px dashed rgba(148,163,184,0.5)' : undefined,
                }}
                data-testid={`progress-stage-${stage.id}`}
                data-state={stage.state}
              >
                {index + 1}
              </Box>
              <Typography variant="caption" textAlign="center">
                {stage.label}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
      {copy ? (
        <Typography variant="body2" color="text.secondary" mb={1}>
          {copy}
        </Typography>
      ) : null}
      <LinearProgress variant="determinate" value={percent ?? 0} />
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
  return (
    <Drawer anchor="right" open={Boolean(row)} onClose={onClose}>
      <Box sx={{ width: 360, p: 2 }} data-testid="result-details-drawer">
        <Typography fontWeight={750}>Result details</Typography>
        {row ? (
          <Stack spacing={1} mt={2}>
            <Typography variant="body2">Symbol {row.symbol}</Typography>
            <Typography variant="body2">Venue {row.venue ?? 'Not available'}</Typography>
            <Typography variant="body2">Asset Class {row.assetClass ?? 'Not available'}</Typography>
            <Typography variant="body2">Sector {row.sector ?? 'Not available'}</Typography>
            <Typography variant="body2">
              Recommendation {row.recommendation ?? 'Not available'}
            </Typography>
            <Typography variant="body2">Reason code {row.reasonCode ?? 'Not available'}</Typography>
            <Typography variant="body2">Reason {row.reason ?? 'Not available'}</Typography>
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
