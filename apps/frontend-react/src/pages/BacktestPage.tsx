import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ColorType, createChart } from 'lightweight-charts';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../store';
import { useRunBacktestMutation } from '../store/api';

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}): JSX.Element {
  return (
    <Grid item xs={6} sm={4} md={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="overline" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
            {suffix ?? ''}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

export default function BacktestPage(): JSX.Element {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [years, setYears] = useState(3);
  const [runBacktest, { data: result, isLoading, error }] = useRunBacktestMutation();
  const loggedIn = useAppSelector((state) => Boolean(state.auth.accessToken));
  const equityRef = useRef<HTMLDivElement | null>(null);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void runBacktest({ symbol: symbol.toUpperCase(), years });
  };

  useEffect(() => {
    const container = equityRef.current;
    if (!container || !result) return undefined;
    const chart = createChart(container, {
      height: 280,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9aa4bb' },
      grid: {
        vertLines: { color: 'rgba(154, 164, 187, 0.08)' },
        horzLines: { color: 'rgba(154, 164, 187, 0.08)' },
      },
    });
    const series = chart.addAreaSeries({
      lineColor: '#4f8cff',
      topColor: 'rgba(79, 140, 255, 0.3)',
      bottomColor: 'rgba(79, 140, 255, 0.0)',
    });
    series.setData(
      result.equityCurve.map((point) => ({
        time: Math.floor(point.time / 1000) as never,
        value: point.equity,
      })),
    );
    chart.timeScale().fitContent();
    const onResize = (): void => chart.applyOptions({ width: container.clientWidth });
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
    };
  }, [result]);

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        Backtesting
      </Typography>
      {!loggedIn && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Login to run backtests (any registered role).
        </Alert>
      )}
      <Box component="form" onSubmit={onSubmit} sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField
          label="Symbol"
          size="small"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          inputProps={{ 'data-testid': 'backtest-symbol' }}
        />
        <TextField
          select
          label="Period"
          size="small"
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
          sx={{ width: 120 }}
        >
          {[1, 3, 5, 10].map((value) => (
            <MenuItem key={value} value={value}>
              {value} year{value > 1 ? 's' : ''}
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained" disabled={isLoading || !loggedIn}>
          {isLoading ? 'Running...' : 'Run Backtest'}
        </Button>
      </Box>

      {Boolean(error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Backtest failed - confirm you are logged in and services are up.
        </Alert>
      )}

      {result && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <MetricCard label="Win Rate" value={result.metrics.winRate} suffix="%" />
            <MetricCard label="Sharpe" value={result.metrics.sharpeRatio} />
            <MetricCard label="Sortino" value={result.metrics.sortinoRatio} />
            <MetricCard label="CAGR" value={result.metrics.cagr} suffix="%" />
            <MetricCard label="Max DD" value={result.metrics.maxDrawdown} suffix="%" />
            <MetricCard label="Profit Factor" value={result.metrics.profitFactor} />
          </Grid>
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Equity Curve ({result.metrics.totalTrades} trades,{' '}
                {result.metrics.totalReturnPercent}% total return)
              </Typography>
              <Box ref={equityRef} sx={{ width: '100%' }} />
            </CardContent>
          </Card>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Entry</TableCell>
                  <TableCell>Exit</TableCell>
                  <TableCell align="right">Entry Price</TableCell>
                  <TableCell align="right">Exit Price</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">PnL</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.trades.slice(-25).map((trade) => (
                  <TableRow key={`${trade.entryTime}-${trade.exitTime}`}>
                    <TableCell>{new Date(trade.entryTime).toLocaleDateString()}</TableCell>
                    <TableCell>{new Date(trade.exitTime).toLocaleDateString()}</TableCell>
                    <TableCell align="right">{trade.entryPrice}</TableCell>
                    <TableCell align="right">{trade.exitPrice}</TableCell>
                    <TableCell align="right">{trade.quantity}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ color: trade.pnl >= 0 ? 'success.main' : 'error.main' }}
                    >
                      {trade.pnl.toLocaleString('en-IN')}
                    </TableCell>
                    <TableCell>{trade.exitReason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </>
  );
}
