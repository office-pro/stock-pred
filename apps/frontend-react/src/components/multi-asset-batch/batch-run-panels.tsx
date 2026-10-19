/**
 * MI-6 Batch Run panels — wireframe-faithful, backend-driven only.
 */
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type {
  CombinedBatchPreflightV2,
  DataSourceStatus,
  InstrumentReadinessEligibility,
  ReadinessPolicy,
} from '@stockpred/shared-types';
import {
  capabilityDisplayLabel,
  coverageGroupLabel,
  coverageStatusTone,
  formatCoveragePct,
  formatDataAge,
  formatTimestamp,
  humanizePreflightBlocker,
  isInventoryOutageBlocker,
  MI_WORKFLOW_STEPS,
  preflightLegsFromV2,
  sortedIneligibleReasons,
  type FrozenResultIdentity,
  type PreflightPresentationState,
  type SnapshotCoverageRow,
  type WizardStageState,
} from '../../lib/multi-asset-batch';
import { KPI_SX, PANEL_SX } from './workstation-chrome';

const SECTION_NUM = {
  fontSize: 11,
  fontWeight: 800,
  color: 'rgba(148, 163, 184, 0.9)',
  letterSpacing: 0.4,
} as const;

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone?: 'success' | 'warning' | 'error' | 'default' | 'info';
}): JSX.Element {
  return (
    <Chip
      size="small"
      label={label}
      color={tone ?? coverageStatusTone(label)}
      variant={
        String(label).toUpperCase() === 'N/A' ||
        String(label).toUpperCase() === 'PENDING' ||
        String(label).toUpperCase() === 'WAITING'
          ? 'outlined'
          : 'filled'
      }
      sx={{ fontWeight: 700, fontSize: 11 }}
    />
  );
}

export function MiWorkflowStepper({ activeIndex }: { activeIndex: number }): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      flexWrap="wrap"
      alignItems="center"
      data-testid="mi-workflow-stepper"
      sx={{ mb: 1.5 }}
    >
      {MI_WORKFLOW_STEPS.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <Stack key={step.id} direction="row" alignItems="center" spacing={0.75}>
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: 11,
                fontWeight: 800,
                bgcolor: done || active ? 'primary.main' : 'rgba(148,163,184,0.15)',
                color: done || active ? '#0b1220' : 'text.secondary',
              }}
            >
              {index + 1}
            </Box>
            <Typography
              variant="caption"
              fontWeight={active ? 800 : 600}
              color={active ? 'text.primary' : 'text.secondary'}
            >
              {step.label}
            </Typography>
            {index < MI_WORKFLOW_STEPS.length - 1 ? (
              <Box sx={{ width: 18, height: 1, bgcolor: 'rgba(148,163,184,0.35)', mx: 0.5 }} />
            ) : null}
          </Stack>
        );
      })}
    </Stack>
  );
}

