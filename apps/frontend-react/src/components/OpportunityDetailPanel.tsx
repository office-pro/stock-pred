/**
 * Opportunities rich detail workspace — FE consume-only.
 * Never invents probability, ranking, Exec Ready, EvidenceScore, or histograms.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Link as RouterLink } from 'react-router-dom';
import { useGetBullRunIntelligenceQuery, useGetHistoricalAnaloguesQuery } from '../store/api';
import { useLiveQuote } from '../hooks/useLiveQuote';
import {
  COMMAND_CENTER_HORIZONS,
  OPPORTUNITY_DETAIL_TARGETS,
  confidenceChipColor,
  formatConfidence,
  formatExecReady,
  formatProbabilityCell,
  formatProbabilityPercent,
  formatSetupLabel,
  lookupMatrixProbability,
  matchCompactCell,
  matrixFromCompactCells,
  readBullRunV2Cells,
  type CompactBullRunCell,
  type HorizonMatrixLike,
} from '../lib/bull-run-display';

export type OpportunityDetailInput = {
  symbol: string;
  companyName?: string;
  rank?: number;
  exchange?: string;
  sector?: string;
  price?: number;
  opportunityId?: string;
  intelligenceContext?: Record<string, unknown>;
  bullRunMatrix?: HorizonMatrixLike[];
  supportingEvidence?: string[];
  conflictingEvidence?: string[];
  missingEvidence?: string[];
  evidenceQuality?: string;
  conflictSummary?: string;
  historicalStatus?: string;
  historicalSampleSize?: number | null;
  historicalNote?: string;
  thesis?: string;
  recommendation?: string;
  tradePlanExecutionReady?: boolean;
  tradePlanStatus?: string;
  tradePlanExpectedR?: number;
  tradePlanHorizon?: string;
  invalidationPrice?: number;
  integrityStatus?: string;
};

const DETAIL_TABS = [
  'Overview',
  'Thesis',
  'Prediction',
  'Bull-Run',
  'Financials',
  'News',
  'Trade Plan',
] as const;

type DetailTab = (typeof DETAIL_TABS)[number];

export type OpportunityDetailInitialTab = DetailTab;

function fmtPctFrac(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'Not available';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtMoney(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return 'Not available';
  return `₹${Number(v).toFixed(2)}`;
}

function ctxStr(ctx: Record<string, unknown>, key: string): string {
  const v = ctx[key];
  return v == null || v === '' ? 'Not available' : String(v);
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** Simple histogram bins from backend max-forward samples only — never invent samples. */
function buildHistogramBins(
  samples: number[] | undefined,
  target: number | null,
): { bins: Array<{ label: string; count: number; highlight: boolean }>; total: number } | null {
  if (!samples?.length) return null;
  const edges = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.5];
  const counts = new Array(edges.length + 1).fill(0) as number[];
  for (const s of samples) {
    if (!Number.isFinite(s)) continue;
    let placed = false;
    for (let i = 0; i < edges.length; i++) {
      if (s < edges[i]!) {
        counts[i]! += 1;
        placed = true;
        break;
      }
    }
    if (!placed) counts[counts.length - 1]! += 1;
  }
  const labels: string[] = [];
  labels.push(`<${Math.round(edges[0]! * 100)}%`);
  for (let i = 0; i < edges.length - 1; i++) {
    labels.push(`${Math.round(edges[i]! * 100)}–${Math.round(edges[i + 1]! * 100)}%`);
  }
  labels.push(`≥${Math.round(edges[edges.length - 1]! * 100)}%`);
  const bins = counts.map((count, i) => {
    const lo = i === 0 ? -Infinity : edges[i - 1]!;
    const hi = i >= edges.length ? Infinity : edges[i]!;
    const highlight = target != null && Number.isFinite(target) && lo <= target && target < hi;
    return { label: labels[i]!, count, highlight };
  });
  return { bins, total: samples.length };
}

