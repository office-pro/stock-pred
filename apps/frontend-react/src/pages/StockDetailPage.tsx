import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Grid,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import CandleChart, { ChartSignalMarker } from '../components/CandleChart';
import ChangeCell from '../components/ChangeCell';
import SignalBadge from '../components/SignalBadge';
import {
  useGetCandlesQuery,
  useGetCompareQuery,
  useGetDepthQuery,
  useGetIndexCandlesQuery,
  useGetPredictionsQuery,
  useGetStockQuery,
  useGetSupportResistanceQuery,
  useGetSymbolPatternsQuery,
  useGetSymbolSignalsQuery,
} from '../store/api';

const BENCHMARK = 'NIFTY_MIDCAP_100';

export default function StockDetailPage(): JSX.Element {
  const { symbol = '' } = useParams();
  const upper = symbol.toUpperCase();
  const [compareMode, setCompareMode] = useState(false);

  const { data: stock } = useGetStockQuery(upper, { pollingInterval: 10_000 });
  const { data: candles, isLoading } = useGetCandlesQuery({ symbol: upper, limit: 250 });
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
    { index: BENCHMARK, limit: 250 },
    { skip: !compareMode },
  );

  const markers = useMemo<ChartSignalMarker[]>(() => {
    if (!signals) return [];
    return signals.history
      .slice(0, 20)
      .map((row) => ({
        time: new Date(row.createdAt).getTime(),
        signal: row.signal,
        text: `${row.signal} ${row.confidence}`,
      }))
      .reverse();
  }, [signals]);

  const current = signals?.current;

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>
          {upper}
        </Typography>
        {stock && (
          <>
            <Typography variant="h6">{stock.price.toLocaleString('en-IN')}</Typography>
            <ChangeCell value={stock.changePercent} />
            <Chip size="small" label={stock.exchange} />
            <Chip size="small" label={stock.sector} variant="outlined" />
          </>
        )}
        {current && <SignalBadge signal={current.type} />}
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={
            <Switch checked={compareMode} onChange={(e) => setCompareMode(e.target.checked)} />
          }
          label="Compare vs Nifty Midcap"
        />
      </Stack>

      {compareMode && comparison && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Relative strength vs {BENCHMARK}: <b>{comparison.relativeStrength}</b> | relative
          performance: <b>{comparison.relativePerformancePercent}%</b> over {comparison.windowDays}{' '}
          sessions.
        </Alert>
      )}

      {isLoading && <Skeleton variant="rounded" height={480} />}
      {candles && candles.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <CandleChart
              candles={candles}
              supportResistance={sr ?? null}
              target={current?.target ?? null}
              stopLoss={current?.stopLoss ?? null}
              markers={markers}
              comparison={
                compareMode && benchmarkCandles
                  ? { name: 'Nifty Midcap 100', candles: benchmarkCandles }
                  : null
              }
            />
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2}>
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
                Detected Patterns
              </Typography>
              {patterns && patterns.history.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No confirmed patterns recently.
                </Typography>
              )}
              {patterns?.history.slice(0, 6).map((pattern) => (
                <Stack
                  key={pattern.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ mb: 1 }}
                >
                  <Chip
                    size="small"
                    color={pattern.direction === 'bullish' ? 'success' : 'error'}
                    label={pattern.pattern.replaceAll('_', ' ')}
                  />
                  <Typography variant="body2">{pattern.confidence}%</Typography>
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
      </Grid>
    </>
  );
}
