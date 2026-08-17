import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Grid,
  IconButton,
  Skeleton,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { useParams } from 'react-router-dom';
import type { PatternEventView } from '@stockpred/shared-types';
import CandleChart, { ChartSignalMarker } from '../components/CandleChart';
import LivePriceStrip from '../components/LivePriceStrip';
import PaperBuyButton from '../components/PaperBuyButton';
import SignalBadge from '../components/SignalBadge';
import { holdingForSymbol } from '../lib/paper-pnl';
import {
  useGetCandlesQuery,
  useGetCompareQuery,
  useGetDepthQuery,
  useGetIndexCandlesQuery,
  useGetPortfolioQuery,
  useGetPredictionsQuery,
  useGetStockQuery,
  useGetSupportResistanceQuery,
  useGetSymbolPatternsQuery,
  useGetSymbolSignalsQuery,
} from '../store/api';

const BENCHMARK = 'NIFTY_50';
const FULL_HISTORY_LIMIT = 5000;
const RANGE_BARS = { '1Y': 252, '3Y': 756, MAX: 5000 } as const;
const MAX_CHART_MARKERS = 16;

type OverlayMode = 'OFF' | 'BUY' | 'SELL' | 'BOTH';
type HistoryRange = keyof typeof RANGE_BARS;