export function BatchReadinessPanel({
  presentation,
  preflight,
  notEvaluatedReason,
  errorMessage,
  onRetry,
}: {
  presentation: PreflightPresentationState;
  preflight: CombinedBatchPreflightV2 | null;
  notEvaluatedReason?: string;
  errorMessage?: string | null;
  onRetry?: () => void;
}): JSX.Element {
  const legs = preflightLegsFromV2(preflight);
  const badge =
    presentation === 'READY'
      ? 'PASS'
      : presentation === 'BLOCKED'
        ? 'BLOCKED'
        : presentation === 'LOADING'
          ? 'LOADING'
          : presentation === 'ERROR'
            ? 'ERROR'
            : 'NOT EVALUATED';

  return (
    <Paper
      variant="outlined"
      sx={{ ...PANEL_SX, height: '100%' }}
      data-testid="batch-readiness-panel"
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography sx={SECTION_NUM}>① BATCH READINESS</Typography>
        <StatusChip
          label={badge}
          tone={
            badge === 'PASS'
              ? 'success'
              : badge === 'BLOCKED' || badge === 'ERROR'
                ? 'error'
                : badge === 'LOADING'
                  ? 'info'
                  : 'default'
          }
        />
      </Stack>

      {presentation === 'NOT_EVALUATED' ? (
        <Typography variant="body2" color="text.secondary" data-testid="mi-not-evaluated">
          {notEvaluatedReason ?? 'Market Intelligence — Not evaluated for this universe'}
        </Typography>
      ) : null}

      {presentation === 'LOADING' ? (
        <Stack spacing={1} data-testid="preflight-loading">
          <Typography variant="body2" color="text.secondary">
            Loading preflight…
          </Typography>
          <LinearProgress />
        </Stack>
      ) : null}

      {presentation === 'ERROR' ? (
        <Alert
          severity="error"
          data-testid="preflight-error"
          action={
            onRetry ? (
              <Button color="inherit" size="small" onClick={onRetry} data-testid="preflight-retry">
                Retry
              </Button>
            ) : undefined
          }
        >
          Unable to load readiness.
          {errorMessage ? (
            <Typography
              variant="body2"
              component="div"
              sx={{ mt: 0.5, wordBreak: 'break-word' }}
              data-testid="preflight-error-detail"
            >
              {errorMessage}
            </Typography>
          ) : null}
        </Alert>
      ) : null}

      {preflight?.analysisSession?.id === 'OFF_SESSION_ANALYSIS' ? (
        <Alert severity="warning" sx={{ mb: 1 }} data-testid="analysis-session-provenance">
          Analysis mode: off-session / historical
          {preflight.analysisActionability
            ? ` · Trade readiness: ${preflight.analysisActionability}`
            : ''}
          {preflight.quoteProvenance?.dataStatus
            ? ` · Data status: ${preflight.quoteProvenance.dataStatus}`
            : ''}
          {preflight.quoteProvenance?.dataAsOfMs != null
            ? ` · Data as of: ${new Date(preflight.quoteProvenance.dataAsOfMs).toISOString()}`
            : ''}
          {preflight.quoteProvenance?.dataAgeMs != null
            ? ` · Age: ${Math.round(preflight.quoteProvenance.dataAgeMs / 60_000)}m`
            : ''}
        </Alert>
      ) : null}

      {(presentation === 'READY' || presentation === 'BLOCKED') && legs.length > 0 ? (
        <Table size="small" data-testid="preflight-legs-table">
          <TableHead>
            <TableRow>
              <TableCell>Capability</TableCell>
              <TableCell>Requirement</TableCell>
              <TableCell align="right">Eligible</TableCell>
              <TableCell align="right">Available</TableCell>
              <TableCell>Coverage</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {legs.map((leg) => (
              <TableRow key={leg.key}>
                <TableCell>{leg.label}</TableCell>
                <TableCell>
                  {leg.mode === 'REQUIRED'
                    ? 'Required'
                    : leg.mode === 'OPTIONAL'
                      ? 'Optional'
                      : 'N/A'}
                </TableCell>
                <TableCell align="right">
                  {leg.mode === 'NOT_APPLICABLE' ? '—' : leg.requiredCount}
                </TableCell>
                <TableCell align="right">
                  {leg.mode === 'NOT_APPLICABLE' ? '—' : leg.available}
                </TableCell>
                <TableCell>{leg.mode === 'NOT_APPLICABLE' ? 'N/A' : leg.coverage}</TableCell>
                <TableCell>
                  <StatusChip
                    label={
                      leg.mode === 'NOT_APPLICABLE'
                        ? 'NOT APPLICABLE'
                        : leg.coverage === 'COMPLETE'
                          ? 'COMPLETE'
                          : leg.coverage === 'PARTIAL'
                            ? 'PARTIAL'
                            : 'UNAVAILABLE'
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {presentation === 'READY' ? (
        <Typography variant="body2" color="success.light" mt={1.5} fontWeight={700}>
          ✓ All required data requirements satisfied
        </Typography>
      ) : null}

      {presentation === 'BLOCKED' && preflight?.blockers?.some(isInventoryOutageBlocker) ? (
        <Alert severity="error" sx={{ mt: 1.5 }} data-testid="preflight-inventory-outage">
          BLOCKED:{' '}
          {humanizePreflightBlocker(
            preflight.blockers.find(isInventoryOutageBlocker) ?? preflight.blockers[0],
          )}
          . Eligibility cannot be determined from an unreadable inventory.
        </Alert>
      ) : null}

      {presentation === 'BLOCKED' &&
      preflight?.blockers?.includes('NO_ELIGIBLE_INSTRUMENTS') &&
      !preflight.blockers.some(isInventoryOutageBlocker) ? (
        <Alert severity="error" sx={{ mt: 1.5 }} data-testid="preflight-no-eligible">
          BLOCKED: No eligible instruments
          {preflight.eligibility
            ? ` — ELIGIBLE ${preflight.eligibility.eligible} / ${preflight.eligibility.universeTotal}`
            : ''}
        </Alert>
      ) : null}

      {preflight?.eligibility || preflight?.readinessPolicy ? (
        <Box
          mt={1.5}
          sx={{
            border: '1px solid rgba(56, 189, 248, 0.22)',
            borderRadius: '10px',
            p: 1.25,
          }}
          data-testid="readiness-policy-summary"
        >
          <Typography variant="caption" fontWeight={800} color="text.secondary">
            READINESS POLICY
          </Typography>
          <Typography variant="body2" fontWeight={700} mt={0.25}>
            {preflight.readinessPolicy?.id ?? '—'}
            {preflight.readinessPolicy?.version ? ` · ${preflight.readinessPolicy.version}` : ''}
          </Typography>
          {preflight.readinessPolicy?.minimums ? (
            <Typography variant="caption" color="text.secondary" display="block">
              Minimums ≥{preflight.readinessPolicy.minimums.minEligibleCount} ELIGIBLE and ≥
              {Math.round(preflight.readinessPolicy.minimums.minEligibleFraction * 100)}% of
              universe (backend-enforced)
            </Typography>
          ) : null}
          {preflight.eligibility ? (
            <>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                mt={1.25}
                data-testid="eligibility-kpis"
              >
                {(
                  [
                    ['ELIGIBLE', preflight.eligibility.eligible],
                    ['ANALYZED_NOT_PROMOTABLE', preflight.eligibility.analyzedNotPromotable],
                    ['INELIGIBLE', preflight.eligibility.ineligible],
                  ] as const
                ).map(([label, value]) => (
                  <Box key={label} sx={{ ...KPI_SX, flex: 1, py: 1.25 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={800}>
                      {label}
                    </Typography>
                    <Typography variant="h6" fontWeight={800}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" mt={0.75}>
                of {preflight.eligibility.universeTotal}
              </Typography>
              {sortedIneligibleReasons(preflight.eligibility.ineligibleByReason).length > 0 ? (
                <Box mt={1} data-testid="ineligible-by-reason">
                  <Typography variant="caption" fontWeight={800} color="text.secondary">
                    TOP INELIGIBLE REASONS
                  </Typography>
                  {sortedIneligibleReasons(preflight.eligibility.ineligibleByReason)
                    .slice(0, 5)
                    .map((row) => (
                      <Typography key={row.reason} variant="body2">
                        {row.reason} · {row.count}
                      </Typography>
                    ))}
                </Box>
              ) : null}
            </>
          ) : null}
          {preflight.strictAll && !preflight.strictAll.canRun ? (
            <Alert severity="warning" sx={{ mt: 1.25 }} data-testid="strict-all-would-block">
              STRICT_ALL for the same inputs would block
              {preflight.strictAll.blockers?.length
                ? `: ${preflight.strictAll.blockers.join(', ')}`
                : ''}
            </Alert>
          ) : null}
        </Box>
      ) : null}

      {presentation === 'BLOCKED' && preflight?.blockers?.length ? (
        <Box mt={1.5} data-testid="preflight-blockers">
          <Typography variant="caption" fontWeight={800} color="error.light">
            BLOCKERS
          </Typography>
          {preflight.blockers.map((code) => (
            <Typography key={code} variant="body2" color="error.light">
              • {code}
            </Typography>
          ))}
        </Box>
      ) : null}

      {preflight?.warnings?.length ? (
        <Box mt={1.5} data-testid="preflight-warnings">
          <Typography variant="caption" fontWeight={800} color="warning.light">
            WARNINGS
          </Typography>
          {preflight.warnings.map((code) => (
            <Typography key={code} variant="body2" color="warning.light">
              • {code}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Paper>
  );
}

/** Batch-level ineligible list from GET results — never ranked. */
export function IneligibleInstrumentsTable({
  rows,
}: {
  rows: InstrumentReadinessEligibility[] | undefined;
}): JSX.Element | null {
  if (!rows?.length) return null;
  return (
    <Paper
      variant="outlined"
      sx={{ ...PANEL_SX, mt: 2 }}
      data-testid="ineligible-instruments-table"
    >
      <Typography sx={SECTION_NUM} mb={1}>
        INELIGIBLE INSTRUMENTS
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        Backend readiness exclusions — not ranked, scored, or recommended
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Symbol</TableCell>
            <TableCell>State</TableCell>
            <TableCell>Reasons</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.symbol}>
              <TableCell>{row.symbol}</TableCell>
              <TableCell>
                <StatusChip label={row.state} tone="error" />
              </TableCell>
              <TableCell>{row.reasons.join(', ') || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

export function ResultsReadinessBanner({
  outcome,
  readinessPolicy,
  ineligibleCount,
  batchStatus,
  hasRankings,
}: {
  outcome?: 'NO_ELIGIBLE_INSTRUMENTS';
  readinessPolicy?: { id: string; version?: string } | ReadinessPolicy;
  ineligibleCount?: number;
  batchStatus?: string;
  hasRankings: boolean;
}): JSX.Element | null {
  if (outcome === 'NO_ELIGIBLE_INSTRUMENTS') {
    return (
      <Alert severity="error" sx={{ mb: 2 }} data-testid="results-outcome-no-eligible">
        Outcome: NO_ELIGIBLE_INSTRUMENTS
        {readinessPolicy?.id ? ` · Policy: ${readinessPolicy.id}` : ''}. No instruments were
        analyzed.
      </Alert>
    );
  }
  if (hasRankings && (ineligibleCount ?? 0) > 0) {
    const tone = batchStatus === 'COMPLETED' || batchStatus === 'PARTIAL' ? 'info' : 'info';
    return (
      <Alert severity={tone} sx={{ mb: 2 }} data-testid="results-partial-exclusions">
        {batchStatus ? `${batchStatus}` : 'Batch'} with readiness exclusions — {ineligibleCount}{' '}
        instrument{ineligibleCount === 1 ? '' : 's'} ineligible (backend).
        {readinessPolicy?.id ? ` Policy: ${readinessPolicy.id}.` : ''}
      </Alert>
    );
  }
  return null;
}

export function BatchRunProgressPanel({
  stages,
  running,
}: {
  stages: Array<{
    id: string;
    label: string;
    state: WizardStageState;
    available?: number;
    eligible?: number;
    coveragePct?: number | null;
  }>;
  running?: boolean;
}): JSX.Element {
  const labelFor = (state: WizardStageState): string => {
    if (state === 'complete') return 'COMPLETED';
    if (state === 'active') return 'RUNNING';
    if (state === 'unavailable') return 'FAILED';
    if (state === 'na') return 'N/A';
    return state === 'pending' ? 'WAITING' : 'PENDING';
  };
  /** Progress bar uses backend coveragePct when present — never available/eligible math. */
  const progressValue = (stage: {
    state: WizardStageState;
    coveragePct?: number | null;
  }): number => {
    if (stage.state === 'complete') return 100;
    if (stage.state === 'pending' || stage.state === 'na' || stage.state === 'unavailable')
      return 0;
    if (stage.coveragePct != null && Number.isFinite(stage.coveragePct)) {
      return Math.min(100, Math.max(0, Math.round(stage.coveragePct * 100)));
    }
    return stage.state === 'active' ? 35 : 0;
  };

  return (
    <Paper variant="outlined" sx={{ ...PANEL_SX, height: '100%' }} data-testid="batch-run-progress">
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography sx={SECTION_NUM}>② BATCH PROGRESS</Typography>
        {running ? <StatusChip label="Running" tone="info" /> : null}
      </Stack>
      <Stack spacing={1.25}>
        {stages.map((stage) => {
          const pct = progressValue(stage);
          return (
            <Box
              key={stage.id}
              data-testid={`batch-run-stage-${stage.id}`}
              data-state={stage.state}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" fontWeight={700}>
                  {stage.label}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  {stage.available != null && stage.eligible != null ? (
                    <Typography variant="caption" color="text.secondary">
                      {stage.available}/{stage.eligible}
                    </Typography>
                  ) : null}
                  <StatusChip label={labelFor(stage.state)} />
                </Stack>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={pct}
                sx={{ mt: 0.5, height: 6, borderRadius: 1 }}
                color={
                  stage.state === 'complete'
                    ? 'success'
                    : stage.state === 'active'
                      ? 'primary'
                      : 'inherit'
                }
              />
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

export function DataSourceStatusPanel({
  sources,
  preflight,
}: {
  sources: DataSourceStatus[];
  preflight?: CombinedBatchPreflightV2 | null;
}): JSX.Element {
  const legs = preflightLegsFromV2(preflight ?? null);
  const hasSources = sources.length > 0;
  const hasLegs = legs.length > 0;

  return (
    <Paper variant="outlined" sx={{ ...PANEL_SX, height: '100%' }} data-testid="data-source-status">
      <Typography sx={SECTION_NUM} mb={1}>
        ③ DATA SOURCE STATUS
      </Typography>
      {!hasSources && !hasLegs ? (
        <Typography variant="body2" color="text.secondary">
          Not available until readiness or sources load.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Source</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Coverage</TableCell>
              <TableCell>Data As Of</TableCell>
              <TableCell>Age</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {hasSources
              ? sources.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{row.provider ?? '—'}</TableCell>
                    <TableCell>
                      {row.miAvailable != null && row.miEligible != null
                        ? `${row.miAvailable} / ${row.miEligible}`
                        : (row.miCoverage ?? '—')}
                    </TableCell>
                    <TableCell>
                      {row.dataAsOf != null
                        ? formatTimestamp(
                            typeof row.dataAsOf === 'number'
                              ? row.dataAsOf
                              : Date.parse(String(row.dataAsOf)),
                          )
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {formatDataAge(
                        typeof row.dataAsOf === 'number' || row.dataAsOf == null
                          ? row.dataAsOf
                          : Date.parse(String(row.dataAsOf)),
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        label={String(
                          row.miCoverage ?? row.capabilityState ?? row.dataStatus ?? '—',
                        )}
                      />
                    </TableCell>
                  </TableRow>
                ))
              : legs.map((leg) => (
                  <TableRow key={leg.key}>
                    <TableCell>{leg.label}</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      {leg.mode === 'NOT_APPLICABLE'
                        ? 'N/A'
                        : `${leg.available} / ${leg.requiredCount}`}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell>
                      <StatusChip
                        label={leg.mode === 'NOT_APPLICABLE' ? 'NOT APPLICABLE' : leg.coverage}
                      />
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

export function SnapshotInfoPanel({
  batchId,
  batchStatus,
  creating,
  onOpenBatch,
  dataSnapshotVersion,
  marketIntelligenceSnapshotId,
  asOf,
  universe,
  resolution,
  miMode,
  miEvaluated,
}: {
  batchId?: string;
  batchStatus?: string;
  creating?: boolean;
  onOpenBatch?: (batchId: string) => void;
  dataSnapshotVersion?: string;
  marketIntelligenceSnapshotId?: string;
  asOf?: string;
  universe?: string;
  resolution?: string;
  miMode?: string;
  miEvaluated: boolean;
}): JSX.Element {
  const row = (label: string, value?: string | null) => (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={700} textAlign="right">
        {value && String(value).trim() ? value : '—'}
      </Typography>
    </Stack>
  );
  const idLabel = creating
    ? 'Creating…'
    : batchId && String(batchId).trim()
      ? batchId
      : 'Not created yet';
  return (
    <Paper
      variant="outlined"
      sx={{ ...PANEL_SX, height: '100%' }}
      data-testid="snapshot-info-panel"
    >
      <Typography sx={SECTION_NUM} mb={1}>
        ④ SNAPSHOT INFORMATION
      </Typography>
      <Stack spacing={0.75}>
        {row('Batch ID', idLabel)}
        {batchId && batchStatus ? row('Batch status', batchStatus) : null}
        {batchId && onOpenBatch && !creating ? (
          <Button
            size="small"
            variant="outlined"
            onClick={() => onOpenBatch(batchId)}
            data-testid="open-linked-batch"
            sx={{ alignSelf: 'flex-end', mt: 0.5 }}
          >
            Open batch
          </Button>
        ) : null}
        {row('Data Snapshot', dataSnapshotVersion)}
        {row(
          'MI Snapshot',
          miEvaluated ? marketIntelligenceSnapshotId : 'Not evaluated for this universe',
        )}
        {row('As Of', asOf)}
        {row('Universe', universe)}
        {row('Resolution', resolution)}
        {row('Schema', dataSnapshotVersion ? 'batch-data-snapshot.v1' : undefined)}
        {row('MI Mode', miMode)}
      </Stack>
    </Paper>
  );
}

export function GroupedCapabilityCoverageTable({
  rows,
  onSelect,
}: {
  rows: SnapshotCoverageRow[];
  onSelect?: (row: SnapshotCoverageRow) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" data-testid="coverage-empty">
        Not available until this batch produces a frozen snapshot.
      </Typography>
    );
  }
  const filtered = rows.filter((r) => !String(r.capability).toLowerCase().includes('paper'));
  const groups = new Map<string, SnapshotCoverageRow[]>();
  for (const row of filtered) {
    const label = coverageGroupLabel(row.group);
    const list = groups.get(label) ?? [];
    list.push(row);
    groups.set(label, list);
  }

  return (
    <Table size="small" data-testid="grouped-coverage-table">
      <TableHead>
        <TableRow>
          <TableCell>Category</TableCell>
          <TableCell>Capability</TableCell>
          <TableCell>Requirement</TableCell>
          <TableCell align="right">Eligible</TableCell>
          <TableCell align="right">Available</TableCell>
          <TableCell align="right">Partial</TableCell>
          <TableCell align="right">Unavailable</TableCell>
          <TableCell align="right">Coverage</TableCell>
          <TableCell>Freshness</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {[...groups.entries()].map(([group, items]) =>
          items.map((row, idx) => (
            <TableRow
              key={row.capability}
              hover={Boolean(onSelect)}
              onClick={() => onSelect?.(row)}
              sx={{ cursor: onSelect ? 'pointer' : undefined }}
            >
              <TableCell>{idx === 0 ? group : ''}</TableCell>
              <TableCell>{capabilityDisplayLabel(row.capability)}</TableCell>
              <TableCell>
                {row.status === 'N/A' ? 'N/A' : row.status === 'UNAVAILABLE' ? '—' : 'Required'}
              </TableCell>
              <TableCell align="right">{row.eligible}</TableCell>
              <TableCell align="right">{row.available}</TableCell>
              <TableCell align="right">{row.partial}</TableCell>
              <TableCell align="right">{row.unavailable}</TableCell>
              <TableCell align="right">
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                  <Box sx={{ width: 48 }}>
                    <LinearProgress
                      variant="determinate"
                      value={
                        row.coveragePct == null || row.status === 'N/A'
                          ? 0
                          : Math.min(100, Math.round(row.coveragePct * 100))
                      }
                      sx={{ height: 4, borderRadius: 1 }}
                    />
                  </Box>
                  <Typography variant="caption">
                    {formatCoveragePct(row.coveragePct, row.status)}
                  </Typography>
                </Stack>
              </TableCell>
              <TableCell>—</TableCell>
              <TableCell>
                <StatusChip label={row.status} />
              </TableCell>
            </TableRow>
          )),
        )}
      </TableBody>
    </Table>
  );
}

export type BatchResultDetailRow = FrozenResultIdentity & {
  dataSnapshotVersion?: string;
  marketIntelligenceSnapshotId?: string;
  advancedIntelligenceSnapshotId?: string;
  asOf?: string;
  companyName?: string;
  /** MI-7 — backend advanced section statuses (never computed in FE). */
  advancedSections?: {
    catalyst?: { status: string; reason?: string; eventRisk?: string };
    bullRun?: { status: string; reason?: string; state?: string };
    analogues?: { status: string; reason?: string; sampleSize?: number };
    relationships?: { status: string; reason?: string };
    globalImpact?: { status: string; reason?: string };
  };
};

function AdvancedSectionBlock({
  title,
  status,
  reason,
  detail,
}: {
  title: string;
  status?: string;
  reason?: string;
  detail?: string;
}): JSX.Element {
  const s = status ?? 'UNAVAILABLE';
  return (
    <Box data-testid={`advanced-section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <Typography variant="subtitle2" fontWeight={800}>
        {title}
      </Typography>
      <Typography variant="body2">Status: {s}</Typography>
      {reason ? (
        <Typography variant="body2" color="text.secondary">
          Reason: {reason}
        </Typography>
      ) : null}
      {detail ? <Typography variant="body2">{detail}</Typography> : null}
      {s === 'UNAVAILABLE' ||
      s === 'NOT_APPLICABLE' ||
      s === 'DATA_INCOMPLETE' ||
      s === 'UNKNOWN' ? (
        <Typography variant="caption" color="text.secondary">
          Not available — backend status (no fabricated score).
        </Typography>
      ) : null}
    </Box>
  );
}

export function BatchResultDetail({
  row,
  tab,
  onTab,
}: {
  row: BatchResultDetailRow | null;
  tab: number;
  onTab: (n: number) => void;
}): JSX.Element {
  if (!row) {
    return (
      <Paper
        variant="outlined"
        sx={{ ...PANEL_SX, height: '100%' }}
        data-testid="batch-result-detail"
      >
        <Typography sx={SECTION_NUM} mb={1}>
          ⑥ RESULT DETAIL
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Select a result to view identity and lineage.
        </Typography>
      </Paper>
    );
  }

  const ctx = row.intelligenceContext;
  const score = ctx && typeof ctx.overallScore === 'number' ? String(ctx.overallScore) : '—';
  const sentiment =
    ctx && typeof ctx.sentimentScore === 'number'
      ? String(ctx.sentimentScore)
      : ctx && typeof ctx.sentiment === 'string'
        ? ctx.sentiment
        : '—';

  return (
    <Paper
      variant="outlined"
      sx={{ ...PANEL_SX, height: '100%' }}
      data-testid="batch-result-detail"
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
        <Box>
          <Typography sx={SECTION_NUM}>⑥ RESULT DETAIL</Typography>
          <Typography variant="h6" fontWeight={800}>
            {row.symbol}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {row.companyName ?? '—'}
          </Typography>
          <Stack direction="row" spacing={0.75} mt={0.75} flexWrap="wrap">
            <StatusChip label={row.venue ?? '—'} />
            <StatusChip label={row.assetClass ?? '—'} />
          </Stack>
        </Box>
        <Stack alignItems="flex-end" spacing={0.5}>
          {row.rank === 1 ? <StatusChip label="TOP OPPORTUNITY" tone="success" /> : null}
          <Typography variant="caption" color="text.secondary">
            Score {score}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Rank {row.rank == null ? '—' : `#${row.rank}`}
          </Typography>
        </Stack>
      </Stack>

      <Tabs value={tab} onChange={(_, v) => onTab(v)} variant="scrollable" scrollButtons="auto">
        <Tab label="Overview" />
        <Tab label="Intelligence" />
        <Tab label="Lineage" />
        <Tab label="Evidence" />
        <Tab label="Risk" />
        <Tab label="Notes" />
      </Tabs>

      <Box mt={1.5}>
        {tab === 0 || tab === 1 ? (
          <Stack spacing={1.25}>
            <Box>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="subtitle2" fontWeight={800}>
                  Instrument Identity
                </Typography>
                <StatusChip label="VERIFIED" tone="success" />
              </Stack>
              <Typography variant="body2">Symbol {row.symbol}</Typography>
              <Typography variant="body2">Venue {row.venue ?? '—'}</Typography>
              <Typography variant="body2">Asset Class {row.assetClass ?? '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" fontWeight={800}>
                Sentiment
              </Typography>
              <Typography variant="body2">{sentiment}</Typography>
            </Box>
            <Box data-testid="advanced-intelligence-panel">
              <Typography variant="subtitle2" fontWeight={800} mb={0.5}>
                Advanced Intelligence
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                Snapshot {row.advancedIntelligenceSnapshotId ?? '—'} (frozen; no live replacement)
              </Typography>
              <Stack spacing={1}>
                <AdvancedSectionBlock
                  title="Catalysts"
                  status={row.advancedSections?.catalyst?.status}
                  reason={row.advancedSections?.catalyst?.reason}
                  detail={
                    row.advancedSections?.catalyst?.eventRisk
                      ? `Event risk ${row.advancedSections.catalyst.eventRisk}`
                      : undefined
                  }
                />
                <AdvancedSectionBlock
                  title="Market Regime"
                  status={row.advancedSections?.bullRun?.status}
                  reason={row.advancedSections?.bullRun?.reason}
                  detail={
                    row.advancedSections?.bullRun?.state
                      ? `State ${row.advancedSections.bullRun.state}`
                      : undefined
                  }
                />
                <AdvancedSectionBlock
                  title="Historical Analogues"
                  status={row.advancedSections?.analogues?.status}
                  reason={row.advancedSections?.analogues?.reason}
                  detail={
                    row.advancedSections?.analogues?.sampleSize != null
                      ? `Sample ${row.advancedSections.analogues.sampleSize}`
                      : undefined
                  }
                />
                <AdvancedSectionBlock
                  title="Relationships"
                  status={row.advancedSections?.relationships?.status}
                  reason={row.advancedSections?.relationships?.reason}
                />
                <AdvancedSectionBlock
                  title="Global Impact"
                  status={row.advancedSections?.globalImpact?.status}
                  reason={row.advancedSections?.globalImpact?.reason}
                />
              </Stack>
            </Box>
          </Stack>
        ) : null}
        {tab === 2 ? (
          <Stack spacing={0.75} data-testid="result-lineage">
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="subtitle2" fontWeight={800}>
                Snapshot Lineage
              </Typography>
              <StatusChip label="VERIFIED" tone="success" />
            </Stack>
            <Typography variant="body2">Data Snapshot {row.dataSnapshotVersion ?? '—'}</Typography>
            <Typography variant="body2">
              MI Snapshot {row.marketIntelligenceSnapshotId ?? '—'}
            </Typography>
            <Typography variant="body2">
              Advanced Snapshot {row.advancedIntelligenceSnapshotId ?? '—'}
            </Typography>
            <Typography variant="body2">As Of {row.asOf ?? '—'}</Typography>
          </Stack>
        ) : null}
        {tab === 3 ? (
          <Typography variant="body2" color="text.secondary">
            Evidence fields appear when present on the backend result.
          </Typography>
        ) : null}
        {tab === 4 || tab === 5 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="result-risk-notes-placeholder"
          >
            Not part of MI-6 — Risk / Notes unchanged.
          </Typography>
        ) : null}
      </Box>
    </Paper>
  );
}

export function QuarantineBanner({
  identityCounts,
}: {
  identityCounts?: { eligible?: number; valid?: number; quarantined?: number };
}): JSX.Element | null {
  const q = identityCounts?.quarantined ?? 0;
  if (!q) return null;
  return (
    <Alert severity="warning" data-testid="quarantine-banner" sx={{ mb: 1.5 }}>
      {q} result{q === 1 ? '' : 's'} quarantined (identity mismatch). Quarantined rows are not shown
      as normal opportunities. Valid {identityCounts?.valid ?? '—'} / Eligible{' '}
      {identityCounts?.eligible ?? '—'}.
    </Alert>
  );
}
