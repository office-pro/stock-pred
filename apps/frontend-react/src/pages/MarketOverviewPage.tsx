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
  Divider,
  Drawer,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useGetBullRunIntelligenceQuery, useGetLatestBatchResearchReportQuery } from '../store/api';
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
};

function completedAtLabel(ts: number | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return 'Not available';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return 'Not available';
  }
}

export default function MarketOverviewPage(): JSX.Element {
  const { data, isLoading, isError } = useGetLatestBatchResearchReportQuery();
  const [horizon, setHorizon] = useState<BullRunHorizon>('3M');
  const [oppTarget, setOppTarget] = useState<number | 'custom'>(0.2);
  const [customTargetPct, setCustomTargetPct] = useState('20');
  const [detail, setDetail] = useState<BestPickRow | null>(null);

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
    // v1 report fallback — RankingContext order only (never re-sort by Bull-Run)
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

  return (
    <Box sx={{ p: 2, maxWidth: 1200 }}>
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
          <Button size="small" component={RouterLink} to="/batch" variant="outlined">
            Batch Center
          </Button>
        </Stack>
      </Stack>

      <Alert severity="warning" sx={{ mb: 2 }}>
        {report.disclaimer}
      </Alert>

      {/* Market strip */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Market Regime
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {report.marketSummary?.regime ?? report.marketSummary?.note ?? 'Not available'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Breadth
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {report.marketSummary?.breadth ?? 'Not available'}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 180 }}>
            <Typography variant="caption" color="text.secondary">
              Sector Rotation
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              Leading: {(report.sectorRotation?.leading ?? []).slice(0, 3).join(', ') || '—'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Data
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {report.dataStatus ?? 'UNKNOWN'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Integrity
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {integ
                ? `N ${integ.normal} · I ${integ.investigate} · S ${integ.suspicious}`
                : 'Not available'}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* Best Picks */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 0.5 }}>
          ★ Best Picks
        </Typography>
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
                <TableCell>Stock</TableCell>
                <TableCell>Pick</TableCell>
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
                return (
                  <TableRow
                    key={o.symbol}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setDetail(o)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>
                        {o.symbol}
                      </Typography>
                    </TableCell>
                    <TableCell>{o.isBestPick !== false ? '★' : '—'}</TableCell>
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

      {/* Bull-Run Opportunities */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 0.5 }}>
          Bull-Run Opportunities
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Backend candidates with AVAILABLE P(≥T) for horizon {horizon}. UI support for +500% does
          not invent probabilities — missing → Not available.
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
          <Typography variant="body2" color="text.secondary">
            No AVAILABLE cells for {formatTargetLabel(resolvedOppTarget)} @ {horizon}.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Stock</TableCell>
                <TableCell>Rank</TableCell>
                <TableCell>P(≥T)</TableCell>
                <TableCell>Confidence</TableCell>
                <TableCell>Integrity</TableCell>
                <TableCell>Best Pick</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {bullRunOpps.slice(0, 30).map((o) => (
                <TableRow key={`${o.symbol}-${o.targetReturn}-${o.horizon}`}>
                  <TableCell>
                    <RouterLink to={`/bull-run?symbol=${encodeURIComponent(o.symbol)}`}>
                      {o.symbol}
                    </RouterLink>
                  </TableCell>
                  <TableCell>{o.rank}</TableCell>
                  <TableCell>{formatProbabilityPercent(o.probability)}</TableCell>
                  <TableCell>{formatConfidence(o.confidence)}</TableCell>
                  <TableCell>{formatIntegrity(o.integrityStatus)}</TableCell>
                  <TableCell>{o.isBestPick ? '★' : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* Integrity */}
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
          <Chip label={`SUSPICIOUS ${integ?.suspicious ?? '—'}`} color="error" variant="outlined" />
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Advisory only — does not auto-reject unless policy already rejects.
        </Typography>
      </Paper>

      {/* Professional Trader */}
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
            <Typography variant="body2">
              Invalidation:{' '}
              {proPick.invalidationPrice != null
                ? String(proPick.invalidationPrice)
                : 'Not available'}
            </Typography>
            <Typography variant="body2">
              Horizon: {proPick.tradePlanHorizon ?? 'Not available'}
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

      {/* Paper */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
          Paper Trading
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Paper orders still require Recommendation → evaluateTrade() → Risk → Portfolio → Policy →
          Gate → Execution. Offline analysis ≠ execution-ready.
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

      <Typography variant="caption" color="text.secondary" display="block">
        {report.calibrationNote ??
          'Bull-Run cell calibration: Not available. Sample size on detail is historical window count.'}{' '}
        Data quality: analyzed {report.dataQuality.analyzed}, incomplete{' '}
        {report.dataQuality.incomplete}, fabricated {report.dataQuality.fabricated} (must stay 0).{' '}
        <RouterLink to="/research-reports">Research reports →</RouterLink>
      </Typography>

      <StockDetailDrawer
        open={detail != null}
        row={detail}
        batchId={report.batchId}
        defaultHorizon={horizon}
        onClose={() => setDetail(null)}
      />
    </Box>
  );
}

function StockDetailDrawer({
  open,
  row,
  batchId,
  defaultHorizon,
  onClose,
}: {
  open: boolean;
  row: BestPickRow | null;
  batchId: string;
  defaultHorizon: BullRunHorizon;
  onClose: () => void;
}): JSX.Element {
  const symbol = row?.symbol ?? '';
  const { data: live, isFetching } = useGetBullRunIntelligenceQuery(symbol, {
    skip: !open || !symbol,
  });

  const liveCells = live?.v2?.cells ?? [];
  const sampleSize =
    liveCells.find((c) => typeof c.sampleSize === 'number' && c.sampleSize != null)?.sampleSize ??
    null;
  const calibration =
    liveCells.find((c) => c.calibration != null && String(c.calibration).length > 0)?.calibration ??
    null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 440 } } }}
    >
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" fontWeight={800}>
          {symbol || 'Stock'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Batch {batchId} · Horizon default {defaultHorizon}
        </Typography>
        <Divider sx={{ my: 1.5 }} />
        {row ? (
          <Stack spacing={0.75}>
            <Typography variant="body2">
              Best Pick: {row.isBestPick !== false ? '★ YES' : 'NO'}
            </Typography>
            <Typography variant="body2">
              Recommendation: {row.recommendation ?? 'Not available'}
            </Typography>
            <Typography variant="body2">
              Exec Ready: {formatExecReady(row.tradePlanExecutionReady)} (backend only)
            </Typography>
            <Typography variant="body2">
              Integrity: {formatIntegrity(row.integrityStatus)}
            </Typography>
            <Typography variant="body2">Thesis: {row.thesis?.trim() || 'Not available'}</Typography>
          </Stack>
        ) : null}

        <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2, mb: 1 }}>
          Target × Horizon — P(≥T within H)
        </Typography>
        {row?.bullRunMatrix?.length ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Target</TableCell>
                {COMMAND_CENTER_HORIZONS.map((h) => (
                  <TableCell key={h} align="right">
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {COMMAND_CENTER_OPPORTUNITY_TARGETS.map((t) => (
                <TableRow key={t}>
                  <TableCell>{formatTargetLabel(t)}</TableCell>
                  {COMMAND_CENTER_HORIZONS.map((h) => (
                    <TableCell key={h} align="right">
                      {formatProbabilityCell(lookupMatrixProbability(row.bullRunMatrix, h, t))}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Batch matrix Not available for this symbol.
          </Typography>
        )}

        <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>
          Evidence / Why Now
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Labels from RankingContext / Trade Plan only — no FE score.
        </Typography>
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
          {row?.recommendation ? (
            <li>
              <Typography variant="body2">Rec: {row.recommendation}</Typography>
            </li>
          ) : null}
          {row?.tradePlanStatus ? (
            <li>
              <Typography variant="body2">TradePlan: {row.tradePlanStatus}</Typography>
            </li>
          ) : null}
          {row?.integrityStatus ? (
            <li>
              <Typography variant="body2">Integrity: {row.integrityStatus}</Typography>
            </li>
          ) : null}
          {!row?.recommendation && !row?.tradePlanStatus && !row?.integrityStatus ? (
            <li>
              <Typography variant="body2">Not available</Typography>
            </li>
          ) : null}
        </ul>

        <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 1 }}>
          Sample size / Calibration
        </Typography>
        {isFetching ? (
          <CircularProgress size={18} />
        ) : (
          <>
            <Typography variant="body2">
              Sample size:{' '}
              {sampleSize != null && Number.isFinite(Number(sampleSize))
                ? String(sampleSize)
                : 'Not available'}
            </Typography>
            <Typography variant="body2">
              Calibration:{' '}
              {calibration != null && String(calibration).length
                ? String(calibration)
                : 'Not available'}
            </Typography>
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button
            size="small"
            variant="contained"
            component={RouterLink}
            to={`/desk/trade-plan/${encodeURIComponent(symbol)}`}
          >
            Trade Plan
          </Button>
          <Button
            size="small"
            variant="outlined"
            component={RouterLink}
            to={`/bull-run?symbol=${encodeURIComponent(symbol)}`}
          >
            Bull-Run deep-dive
          </Button>
          <Button size="small" onClick={onClose}>
            Close
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
