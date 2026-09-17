/**
 * AI Trader Command Center — /overview
 * Consumes latest BatchResearchReport only (no N×MDS, no FE ranking/scoring).
 * Bull-Run columns = P(≥T within H), not predicted returns.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetLatestBatchResearchReportQuery } from '../store/api';
import OpportunityDetailPanel from '../components/OpportunityDetailPanel';
import {
  COMMAND_CENTER_DISPLAY_TARGETS,
  COMMAND_CENTER_HORIZONS,
  COMMAND_CENTER_OPPORTUNITY_TARGETS,
  formatConfidence,
  formatExecReady,
  formatIntegrity,
  formatProbabilityCell,
  formatProbabilityPercent,
  formatTargetLabel,
  lookupMatrixConfidence,
  lookupMatrixProbability,
  type BullRunHorizon,
  type HorizonMatrixLike,
} from '../lib/bull-run-display';

type BestPickRow = {
  symbol: string;
  rank: number;
  recommendation?: string;
  tradePlanExecutionReady?: boolean;
  confidence?: string;
  sector?: string;
  tradePlanStatus?: string;
  isBestPick?: boolean;
  integrityStatus?: string;
  bullRunMatrix?: HorizonMatrixLike[];
  thesis?: string;
  tradePlanExpectedR?: number;
  tradePlanHorizon?: string;
  invalidationPrice?: number;
  evidenceQuality?: string;
  conflictSummary?: string;
  supportingEvidence?: string[];
  conflictingEvidence?: string[];
  missingEvidence?: string[];
  historicalStatus?: string;
  historicalSampleSize?: number | null;
  historicalNote?: string;
};

type CenterTab = 'best' | 'bull' | 'evidence' | 'integrity' | 'pro' | 'paper';

function completedAtLabel(ts: number | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return 'Not available';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return 'Not available';
  }
}

function toDetailInput(row: BestPickRow) {
  return {
    symbol: row.symbol,
    rank: row.rank,
    sector: row.sector,
    bullRunMatrix: row.bullRunMatrix,
    supportingEvidence: row.supportingEvidence,
    conflictingEvidence: row.conflictingEvidence,
    missingEvidence: row.missingEvidence,
    evidenceQuality: row.evidenceQuality,
    conflictSummary: row.conflictSummary,
    historicalStatus: row.historicalStatus,
    historicalSampleSize: row.historicalSampleSize,
    historicalNote: row.historicalNote,
    thesis: row.thesis,
    recommendation: row.recommendation,
    tradePlanExecutionReady: row.tradePlanExecutionReady,
    tradePlanStatus: row.tradePlanStatus,
    tradePlanExpectedR: row.tradePlanExpectedR,
    tradePlanHorizon: row.tradePlanHorizon,
    invalidationPrice: row.invalidationPrice,
    integrityStatus: row.integrityStatus,
    intelligenceContext: {
      tradePlanRecommendation: row.recommendation,
      tradePlanExecutionReady: row.tradePlanExecutionReady,
      tradePlanStatus: row.tradePlanStatus,
      tradePlanExpectedR: row.tradePlanExpectedR,
      tradePlanHorizon: row.tradePlanHorizon,
      invalidationPrice: row.invalidationPrice,
      integrityStatus: row.integrityStatus,
      thesis: row.thesis,
      supportingEvidence: row.supportingEvidence,
      conflictingEvidence: row.conflictingEvidence,
      missingEvidence: row.missingEvidence,
      evidenceQuality: row.evidenceQuality,
      conflictSummary: row.conflictSummary,
      historicalStatus: row.historicalStatus,
      historicalSampleSize: row.historicalSampleSize,
    },
  };
}

export default function MarketOverviewPage(): JSX.Element {
  const { data, isLoading, isError } = useGetLatestBatchResearchReportQuery();
  const [horizon, setHorizon] = useState<BullRunHorizon>('3M');
  const [oppTarget, setOppTarget] = useState<number | 'custom'>(0.2);
  const [customTargetPct, setCustomTargetPct] = useState('20');
  const [detail, setDetail] = useState<BestPickRow | null>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>('best');

  const report = data?.report;
  const matrixTargets = useMemo(() => {
    const fromReport = report?.matrixTargets?.filter((t) => t >= 0.1 && t <= 2.0);
    return fromReport?.length ? fromReport : [...COMMAND_CENTER_DISPLAY_TARGETS];
  }, [report?.matrixTargets]);

  const bestPicks: BestPickRow[] = useMemo(() => {
    if (!report) return [];
    if (report.bestPicks?.length) return report.bestPicks as BestPickRow[];
    const flagged = (report.bestOpportunities ?? []).filter((o) => o.isBestPick);
    if (flagged.length) return flagged as BestPickRow[];
    return (report.bestOpportunities ?? []).slice(0, 10) as BestPickRow[];
  }, [report]);

  const resolvedOppTarget =
    oppTarget === 'custom'
      ? Number(customTargetPct) / 100
      : typeof oppTarget === 'number'
        ? oppTarget
        : 0.2;

  const bullRunOpps = useMemo(() => {
    const rows = report?.bullRunOpportunities ?? [];
    if (!Number.isFinite(resolvedOppTarget)) return [];
    return rows.filter(
      (o) =>
        o.horizon === horizon &&
        Math.abs(o.targetReturn - resolvedOppTarget) < 1e-9 &&
        o.probability != null &&
        Number.isFinite(o.probability),
    );
  }, [report?.bullRunOpportunities, horizon, resolvedOppTarget]);

  const activeDetail = detail ?? bestPicks[0] ?? null;

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (isError || !data?.available || !report) {
    return (
      <Box sx={{ p: 2, maxWidth: 1100 }}>
        <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
          AI Trader Command Center
        </Typography>
        <Alert severity="info">
          Latest batch research report: <strong>Not available</strong>
          {data?.reason ? ` — ${data.reason}` : ''}. Run a batch from{' '}
          <RouterLink to="/batch">Batch Center</RouterLink> to populate this desk. Values are never
          fabricated.
        </Alert>
      </Box>
    );
  }

  const integ = report.integritySummary;
  const proPick = bestPicks[0];
  const coveragePct =
    report.coverage.total > 0
      ? Math.round((100 * report.coverage.processed) / report.coverage.total)
      : 0;

  return (
    <Box sx={{ p: { xs: 1, md: 2 }, maxWidth: 1400 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'flex-start' }}
        sx={{ mb: 2 }}
        gap={1}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            AI Trader Command Center
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {report.universe} · Latest Completed Batch · {completedAtLabel(report.completedAt)} ·{' '}
            {report.batchId}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`Data: ${report.dataStatus ?? 'UNKNOWN'}`} />
          <Chip
            size="small"
            label={`Coverage ${report.coverage.processed}/${report.coverage.total}`}
            variant="outlined"
          />
          <Chip size="small" label={report.outcome} variant="outlined" />
          <Button size="small" component={RouterLink} to="/batch" variant="contained">
            Batch Center
          </Button>
        </Stack>
      </Stack>

      <Alert severity="warning" sx={{ mb: 2 }}>
        {report.disclaimer}
      </Alert>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 150, flex: '1 1 150px' }}>
          <Typography variant="caption" color="text.secondary">
            Market Regime
          </Typography>
          <Typography variant="subtitle1" fontWeight={800}>
            {report.marketSummary?.regime ?? report.marketSummary?.note ?? 'Not available'}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 150, flex: '1 1 150px' }}>
          <Typography variant="caption" color="text.secondary">
            Breadth / Sector Rotation
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {report.marketSummary?.breadth ?? 'Not available'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Leading: {(report.sectorRotation?.leading ?? []).slice(0, 3).join(', ') || '—'}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 150, flex: '1 1 150px' }}>
          <Typography variant="caption" color="text.secondary">
            Data Status
          </Typography>
          <Typography variant="subtitle1" fontWeight={800}>
            {report.dataStatus ?? 'UNKNOWN'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {completedAtLabel(report.completedAt)}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 150, flex: '1 1 150px' }}>
          <Typography variant="caption" color="text.secondary">
            Integrity
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            {integ
              ? `N ${integ.normal} · I ${integ.investigate} · S ${integ.suspicious}`
              : 'Not available'}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 150, flex: '1 1 150px' }}>
          <Typography variant="caption" color="text.secondary">
            Batch Coverage
          </Typography>
          <Typography variant="subtitle1" fontWeight={800}>
            {report.coverage.processed}/{report.coverage.total} ({coveragePct}%)
          </Typography>
          <LinearProgress variant="determinate" value={coveragePct} sx={{ mt: 1, height: 6 }} />
        </Paper>
      </Stack>

      <Tabs
        value={centerTab}
        onChange={(_, v: CenterTab) => setCenterTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab value="best" label="Best Picks" sx={{ textTransform: 'none' }} />
        <Tab value="bull" label="Bull-Run Opportunities" sx={{ textTransform: 'none' }} />
        <Tab value="evidence" label="Evidence & Insights" sx={{ textTransform: 'none' }} />
        <Tab value="integrity" label="Market Integrity" sx={{ textTransform: 'none' }} />
        <Tab value="pro" label="Professional Trader" sx={{ textTransform: 'none' }} />
        <Tab value="paper" label="Paper Trading" sx={{ textTransform: 'none' }} />
      </Tabs>

      {centerTab === 'best' ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            RankingContext / BEST_OPPORTUNITIES order — not sorted by Bull-Run probability. Columns
            are P(≥ target within selected horizon). Confidence ≠ probability. Exec Ready is
            backend-owned.
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            {COMMAND_CENTER_HORIZONS.map((h) => (
              <Chip
                key={h}
                size="small"
                label={h}
                color={horizon === h ? 'primary' : 'default'}
                variant={horizon === h ? 'filled' : 'outlined'}
                onClick={() => setHorizon(h)}
              />
            ))}
          </Stack>
          {bestPicks.length === 0 ? (
            <Alert severity="info">No suitable Best Pick for this batch (backend outcome).</Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Symbol</TableCell>
                  <TableCell>Sector</TableCell>
                  <TableCell>Confidence</TableCell>
                  {matrixTargets.map((t) => (
                    <TableCell key={t} align="right">
                      {formatTargetLabel(t)}
                    </TableCell>
                  ))}
                  <TableCell>Integrity</TableCell>
                  <TableCell>Rec</TableCell>
                  <TableCell>Exec Ready</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bestPicks.slice(0, 25).map((o) => {
                  const conf =
                    lookupMatrixConfidence(o.bullRunMatrix, horizon) ?? o.confidence ?? null;
                  const selected =
                    activeDetail?.symbol === o.symbol && activeDetail?.rank === o.rank;
                  return (
                    <TableRow
                      key={`${o.symbol}-${o.rank}`}
                      hover
                      selected={selected}
                      sx={{ cursor: 'pointer' }}
                      onClick={() => setDetail(o)}
                    >
                      <TableCell>{o.rank}</TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700}>
                          {o.symbol}
                          {o.isBestPick !== false ? ' ★' : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>{o.sector ?? '—'}</TableCell>
                      <TableCell>{formatConfidence(conf)}</TableCell>
                      {matrixTargets.map((t) => (
                        <TableCell key={t} align="right">
                          {formatProbabilityCell(
                            lookupMatrixProbability(o.bullRunMatrix, horizon, t),
                          )}
                        </TableCell>
                      ))}
                      <TableCell>{formatIntegrity(o.integrityStatus)}</TableCell>
                      <TableCell>{o.recommendation ?? 'Not available'}</TableCell>
                      <TableCell>{formatExecReady(o.tradePlanExecutionReady)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Paper>
      ) : null}

      {centerTab === 'bull' ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Backend candidates with AVAILABLE P(≥T) for horizon {horizon}. Missing → Not available.
          </Typography>
          <Stack
            direction="row"
            spacing={0.5}
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 1.5 }}
            alignItems="center"
          >
            {COMMAND_CENTER_OPPORTUNITY_TARGETS.map((t) => (
              <Chip
                key={t}
                size="small"
                label={formatTargetLabel(t)}
                color={oppTarget === t ? 'primary' : 'default'}
                variant={oppTarget === t ? 'filled' : 'outlined'}
                onClick={() => setOppTarget(t)}
              />
            ))}
            <Chip
              size="small"
              label="Custom"
              color={oppTarget === 'custom' ? 'primary' : 'default'}
              variant={oppTarget === 'custom' ? 'filled' : 'outlined'}
              onClick={() => setOppTarget('custom')}
            />
            {oppTarget === 'custom' ? (
              <TextField
                size="small"
                label="Target %"
                value={customTargetPct}
                onChange={(e) => setCustomTargetPct(e.target.value)}
                sx={{ width: 100 }}
              />
            ) : null}
          </Stack>
          {bullRunOpps.length === 0 ? (
            <Alert severity="info">No Bull-Run opportunities for this target/horizon.</Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Symbol</TableCell>
                  <TableCell>Rank</TableCell>
                  <TableCell>P(≥T)</TableCell>
                  <TableCell>Confidence</TableCell>
                  <TableCell>Integrity</TableCell>
                  <TableCell>Rec</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bullRunOpps.slice(0, 40).map((o) => (
                  <TableRow key={`${o.symbol}-${o.targetReturn}-${o.horizon}`}>
                    <TableCell>{o.symbol}</TableCell>
                    <TableCell>{o.rank}</TableCell>
                    <TableCell>{formatProbabilityPercent(o.probability)}</TableCell>
                    <TableCell>{formatConfidence(o.confidence)}</TableCell>
                    <TableCell>{formatIntegrity(o.integrityStatus)}</TableCell>
                    <TableCell>{o.recommendation ?? 'Not available'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      ) : null}

      {centerTab === 'evidence' ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
            Evidence & Insights (lead pick)
          </Typography>
          {proPick ? (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                {proPick.symbol} · Quality: {proPick.evidenceQuality ?? 'Not available'}
              </Typography>
              <Typography variant="body2">{proPick.conflictSummary ?? 'Not available'}</Typography>
              <Typography variant="body2">
                Supporting: {(proPick.supportingEvidence ?? []).join(', ') || '—'}
              </Typography>
              <Typography variant="body2">
                Conflicting: {(proPick.conflictingEvidence ?? []).join(', ') || '—'}
              </Typography>
              <Typography variant="body2">
                Missing: {(proPick.missingEvidence ?? []).join(', ') || '—'}
              </Typography>
              <Typography variant="body2">
                Historical: {proPick.historicalStatus ?? 'Not available'}
                {proPick.historicalSampleSize != null
                  ? ` · sampleSize=${proPick.historicalSampleSize}`
                  : ''}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Not available
            </Typography>
          )}
        </Paper>
      ) : null}

      {centerTab === 'integrity' ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
            Market Integrity
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Chip label={`NORMAL ${integ?.normal ?? '—'}`} color="success" variant="outlined" />
            <Chip
              label={`INVESTIGATE ${integ?.investigate ?? '—'}`}
              color="warning"
              variant="outlined"
            />
            <Chip
              label={`SUSPICIOUS ${integ?.suspicious ?? '—'}`}
              color="error"
              variant="outlined"
            />
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Advisory only — does not auto-reject unless policy already rejects.
          </Typography>
        </Paper>
      ) : null}

      {centerTab === 'pro' ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
            Professional Trader
          </Typography>
          {proPick ? (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                Lead pick: <strong>{proPick.symbol}</strong> (rank {proPick.rank})
              </Typography>
              <Typography variant="body2">
                Thesis: {proPick.thesis?.trim() || 'Not available'}
              </Typography>
              <Typography variant="body2">
                Expected R:{' '}
                {proPick.tradePlanExpectedR != null && Number.isFinite(proPick.tradePlanExpectedR)
                  ? proPick.tradePlanExpectedR.toFixed(2)
                  : 'Not available'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  size="small"
                  component={RouterLink}
                  to={`/desk/trade-plan/${encodeURIComponent(proPick.symbol)}`}
                  variant="outlined"
                >
                  Trade Plan
                </Button>
                <Button size="small" component={RouterLink} to="/advanced/thesis" variant="text">
                  Thesis
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Not available — no Best Pick in report.
            </Typography>
          )}
        </Paper>
      ) : null}

      {centerTab === 'paper' ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
            Paper Trading
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Paper orders still require Recommendation → evaluateTrade() → Risk → Portfolio → Policy
            → Gate → Execution. Offline analysis ≠ execution-ready.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button size="small" component={RouterLink} to="/agent" variant="outlined">
              Agent Desk
            </Button>
            <Button size="small" component={RouterLink} to="/book" variant="outlined">
              Book / Positions
            </Button>
          </Stack>
        </Paper>
      ) : null}

      {centerTab === 'best' && activeDetail ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, minHeight: 520 }}>
          <Typography variant="overline" color="text.secondary">
            Selected · {activeDetail.symbol} · Rank #{activeDetail.rank}
          </Typography>
          <OpportunityDetailPanel
            row={toDetailInput(activeDetail)}
            selectedHorizon={horizon}
            batchId={report.batchId}
            onClose={detail ? () => setDetail(null) : undefined}
            initialTab="Overview"
          />
        </Paper>
      ) : null}

      <Typography variant="caption" color="text.secondary" display="block">
        {report.calibrationNote ??
          'Bull-Run cell calibration: Not available. Sample size on detail is historical window count.'}{' '}
        Data quality: analyzed {report.dataQuality?.analyzed ?? '—'}, incomplete{' '}
        {report.dataQuality?.incomplete ?? '—'}, fabricated {report.dataQuality?.fabricated ?? 0}{' '}
        (must stay 0). <RouterLink to="/research-reports">Research reports →</RouterLink>
        {' · '}
        <RouterLink to="/intelligence-validation">Intelligence validation →</RouterLink>
      </Typography>
    </Box>
  );
}
