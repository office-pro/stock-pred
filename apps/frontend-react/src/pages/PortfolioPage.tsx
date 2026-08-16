import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PaperLotCard from '../components/PaperLotCard';
import { useAppSelector } from '../store';
import { useGetPortfolioQuery, useGetTradesQuery } from '../store/api';

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): JSX.Element {
  return (
    <Grid item xs={6} sm={4} md={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="overline" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums', color }}>
            {value}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

function inr(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function PortfolioPage(): JSX.Element {
  const navigate = useNavigate();
  const loggedIn = useAppSelector((state) => Boolean(state.auth.accessToken));
  const [toast, setToast] = useState<{
    text: string;
    severity: 'success' | 'error' | 'info';
  } | null>(null);
  const {
    data: portfolio,
    isError,
    error,
  } = useGetPortfolioQuery(undefined, {
    pollingInterval: 10_000,
  });
  const { data: trades } = useGetTradesQuery(undefined, {
    pollingInterval: 15_000,
  });

  const errorStatus =
    error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;

  const holdings = portfolio?.holdings ?? [];

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Paper book{' '}
          {portfolio && (
            <Chip
              size="small"
              label={portfolio.mode}
              color={portfolio.mode === 'PAPER' ? 'info' : 'warning'}
            />
          )}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" size="small" onClick={() => navigate('/?tab=alerts')}>
            Buy from Alerts
          </Button>
          <Button variant="outlined" size="small" onClick={() => navigate('/broker-config')}>
            Broker Settings
          </Button>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Virtual ₹{inr(portfolio?.capital ?? 1_000_000)} starting cash. Each open lot shows how much
        it grew or lost versus your average buy. Use <b>Buy more</b> or <b>Sell</b> on a lot, or
        Paper Buy from Dashboard → Alerts. No live broker. This is not investment advice.
      </Alert>

      {!loggedIn && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can view this paper book without a broker. Log in as trader@stockpred.local to click
          Paper Buy on Alerts.
        </Alert>
      )}

      {isError && errorStatus === 401 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Session expired. Log in again, then Paper Buy will work. The paper book itself does not
          need a broker.
        </Alert>
      )}
      {isError && errorStatus === 502 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Paper book service is down. Start auto-trader on :3006.
        </Alert>
      )}
      {isError && errorStatus !== 401 && errorStatus !== 502 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the paper book{errorStatus ? ` (status ${errorStatus})` : ''}.
        </Alert>
      )}

      {portfolio?.circuitBreakerTripped && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Circuit breaker is active - automated trading is suspended until limits reset.
        </Alert>
      )}

      {portfolio && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Metric label="Equity" value={inr(portfolio.equity)} />
          <Metric label="Cash" value={inr(portfolio.cash)} />
          <Metric label="Open lots" value={String(portfolio.openPositions)} />
          <Metric
            label="Realized PnL"
            value={inr(portfolio.realizedPnl)}
            color={
              portfolio.realizedPnl > 0
                ? 'success.main'
                : portfolio.realizedPnl < 0
                  ? 'error.main'
                  : undefined
            }
          />
          <Metric
            label="Unrealized PnL"
            value={inr(portfolio.unrealizedPnl)}
            color={
              portfolio.unrealizedPnl > 0
                ? 'success.main'
                : portfolio.unrealizedPnl < 0
                  ? 'error.main'
                  : undefined
            }
          />
          <Metric label="Capital" value={inr(portfolio.capital)} />
        </Grid>
      )}

      <Typography variant="h6" sx={{ mb: 1, fontWeight: 700 }}>
        Open lots
      </Typography>
      {holdings.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            No open paper lots. Go to Dashboard → Alerts and click Paper Buy.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2} sx={{ mb: 3 }}>
          {holdings.map((lot) => (
            <PaperLotCard
              key={lot.symbol}
              lot={lot}
              cash={portfolio?.cash ?? 0}
              onResult={(text, severity) => setToast({ text, severity })}
            />
          ))}
        </Stack>
      )}

      <Typography variant="h6" sx={{ mb: 1, fontWeight: 700 }}>
        Trade tickets
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Symbol</TableCell>
              <TableCell>Side</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="right">Exit</TableCell>
              <TableCell align="right">PnL</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(trades ?? []).map((trade) => (
              <TableRow key={trade.id}>
                <TableCell>{new Date(trade.executedAt).toLocaleString()}</TableCell>
                <TableCell>{trade.symbol}</TableCell>
                <TableCell>{trade.side}</TableCell>
                <TableCell align="right">{trade.quantity}</TableCell>
                <TableCell align="right">{trade.price}</TableCell>
                <TableCell align="right">{trade.exitPrice ?? '-'}</TableCell>
                <TableCell
                  align="right"
                  sx={{
                    color:
                      trade.pnl == null
                        ? 'text.secondary'
                        : trade.pnl >= 0
                          ? 'success.main'
                          : 'error.main',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {trade.pnl == null
                    ? '-'
                    : `${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      })}`}
                </TableCell>
                <TableCell>{trade.status}</TableCell>
                <TableCell>{trade.exitReason ?? '-'}</TableCell>
              </TableRow>
            ))}
            {trades && trades.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography variant="body2" color="text.secondary">
                    No tickets yet. Paper Buy from Alerts writes a ticket here.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setToast(null)}
          severity={toast?.severity ?? 'info'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toast?.text}
        </Alert>
      </Snackbar>
    </>
  );
}