function fmtDate(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  return new Date(Number(ms)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value <= 0) return '—';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function eventKey(row: PatternEventView, index: number): string {
  return `${row.pattern}-${row.confirmedAt}-${row.action}-${index}`;
}

export default function StockDetailPage(): JSX.Element {
  const { symbol = '' } = useParams();
  const upper = symbol.toUpperCase();
  const [compareMode, setCompareMode] = useState(false);
  const [overlay, setOverlay] = useState<OverlayMode>('BUY');
  const [historyRange, setHistoryRange] = useState<HistoryRange>('3Y');
  const [showPatterns, setShowPatterns] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [chartHeight, setChartHeight] = useState(480);
  const [toast, setToast] = useState<{
    text: string;
    severity: 'success' | 'error' | 'info';
  } | null>(null);

  const { data: stock } = useGetStockQuery(upper, { pollingInterval: 3_000 });
  const { data: portfolio } = useGetPortfolioQuery(undefined, { pollingInterval: 10_000 });
  const paperLot = holdingForSymbol(portfolio?.holdings, upper);
  const { data: candles, isLoading } = useGetCandlesQuery({
    symbol: upper,
    limit: FULL_HISTORY_LIMIT,
  });
  const { data: sr } = useGetSupportResistanceQuery(upper);
  const { data: signals } = useGetSymbolSignalsQuery(upper, { pollingInterval: 30_000 });
  const { data: patterns } = useGetSymbolPatternsQuery(upper);
  const { data: predictions, isError: predictionsUnavailable } = useGetPredictionsQuery(upper);
  const { data: depth } = useGetDepthQuery(upper, { pollingInterval: 5_000 });
  const { data: comparison } = useGetCompareQuery(
    { symbol: upper, benchmark: BENCHMARK },
    { skip: !compareMode },
  );
  const { data: benchmarkCandles } = useGetIndexCandlesQuery(
    { index: BENCHMARK, limit: FULL_HISTORY_LIMIT },
    { skip: !compareMode },
  );

  const events = patterns?.events ?? [];
  const analog = patterns?.analog ?? null;
  const currentPattern = patterns?.current?.[0];
  const current = signals?.current;

  const visibleCandles = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    const limit = RANGE_BARS[historyRange];
    return candles.length > limit ? candles.slice(-limit) : candles;
  }, [candles, historyRange]);

  const visibleWindowStart = visibleCandles[0]?.time ?? 0;

  const markers = useMemo<ChartSignalMarker[]>(() => {
    const source =
      events.length > 0
        ? events.map((row) => ({
            time: Number(row.confirmedAt),
            signal: row.action as 'BUY' | 'SELL',
            text: row.pattern.replaceAll('_', ' '),
          }))
        : (signals?.history ?? []).map((row) => ({
            time: new Date(row.createdAt).getTime(),
            signal: row.signal as 'BUY' | 'SELL',
            text: String(row.confidence),
          }));
    const side =
      overlay === 'BUY' || overlay === 'SELL'
        ? source.filter((row) => row.signal === overlay)
        : source;
    if (!showPatterns) return [];
    return side
      .filter((row) => row.time >= visibleWindowStart)
      .sort((a, b) => b.time - a.time)
      .slice(0, chartExpanded ? 32 : MAX_CHART_MARKERS)
      .reverse();
  }, [events, signals, overlay, visibleWindowStart, showPatterns, chartExpanded]);

  const reading = useMemo(() => {
    if (visibleCandles.length < 2) return null;
    const first = visibleCandles[0];
    const last = visibleCandles[visibleCandles.length - 1];
    const high = Math.max(...visibleCandles.map((c) => c.high));
    const low = Math.min(...visibleCandles.map((c) => c.low));
    const changePct = first.close > 0 ? ((last.close - first.close) / first.close) * 100 : 0;
    const supports = [...(sr?.support ?? [])].sort(
      (a, b) => Math.abs(a - last.close) - Math.abs(b - last.close),
    );
    const resistances = [...(sr?.resistance ?? [])].sort(
      (a, b) => Math.abs(a - last.close) - Math.abs(b - last.close),
    );
    const nearestSupport = supports.find((level) => level <= last.close) ?? supports[0];
    const nearestResistance = resistances.find((level) => level >= last.close) ?? resistances[0];
    const windowEvents = events.filter((row) => Number(row.confirmedAt) >= first.time);
    const buys = windowEvents.filter((row) => row.action === 'BUY').length;
    const sells = windowEvents.filter((row) => row.action === 'SELL').length;
    return {
      changePct,
      high,
      low,
      last: last.close,
      nearestSupport,
      nearestResistance,
      buys,
      sells,
    };
  }, [visibleCandles, sr, events]);

  const firstBar = visibleCandles[0]?.time ?? candles?.[0]?.time ?? patterns?.firstBarAt;
  const lastBar =
    visibleCandles[visibleCandles.length - 1]?.time ??
    candles?.[candles.length - 1]?.time ??
    patterns?.lastBarAt;
  const sessionCount = visibleCandles.length || candles?.length || patterns?.barCount || 0;

  const paperAction = stock?.suggestion ?? 'HOLD';
  const alertSeverity =
    paperAction === 'BUY' || patterns?.outlook === 'GROW'
      ? 'success'
      : paperAction === 'SELL' || patterns?.outlook === 'FALL'
        ? 'warning'
        : 'info';

  useEffect(() => {
    const applyHeight = (): void => {
      setChartHeight(chartExpanded ? Math.max(420, window.innerHeight - 220) : 480);
    };
    applyHeight();
    if (!chartExpanded) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setChartExpanded(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('resize', applyHeight);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('resize', applyHeight);
      window.removeEventListener('keydown', onKey);
    };
  }, [chartExpanded]);

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }} flexWrap="wrap">
        <Typography variant="h5" fontWeight={700}>
          {upper}
        </Typography>
        {stock && (
          <>
            <Chip size="small" label={stock.exchange} />
            <Chip size="small" label={stock.sector} variant="outlined" />
            <SignalBadge signal={paperAction} />
          </>
        )}
        {currentPattern && (
          <Chip
            size="small"
            variant="outlined"
            label={currentPattern.pattern.replaceAll('_', ' ')}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={
            <Switch checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
          }
          label="Compare vs Nifty Midcap"
        />
      </Stack>

      <LivePriceStrip
        symbol={upper}
        quotePrice={stock?.price}
        changePercent={stock?.changePercent}
        listedAt={stock?.updatedAt}
        previousClose={stock?.previousClose}
        holding={paperLot}
      />

      <Alert severity={alertSeverity} sx={{ mb: 2 }} data-testid="detail-alert">
        {paperAction === 'BUY' || paperAction === 'SELL' ? (
          <>
            Paper <b>{paperAction}</b> at ₹{fmtPrice(stock?.entry)} · target ₹
            {fmtPrice(stock?.target)} · stop ₹{fmtPrice(stock?.stopLoss)}
            {stock?.confidence ? ` · ${stock.confidence.toFixed(0)}%` : ''}.{' '}
            {stock && (
              <PaperBuyButton
                stock={stock}
                onResult={(text, severity) => setToast({ text, severity })}
              />
            )}{' '}
          </>
        ) : (
          <>ML chip is Hold. </>
        )}
        {patterns?.outlook === 'GROW'
          ? 'Historic pattern matches lean up.'
          : patterns?.outlook === 'FALL'
            ? 'Historic pattern matches lean down.'
            : (patterns?.outlookText ?? 'Pattern history loads with the chart.')}{' '}
        This is not investment advice.
      </Alert>

      {compareMode && comparison && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Relative strength vs {BENCHMARK}: <b>{comparison.relativeStrength}</b> | relative
          performance: <b>{comparison.relativePerformancePercent}%</b> over {comparison.windowDays}{' '}
          sessions.
        </Alert>
      )}

      {isLoading && <Skeleton variant="rounded" height={480} />}
      {candles && candles.length > 0 && (
        <Card
          variant="outlined"
          sx={
            chartExpanded
              ? {
                  position: 'fixed',
                  inset: 16,
                  zIndex: 1300,
                  mb: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  bgcolor: 'background.paper',
                }
              : { mb: 3 }
          }
          data-testid="price-chart-card"
        >
          <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ xs: 'stretch', md: 'center' }}
              sx={{ mb: 1 }}
              flexWrap="wrap"
            >
              <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
                Price
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={historyRange}
                onChange={(_e, value: HistoryRange | null) => {
                  if (value) setHistoryRange(value);
                }}
                aria-label="Chart range"
              >
                <ToggleButton value="1Y">1Y</ToggleButton>
                <ToggleButton value="3Y">3Y</ToggleButton>
                <ToggleButton value="MAX">Max</ToggleButton>
              </ToggleButtonGroup>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={overlay}
                onChange={(_e, value: OverlayMode | null) => {
                  if (value) setOverlay(value);
                }}
                aria-label="Buy or sell overlay"
                data-testid="overlay-toggle"
              >
                <ToggleButton value="OFF">Price</ToggleButton>
                <ToggleButton value="BUY" color="success">
                  Buy · support
                </ToggleButton>
                <ToggleButton value="SELL" color="error">
                  Sell · resistance
                </ToggleButton>
                <ToggleButton value="BOTH">Both</ToggleButton>
              </ToggleButtonGroup>
              <ToggleButton
                value="PATTERNS"
                size="small"
                selected={showPatterns}
                onChange={() => setShowPatterns((on) => !on)}
                data-testid="patterns-toggle"
              >
                Patterns
              </ToggleButton>
              <IconButton
                size="small"
                onClick={() => setChartExpanded((on) => !on)}
                aria-label={chartExpanded ? 'Exit full screen' : 'Expand chart'}
                data-testid="chart-fullscreen"
              >
                {chartExpanded ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {fmtDate(firstBar)} → {fmtDate(lastBar)} · {sessionCount.toLocaleString('en-IN')}{' '}
              daily sessions
              {candles.length > sessionCount
                ? ` (window of ${candles.length.toLocaleString('en-IN')} total)`
                : ''}
              . Buy plots nearest support; Sell plots nearest resistance.
              {showPatterns
                ? ' Pattern arrows are on; names stay short on the chart.'
                : ' Turn on Patterns to plot buy/sell setups on the candles.'}
            </Typography>
            {reading && (
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
                <Chip
                  size="small"
                  label={`Window ${fmtPct(reading.changePct)}`}
                  color={reading.changePct >= 0 ? 'success' : 'error'}
                  variant="outlined"
                />
                <Chip size="small" label={`High ₹${fmtPrice(reading.high)}`} variant="outlined" />
                <Chip size="small" label={`Low ₹${fmtPrice(reading.low)}`} variant="outlined" />
                {reading.nearestSupport != null && (
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={`Support ₹${fmtPrice(reading.nearestSupport)}`}
                  />
                )}
                {reading.nearestResistance != null && (
                  <Chip
                    size="small"
                    color="error"
                    variant="outlined"
                    label={`Resistance ₹${fmtPrice(reading.nearestResistance)}`}
                  />
                )}
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${reading.buys} buy / ${reading.sells} sell prints`}
                />
              </Stack>
            )}
            <CandleChart
              candles={visibleCandles}
              supportResistance={sr ?? null}
              showSupport={overlay === 'BUY' || overlay === 'BOTH'}
              showResistance={overlay === 'SELL' || overlay === 'BOTH'}
              target={paperAction === 'HOLD' ? null : (stock?.target ?? current?.target ?? null)}
              stopLoss={
                paperAction === 'HOLD' ? null : (stock?.stopLoss ?? current?.stopLoss ?? null)
              }
              markers={markers}
              markerLabels={showPatterns && chartExpanded}
              height={chartHeight}
              comparison={
                compareMode && benchmarkCandles
                  ? {
                      name: 'Nifty Midcap 100',
                      candles:
                        benchmarkCandles.length > RANGE_BARS[historyRange]
                          ? benchmarkCandles.slice(-RANGE_BARS[historyRange])
                          : benchmarkCandles,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>
      )}
      {!isLoading && (!candles || candles.length === 0) && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          No daily candles yet for {upper}. History appears after market-data loads Yahoo or
          bhavcopy for this symbol.
        </Alert>
      )}

      <Grid container spacing={2}>
        {stock?.scanner && (
          <Grid item xs={12}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Bull / bear snapshot
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                  <Chip
                    label={`Bull ${stock.scanner.bullScore}/100`}
                    color="success"
                    size="small"
                  />
                  <Chip label={`Bear ${stock.scanner.bearScore}/100`} color="error" size="small" />
                  <Chip label={stock.scanner.band.replace(/_/g, ' ')} size="small" />
                  <Chip label={stock.scanner.risk.replace(/_/g, ' ')} size="small" />
                  {stock.scanner.forecast && (
                    <Chip
                      size="small"
                      label={`UP ${stock.scanner.forecast.upProbability}% · 20D ${stock.scanner.forecast.expectedReturn20d >= 0 ? '+' : ''}${stock.scanner.forecast.expectedReturn20d}%`}
                    />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Structure {stock.scanner.structure.trend.replace(/_/g, '/')} (HH{' '}
                  {stock.scanner.structure.higherHighs} / HL {stock.scanner.structure.higherLows}).
                  RS vs NIFTY 50:{' '}
                  {stock.scanner.relativeStrengthNifty50 ?? stock.relativeStrengthNifty50 ?? '—'}
                  {stock.scanner.niftyOutperformancePercent != null
                    ? ` (${stock.scanner.niftyOutperformancePercent >= 0 ? '+' : ''}${stock.scanner.niftyOutperformancePercent}%)`
                    : ''}
                  . Forecast 5D {stock.scanner.forecast?.expectedReturn5d ?? '—'}% / 10D{' '}
                  {stock.scanner.forecast?.expectedReturn10d ?? '—'}% / 20D{' '}
                  {stock.scanner.forecast?.expectedReturn20d ?? '—'}%. Contributors: trend{' '}
                  {stock.scanner.contributors.trend}, momentum {stock.scanner.contributors.momentum}
                  , volume {stock.scanner.contributors.volume}, breakout{' '}
                  {stock.scanner.contributors.breakout}, RS{' '}
                  {stock.scanner.contributors.relativeStrength}, structure{' '}
                  {stock.scanner.contributors.structure}, breadth{' '}
                  {stock.scanner.contributors.breadth}, regime {stock.scanner.contributors.regime}.
                  Range 20D bear {stock.scanner.forecast?.bearCase20d ?? '—'}% / base{' '}
                  {stock.scanner.forecast?.baseCase20d ?? '—'}% / bull{' '}
                  {stock.scanner.forecast?.bullCase20d ?? '—'}%.
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {(stock.scanner.reasons ?? []).join(' · ') || 'No rule reasons yet.'}{' '}
                  Probabilities only; not a guaranteed move.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}
        <Grid item xs={12} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Historic match
              </Typography>
              {patterns?.outlook && (
                <Chip
                  size="small"
                  sx={{ mb: 1 }}
                  color={
                    patterns.outlook === 'GROW'
                      ? 'success'
                      : patterns.outlook === 'FALL'
                        ? 'error'
                        : 'default'
                  }
                  label={
                    patterns.outlook === 'GROW'
                      ? 'May grow'
                      : patterns.outlook === 'FALL'
                        ? 'May fall'
                        : 'Unclear'
                  }
                />
              )}
              <Typography variant="body2" sx={{ mb: 1 }}>
                {analog?.suggestion ??
                  patterns?.outlookText ??
                  'Scanning this stock’s own history for named pattern repeats.'}
              </Typography>
              {analog && (
                <Typography variant="caption" color="text.secondary">
                  Sample {analog.sampleSize}
                  {analog.medianReturn10 != null &&
                    ` · median 10d ${fmtPct(analog.medianReturn10)}`}
                  {analog.winRate10 != null && ` · win ${analog.winRate10.toFixed(0)}%`}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                ML Predictions
              </Typography>
              {predictionsUnavailable && (
                <Alert severity="info">
                  Models not trained yet - run <code>npm run train:ml</code>.
                </Alert>
              )}
              {predictions?.predictions.map((prediction) => (
                <Stack
                  key={prediction.horizon}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mb: 1 }}
                >
                  <Chip size="small" label={prediction.horizon.replace('_', ' ')} />
                  <Chip
                    size="small"
                    color={
                      prediction.direction === 'UP'
                        ? 'success'
                        : prediction.direction === 'DOWN'
                          ? 'error'
                          : 'default'
                    }
                    label={prediction.direction}
                  />
                  <Typography variant="body2">
                    {prediction.confidence}% | move {prediction.expectedMove}%
                  </Typography>
                </Stack>
              ))}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Market Depth
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Bid Qty</TableCell>
                    <TableCell>Bid</TableCell>
                    <TableCell>Ask</TableCell>
                    <TableCell>Ask Qty</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {depth?.bids.map((bid, i) => (
                    <TableRow key={bid.price}>
                      <TableCell>{bid.quantity.toLocaleString('en-IN')}</TableCell>
                      <TableCell sx={{ color: 'success.main' }}>{bid.price}</TableCell>
                      <TableCell sx={{ color: 'error.main' }}>
                        {depth.asks[i]?.price ?? '-'}
                      </TableCell>
                      <TableCell>
                        {depth.asks[i]?.quantity.toLocaleString('en-IN') ?? '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Pattern Buy / Sell dates
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                Each row is a named setup that printed on this stock, the date it confirmed, and
                what price did over the next 5 / 10 / 20 sessions.
              </Typography>
              {events.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {sessionCount < 40
                    ? 'Need at least 40 daily bars before pattern dates can print.'
                    : 'No named chart-pattern repeats on this history yet.'}
                </Typography>
              )}
              {events.length > 0 && (
                <Table size="small" data-testid="pattern-events">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Pattern</TableCell>
                      <TableCell align="right">Price (₹)</TableCell>
                      <TableCell align="right">5d</TableCell>
                      <TableCell align="right">10d</TableCell>
                      <TableCell align="right">20d</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {events.map((row, index) => (
                      <TableRow key={eventKey(row, index)}>
                        <TableCell>{fmtDate(row.confirmedAt)}</TableCell>
                        <TableCell>
                          <SignalBadge signal={row.action} />
                        </TableCell>
                        <TableCell>{row.pattern.replaceAll('_', ' ')}</TableCell>
                        <TableCell align="right">{fmtPrice(row.price)}</TableCell>
                        <TableCell align="right">{fmtPct(row.return5)}</TableCell>
                        <TableCell align="right">{fmtPct(row.return10)}</TableCell>
                        <TableCell align="right">{fmtPct(row.return20)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