export default function OpportunityDetailPanel({
  row,
  selectedTarget,
  selectedHorizon,
  batchId,
  onClose,
  initialTab = 'Overview',
  livePrice = false,
  universeLabel,
}: {
  row: OpportunityDetailInput;
  selectedTarget?: number;
  selectedHorizon?: string;
  batchId?: string;
  onClose?: () => void;
  initialTab?: OpportunityDetailInitialTab;
  /** When true, poll MDS live quote for the selected symbol only (no N×MDS). */
  livePrice?: boolean;
  /** Batch universe label for badge (e.g. NIFTY_500) — display only. */
  universeLabel?: string;
}): JSX.Element {
  const symbol = row.symbol;
  const ctx = row.intelligenceContext ?? {};
  const [tab, setTab] = useState<DetailTab>(initialTab);
  /** User-picked matrix cell (horizon × target) — drives Selected Setup + distribution. */
  const [pickedSetup, setPickedSetup] = useState<{ h: string; t: number } | null>(null);
  const liveQuote = useLiveQuote(livePrice ? symbol : '');

  useEffect(() => {
    setPickedSetup(null);
    setTab(initialTab);
  }, [row.symbol, initialTab]);

  const displayPrice =
    livePrice && liveQuote.price > 0
      ? liveQuote.price
      : row.price != null && Number.isFinite(row.price)
        ? row.price
        : typeof ctx.preferredEntry === 'number' && Number.isFinite(ctx.preferredEntry)
          ? ctx.preferredEntry
          : null;
  const displayChangePct =
    livePrice && liveQuote.changePercent != null ? liveQuote.changePercent : null;
  const displayChangeAbs =
    displayPrice != null &&
    liveQuote.previousClose != null &&
    Number.isFinite(liveQuote.previousClose) &&
    liveQuote.previousClose > 0
      ? displayPrice - liveQuote.previousClose
      : null;
  const avatarColor = (() => {
    const palette = ['#EF4444', '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4'];
    let h = 0;
    for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
    return palette[h % palette.length]!;
  })();
  const universeBadge = universeLabel ? String(universeLabel).replace(/_/g, ' ') : null;
  const { data: live, isFetching: liveFetching } = useGetBullRunIntelligenceQuery(symbol, {
    skip: !symbol,
  });
  const { data: histLive, isFetching: histFetching } = useGetHistoricalAnaloguesQuery(symbol, {
    skip: !symbol,
  });

  const compact = readBullRunV2Cells(ctx);
  const matrix: HorizonMatrixLike[] | undefined = row.bullRunMatrix?.length
    ? row.bullRunMatrix
    : compact.length
      ? matrixFromCompactCells(compact)
      : undefined;

  const defaultCell: CompactBullRunCell | undefined =
    matchCompactCell(compact, selectedTarget, selectedHorizon) ??
    (compact[0] as CompactBullRunCell | undefined);

  const setupHorizon = pickedSetup?.h ?? defaultCell?.h ?? selectedHorizon ?? '—';
  const setupTarget = pickedSetup?.t ?? defaultCell?.t ?? selectedTarget;

  const liveCells = live?.v2?.cells ?? live?.cells ?? [];
  const liveMatch =
    setupTarget != null && setupHorizon !== '—'
      ? liveCells.find(
          (c) =>
            c.horizon === setupHorizon &&
            Math.abs(c.targetReturn - setupTarget) < 1e-9 &&
            c.status === 'AVAILABLE',
        )
      : undefined;

  const compactMatch =
    setupTarget != null && setupHorizon !== '—'
      ? matchCompactCell(compact, setupTarget, setupHorizon)
      : undefined;

  const setupProb =
    liveMatch?.probability ??
    compactMatch?.p ??
    (setupHorizon !== '—' && setupTarget != null
      ? lookupMatrixProbability(matrix, setupHorizon, setupTarget)
      : null) ??
    (defaultCell?.status === 'UNAVAILABLE' ? null : (defaultCell?.p ?? null));
  const setupConf = liveMatch?.confidence ?? compactMatch?.conf ?? defaultCell?.conf;

  const sampleSize =
    liveMatch?.sampleSize ??
    liveCells.find((c) => typeof c.sampleSize === 'number')?.sampleSize ??
    row.historicalSampleSize ??
    null;
  const calibration =
    liveMatch?.calibration ??
    liveCells.find((c) => c.calibration != null && String(c.calibration).length > 0)?.calibration ??
    null;
  const dataAsOf =
    live?.v2?.provenance?.dataAsOf ??
    live?.v2?.dataAsOf ??
    live?.historicalIntelligence?.state?.asOfDate;
  const modelVersion = live?.v2?.provenance?.modelVersion;
  const featureVersion = live?.v2?.provenance?.featureVersion;

  const hist = histLive ?? live?.historicalIntelligence ?? null;
  const dist3m = hist?.forwardDistribution3M;
  const outcomes = hist?.outcomes;
  const analogues = hist?.analogues;

  const liveDist =
    setupHorizon !== '—'
      ? live?.v2?.distributions?.find(
          (d) =>
            d.horizon === setupHorizon && d.status === 'AVAILABLE' && d.maxForwardReturns?.length,
        )
      : undefined;

  const distSamples =
    liveDist?.maxForwardReturns ??
    (setupHorizon === '3M' && dist3m?.status === 'AVAILABLE'
      ? dist3m.maxForwardReturns
      : undefined);
  const distMedian =
    liveDist?.medianReturn ?? (setupHorizon === '3M' ? dist3m?.medianReturn : null);
  const distRange = liveDist?.upsideRange ?? (setupHorizon === '3M' ? dist3m?.upsideRange : null);
  const distSampleSize =
    liveDist?.sampleSize ??
    (setupHorizon === '3M' && dist3m?.status === 'AVAILABLE' ? dist3m.sampleSize : null);

  const supporting = row.supportingEvidence?.length
    ? row.supportingEvidence
    : strList(ctx.supportingEvidence);
  const conflicting = row.conflictingEvidence?.length
    ? row.conflictingEvidence
    : strList(ctx.conflictingEvidence);
  const missing = row.missingEvidence?.length ? row.missingEvidence : strList(ctx.missingEvidence);
  const evidenceQuality =
    row.evidenceQuality ??
    (typeof ctx.evidenceQuality === 'string' ? ctx.evidenceQuality : undefined);
  const conflictSummary =
    row.conflictSummary ??
    (typeof ctx.conflictSummary === 'string' ? ctx.conflictSummary : undefined);

  const recommendation =
    row.recommendation ??
    (typeof ctx.tradePlanRecommendation === 'string' ? ctx.tradePlanRecommendation : undefined);
  const direction = typeof ctx.tradePlanDirection === 'string' ? ctx.tradePlanDirection : undefined;
  const thesis = row.thesis ?? (typeof ctx.thesis === 'string' ? ctx.thesis : undefined);
  const tradePlanStatus =
    row.tradePlanStatus ??
    (typeof ctx.tradePlanStatus === 'string' ? ctx.tradePlanStatus : undefined);
  const execReady =
    row.tradePlanExecutionReady ??
    (typeof ctx.tradePlanExecutionReady === 'boolean' ? ctx.tradePlanExecutionReady : undefined);

  const histStatus =
    row.historicalStatus ??
    analogues?.status ??
    (typeof ctx.historicalStatus === 'string' ? ctx.historicalStatus : undefined);

  const outcome3m = outcomes?.outcomes?.find((o) => o.horizon === '3M' || o.horizon === '1M');
  const outcomeForSetup = outcomes?.outcomes?.find((o) => o.horizon === setupHorizon) ?? outcome3m;

  const histogram = buildHistogramBins(distSamples, setupTarget ?? null);
  const maxBin = histogram ? Math.max(...histogram.bins.map((b) => b.count), 1) : 1;

  const isOverviewish = tab === 'Overview';
  const showBull = isOverviewish || tab === 'Bull-Run' || tab === 'Prediction';
  const showHist = isOverviewish || tab === 'Prediction';
  const showEvidence = isOverviewish || tab === 'Thesis';
  const showPlan = isOverviewish || tab === 'Trade Plan';

  const regimeSim =
    analogues?.status === 'AVAILABLE' && analogues.analogues?.length
      ? analogues.analogues[0]?.marketRegime
      : null;
  const sectorSim =
    analogues?.status === 'AVAILABLE' && analogues.analogues?.length
      ? analogues.analogues[0]?.sectorState
      : null;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ mb: 1.5 }}
        gap={1}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 1.5,
              bgcolor: avatarColor,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {(symbol || '?').charAt(0).toUpperCase()}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" fontWeight={800} noWrap>
              {symbol}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {row.companyName ?? 'Company name Not available'}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
              <Chip size="small" variant="outlined" label={row.exchange ?? 'NSE'} />
              {row.sector ? <Chip size="small" variant="outlined" label={row.sector} /> : null}
              {universeBadge ? (
                <Chip size="small" variant="outlined" label={universeBadge} />
              ) : null}
              {row.rank != null ? (
                <Chip size="small" variant="outlined" label={`Rank #${row.rank}`} />
              ) : null}
            </Stack>
            <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>
              {displayPrice != null ? fmtMoney(displayPrice) : 'Price Not available'}
              {displayChangeAbs != null && Number.isFinite(displayChangeAbs) ? (
                <Typography
                  component="span"
                  variant="body2"
                  sx={{
                    ml: 1,
                    color: displayChangeAbs >= 0 ? 'success.main' : 'error.main',
                    fontWeight: 600,
                  }}
                >
                  {displayChangeAbs >= 0 ? '+' : ''}
                  {displayChangeAbs.toFixed(2)}
                </Typography>
              ) : null}
              {displayChangePct != null && Number.isFinite(displayChangePct) ? (
                <Typography
                  component="span"
                  variant="body2"
                  sx={{
                    ml: 0.75,
                    color: displayChangePct >= 0 ? 'success.main' : 'error.main',
                    fontWeight: 600,
                  }}
                >
                  ({displayChangePct >= 0 ? '+' : ''}
                  {displayChangePct.toFixed(2)}%)
                </Typography>
              ) : null}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
          <Button size="small" variant="outlined" disabled>
            + Add to Watchlist
          </Button>
          {onClose ? (
            <IconButton size="small" onClick={onClose} aria-label="Close detail">
              <CloseIcon fontSize="small" />
            </IconButton>
          ) : null}
        </Stack>
      </Stack>

      <Tabs
        value={tab}
        onChange={(_, v: DetailTab) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          mb: 1.5,
          minHeight: 40,
          '& .MuiTab-root': { textTransform: 'none', minHeight: 40, fontWeight: 600 },
        }}
      >
        {DETAIL_TABS.map((t) => (
          <Tab key={t} value={t} label={t} />
        ))}
      </Tabs>

      {(liveFetching || histFetching) && <LinearProgress sx={{ mb: 1 }} />}

      <Box sx={{ overflow: 'auto', flex: 1, pr: 0.5 }}>
        {isOverviewish ? (
          <>
            <Box
              sx={{
                p: 2,
                mb: 2,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'action.hover',
              }}
            >
              <Typography variant="overline" color="text.secondary">
                Selected Setup
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                alignItems={{ sm: 'center' }}
                justifyContent="space-between"
              >
                <Typography variant="h4" fontWeight={800}>
                  {setupTarget != null && setupHorizon !== '—'
                    ? formatSetupLabel(setupHorizon, setupTarget)
                    : 'Not available'}
                </Typography>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box textAlign="right">
                    <Typography variant="h4" fontWeight={800}>
                      {formatProbabilityPercent(setupProb)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Estimated Probability
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    color={confidenceChipColor(setupConf)}
                    label={
                      setupConf
                        ? `${formatConfidence(setupConf)} RELIABILITY`
                        : 'Reliability Not available'
                    }
                  />
                </Stack>
              </Stack>
              <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mt: 1.5 }}>
                <Typography variant="caption">
                  Sample Size: {sampleSize != null ? String(sampleSize) : 'Not available'}
                </Typography>
                <Typography variant="caption">
                  Calibration: {calibration != null ? String(calibration) : 'Not available'}
                </Typography>
                <Typography variant="caption">
                  Data As Of: {dataAsOf != null ? String(dataAsOf) : 'Not available'}
                </Typography>
                <Typography variant="caption">Model: {modelVersion ?? 'Not available'}</Typography>
                <Typography variant="caption">
                  Features: {featureVersion ?? 'Not available'}
                </Typography>
              </Stack>
            </Box>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2 }}>
              {['Current Price', 'Sector', 'Market State'].map((label) => (
                <Box
                  key={label}
                  sx={{
                    flex: 1,
                    p: 1.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {label === 'Current Price'
                      ? row.price != null
                        ? fmtMoney(row.price)
                        : 'Sparkline Not available'
                      : label === 'Sector'
                        ? `${row.sector ?? ctxStr(ctx, 'sectorState')} — series Not available`
                        : `${ctxStr(ctx, 'regimeCombo')} — series Not available`}
                  </Typography>
                </Box>
              ))}
            </Stack>

            <Alert severity="warning" sx={{ mb: 2 }}>
              Presentation only — APPROVE ≠ Authorization. Trades still require: evaluateTrade() →
              Risk → Portfolio → Policy → Gate → Execution.
              {recommendation === 'APPROVE' && execReady === false
                ? ' APPROVE without executionReady is advisory only.'
                : ''}
              {batchId ? ` Batch ${batchId}.` : ''}
            </Alert>
          </>
        ) : null}

        {showBull && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Bull-Run Probability Matrix
            </Typography>
            {matrix?.length ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Horizon / Target</TableCell>
                    {OPPORTUNITY_DETAIL_TARGETS.map((t) => (
                      <TableCell key={t} align="right">
                        ≥{Math.round(t * 100)}%
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {COMMAND_CENTER_HORIZONS.map((h) => (
                    <TableRow key={h}>
                      <TableCell>{h}</TableCell>
                      {OPPORTUNITY_DETAIL_TARGETS.map((t) => {
                        const p = lookupMatrixProbability(matrix, h, t);
                        const selected =
                          setupHorizon === h &&
                          setupTarget != null &&
                          Math.abs(setupTarget - t) < 1e-9;
                        const clickable = p != null && Number.isFinite(p);
                        return (
                          <TableCell
                            key={t}
                            align="right"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!clickable) return;
                              setPickedSetup({ h, t });
                              if (tab === 'Overview' || tab === 'Bull-Run') {
                                /* keep */
                              } else {
                                setTab('Prediction');
                              }
                            }}
                            title={
                              clickable
                                ? `Select ${h} ≥ ${Math.round(t * 100)}% — update Selected Setup & distribution`
                                : 'Not available'
                            }
                            sx={{
                              cursor: clickable ? 'pointer' : 'default',
                              userSelect: 'none',
                              ...(selected
                                ? {
                                    bgcolor: 'primary.dark',
                                    color: 'primary.contrastText',
                                    fontWeight: 700,
                                  }
                                : clickable
                                  ? {
                                      '&:hover': {
                                        bgcolor: 'action.selected',
                                      },
                                    }
                                  : undefined),
                            }}
                          >
                            {formatProbabilityCell(p)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Matrix Not available
              </Typography>
            )}
          </Box>
        )}

        {showBull && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Forward Return Distribution
              {setupHorizon !== '—' ? ` (${setupHorizon})` : ''}
              {setupTarget != null ? ` · target ≥${Math.round(setupTarget * 100)}%` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Click a matrix probability to select that Target×Horizon. Chart uses backend
              max-forward samples for the selected horizon when available — never invented.
            </Typography>
            {histogram ? (
              <>
                <Stack
                  direction="row"
                  alignItems="flex-end"
                  spacing={0.5}
                  sx={{ height: 96, mb: 1 }}
                >
                  {histogram.bins.map((b) => (
                    <Box
                      key={b.label}
                      title={`${b.label}: ${b.count}`}
                      sx={{
                        flex: 1,
                        height: `${Math.max(4, (b.count / maxBin) * 100)}%`,
                        bgcolor: b.highlight ? 'primary.main' : 'action.selected',
                        borderRadius: '2px 2px 0 0',
                      }}
                    />
                  ))}
                </Stack>
                <Stack direction="row" flexWrap="wrap" gap={2}>
                  <Typography variant="caption">
                    P(≥ target): {formatProbabilityPercent(setupProb)}
                  </Typography>
                  <Typography variant="caption">
                    Median: {distMedian != null ? fmtPctFrac(distMedian) : 'Not available'}
                  </Typography>
                  <Typography variant="caption">
                    Expected range:{' '}
                    {distRange
                      ? `${fmtPctFrac(distRange.low)} to ${fmtPctFrac(distRange.high)}`
                      : 'Not available'}
                  </Typography>
                  <Typography variant="caption">
                    Sample Size: {distSampleSize ?? histogram.total}
                  </Typography>
                </Stack>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Forward distribution Not available for{' '}
                {setupHorizon !== '—' ? setupHorizon : 'this'} horizon (no max-forward samples).
                Selected Setup still updates from the matrix cell.
              </Typography>
            )}
          </Box>
        )}

        {showHist && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Historical Similar Situations
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Status: {histStatus ?? 'Not available'}
              {row.historicalNote ? ` — ${row.historicalNote}` : ''}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={2}>
              <Typography variant="body2">
                Total Matches:{' '}
                {analogues?.status === 'AVAILABLE'
                  ? analogues.sampleSize
                  : row.historicalSampleSize != null
                    ? row.historicalSampleSize
                    : 'Not available'}
              </Typography>
              <Typography variant="body2">
                Positive Outcome Rate:{' '}
                {outcomeForSetup?.positiveRate != null
                  ? fmtPctFrac(outcomeForSetup.positiveRate)
                  : 'Not available'}
              </Typography>
              <Typography variant="body2">
                Median Forward Return:{' '}
                {outcomeForSetup?.forwardReturnMedian != null
                  ? fmtPctFrac(outcomeForSetup.forwardReturnMedian)
                  : 'Not available'}
              </Typography>
              <Typography variant="body2">
                Typical Drawdown:{' '}
                {outcomeForSetup?.maxDrawdownMedian != null
                  ? fmtPctFrac(outcomeForSetup.maxDrawdownMedian)
                  : 'Not available'}
              </Typography>
              <Typography variant="body2">Median Time to Target: Not available</Typography>
              <Typography variant="body2">Median Time to Recovery: Not available</Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Chip
                size="small"
                label={`Regime Similarity: ${regimeSim ?? 'Not available'}`}
                color={regimeSim ? 'success' : 'default'}
                variant="outlined"
              />
              <Chip
                size="small"
                label={`Sector Similarity: ${sectorSim ?? 'Not available'}`}
                color={sectorSim ? 'success' : 'default'}
                variant="outlined"
              />
            </Stack>
          </Box>
        )}

        {showEvidence && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Evidence Balance
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {conflictSummary ?? 'No EvidenceScore — qualitative labels only.'}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="success.main" fontWeight={700}>
                  {supporting.length} Supporting
                </Typography>
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                  {supporting.length ? (
                    supporting.map((e) => (
                      <li key={`s-${e}`}>
                        <Typography variant="body2">{e}</Typography>
                      </li>
                    ))
                  ) : (
                    <li>
                      <Typography variant="body2">Not available</Typography>
                    </li>
                  )}
                </ul>
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="error.main" fontWeight={700}>
                  {conflicting.length} Conflicting
                </Typography>
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                  {conflicting.length ? (
                    conflicting.map((e) => (
                      <li key={`c-${e}`}>
                        <Typography variant="body2">{e}</Typography>
                      </li>
                    ))
                  ) : (
                    <li>
                      <Typography variant="body2">Not available</Typography>
                    </li>
                  )}
                </ul>
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="warning.main" fontWeight={700}>
                  {missing.length} Missing
                </Typography>
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                  {missing.length ? (
                    missing.map((e) => (
                      <li key={`m-${e}`}>
                        <Typography variant="body2">{e}</Typography>
                      </li>
                    ))
                  ) : (
                    <li>
                      <Typography variant="body2">Not available</Typography>
                    </li>
                  )}
                </ul>
              </Box>
            </Stack>
            <Chip
              size="small"
              sx={{ mt: 1 }}
              label={`Evidence Quality: ${evidenceQuality ?? 'Not available'}`}
              color={
                evidenceQuality === 'STRONG'
                  ? 'success'
                  : evidenceQuality === 'MIXED' || evidenceQuality === 'MODERATE'
                    ? 'warning'
                    : 'default'
              }
            />
          </Box>
        )}

        {showPlan && (
          <>
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Professional Assessment
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Chip size="small" label={`Direction: ${direction ?? 'Not available'}`} />
                <Chip
                  size="small"
                  color={
                    recommendation === 'APPROVE'
                      ? 'success'
                      : recommendation === 'WAIT'
                        ? 'warning'
                        : recommendation === 'REJECT'
                          ? 'error'
                          : 'default'
                  }
                  label={recommendation ?? 'Not available'}
                />
              </Stack>
              <Typography variant="body2">
                <strong>Thesis:</strong> {thesis?.trim() || 'Not available'}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                <strong>Key Reasons:</strong>{' '}
                {supporting.length ? supporting.join('; ') : ctxStr(ctx, 'opportunityQuality')}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                <strong>Invalidation:</strong>{' '}
                {row.invalidationPrice != null
                  ? fmtMoney(row.invalidationPrice)
                  : ctx.invalidationPrice != null
                    ? fmtMoney(ctx.invalidationPrice)
                    : Array.isArray(live?.invalidation) && live.invalidation.length
                      ? live.invalidation.join('; ')
                      : 'Not available'}
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Trade Plan
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Entry</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Stop Loss</TableCell>
                    <TableCell>Expected Return</TableCell>
                    <TableCell>Horizon</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      {ctx.preferredEntry != null
                        ? fmtMoney(ctx.preferredEntry)
                        : ctx.buyZoneLow != null
                          ? `${fmtMoney(ctx.buyZoneLow)}–${fmtMoney(ctx.buyZoneHigh)}`
                          : 'Not available'}
                    </TableCell>
                    <TableCell>
                      {ctx.target1 != null ? fmtMoney(ctx.target1) : 'Not available'}
                    </TableCell>
                    <TableCell>
                      {ctx.invalidationPrice != null || row.invalidationPrice != null
                        ? fmtMoney(ctx.invalidationPrice ?? row.invalidationPrice)
                        : 'Not available'}
                    </TableCell>
                    <TableCell>
                      {ctx.expectedReturnLow != null || ctx.expectedReturnHigh != null
                        ? `${ctx.expectedReturnLow ?? '—'}–${ctx.expectedReturnHigh ?? '—'}`
                        : row.tradePlanExpectedR != null
                          ? `${row.tradePlanExpectedR}R`
                          : ctx.tradePlanExpectedR != null
                            ? `${ctx.tradePlanExpectedR}R`
                            : 'Not available'}
                    </TableCell>
                    <TableCell>
                      {row.tradePlanHorizon ??
                        (typeof ctx.tradePlanHorizon === 'string'
                          ? ctx.tradePlanHorizon
                          : setupHorizon !== '—'
                            ? setupHorizon
                            : 'Not available')}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Button
                sx={{ mt: 1 }}
                size="small"
                component={RouterLink}
                to={`/desk/trade-plan/${encodeURIComponent(symbol)}${
                  row.opportunityId ? `?opportunityId=${encodeURIComponent(row.opportunityId)}` : ''
                }`}
              >
                View Full Plan →
              </Button>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Execution Status
              </Typography>
              <Stack direction="row" spacing={1}>
                <Chip
                  size="small"
                  color={tradePlanStatus === 'COMPLETE' ? 'success' : 'default'}
                  label={`TradePlan: ${tradePlanStatus ?? 'Not available'}`}
                />
                <Chip
                  size="small"
                  color={execReady === true ? 'success' : 'error'}
                  label={`Execution: ${
                    execReady === true
                      ? 'READY'
                      : execReady === false
                        ? 'NOT READY'
                        : 'Not available'
                  }`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Exec Ready flag: ${formatExecReady(execReady)}`}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Integrity: {row.integrityStatus ?? ctxStr(ctx, 'integrityStatus')} · Bull-Run
                executionReadyFromBullRun never authorizes trades.
              </Typography>
            </Box>
          </>
        )}

        {tab === 'Financials' && (
          <Typography variant="body2" color="text.secondary">
            Financials Not available on this Opportunities surface — open stock detail /
            fundamentals when wired.
          </Typography>
        )}

        {tab === 'News' && (
          <Typography variant="body2" color="text.secondary">
            News Not available on this batch research surface.
          </Typography>
        )}

        {tab === 'Thesis' && !showEvidence ? (
          <Typography variant="body2">
            <strong>Thesis:</strong> {thesis?.trim() || 'Not available'}
          </Typography>
        ) : null}

        <Divider sx={{ my: 1.5 }} />
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{
            p: 1.25,
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'rgba(21, 25, 33, 0.9)',
          }}
        >
          <Chip
            size="small"
            variant="outlined"
            label={`1W Target: ${
              setupTarget != null && Number.isFinite(setupTarget)
                ? `+${Math.round(setupTarget * 100)}%`
                : 'Not available'
            }`}
          />
          <Chip
            size="small"
            variant="outlined"
            label={`Expected R: ${
              row.tradePlanExpectedR != null && Number.isFinite(row.tradePlanExpectedR)
                ? row.tradePlanExpectedR.toFixed(2)
                : 'Not available'
            }`}
          />
          <Chip
            size="small"
            color={confidenceChipColor(setupConf)}
            label={`Confidence: ${formatConfidence(setupConf)}`}
          />
          <Chip
            size="small"
            color={
              String(evidenceQuality ?? '').toUpperCase() === 'STRONG'
                ? 'success'
                : String(evidenceQuality ?? '').toUpperCase() === 'MIXED'
                  ? 'warning'
                  : 'default'
            }
            label={`Quality: ${evidenceQuality ?? 'Not available'}`}
          />
          <Chip
            size="small"
            color={
              String(recommendation ?? '').toUpperCase() === 'APPROVE'
                ? 'success'
                : String(recommendation ?? '').toUpperCase() === 'WAIT'
                  ? 'warning'
                  : String(recommendation ?? '').toUpperCase() === 'REJECT'
                    ? 'error'
                    : 'default'
            }
            label={`Status: ${
              String(recommendation ?? '').toUpperCase() === 'APPROVE'
                ? 'BUY'
                : String(recommendation ?? '').toUpperCase() === 'REJECT'
                  ? 'AVOID'
                  : String(recommendation ?? '').toUpperCase() === 'WAIT'
                    ? 'WAIT'
                    : (recommendation ?? 'Not available')
            }`}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Confidence ≠ probability. Missing cells show — / Not available, never fabricated 0%.
          RankingContext order is backend-owned.
        </Typography>
      </Box>
    </Box>
  );
}
