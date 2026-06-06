import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { BrokerStatus } from '../components/BrokerStatus';
import { useAppSelector } from '../store';
import {
  useGetBrokerFundsQuery,
  useGetBrokerProfileQuery,
  useGetPortfolioQuery,
  useGetTradesQuery,
} from '../store/api';

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Grid item xs={6} sm={4} md={2}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="overline" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}

export default function PortfolioPage(): JSX.Element {
  const navigate = useNavigate();
  const loggedIn = useAppSelector((state) => Boolean(state.auth.accessToken));
  const { data: portfolio } = useGetPortfolioQuery(undefined, {
    pollingInterval: 10_000,
    skip: !loggedIn,
  });
  const { data: trades } = useGetTradesQuery(undefined, {
    pollingInterval: 15_000,
    skip: !loggedIn,
  });
  const { data: brokerProfile } = useGetBrokerProfileQuery(undefined, {
    skip: !loggedIn,
  });
  const { data: brokerFunds } = useGetBrokerFundsQuery(undefined, {
    pollingInterval: 10_000,
    skip: !loggedIn,
  });

  if (!loggedIn) {
    return <Alert severity="info">Login to view the paper-trading portfolio.</Alert>;
  }

  const inr = (value: number): string =>
    value.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Portfolio{' '}
          {portfolio && (
            <Chip
              size="small"
              label={portfolio.mode}
              color={portfolio.mode === 'PAPER' ? 'info' : 'warning'}
            />
          )}
        </Typography>
        <Button variant="outlined" size="small" onClick={() => navigate('/broker-config')}>
          Broker Settings
        </Button>
      </Box>

      {brokerProfile && (
        <BrokerStatus
          brokerType={brokerProfile.brokerType}
          isConnected={true}
          accountId={brokerProfile.accountId}
          availableCash={brokerFunds?.availableCash}
          marginMultiplier={brokerFunds?.marginMultiplier}
          usedMargin={brokerFunds?.usedMargin}
        />
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
          <Metric label="Open Positions" value={String(portfolio.openPositions)} />
          <Metric label="Realized PnL" value={inr(portfolio.realizedPnl)} />
          <Metric label="Unrealized PnL" value={inr(portfolio.unrealizedPnl)} />
          <Metric label="Capital" value={inr(portfolio.capital)} />
        </Grid>
      )}
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
                  }}
                >
                  {trade.pnl ?? '-'}
                </TableCell>
                <TableCell>{trade.status}</TableCell>
                <TableCell>{trade.exitReason ?? '-'}</TableCell>
              </TableRow>
            ))}
            {trades && trades.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography variant="body2" color="text.secondary">
                    No trades yet - the auto-trader opens paper positions when the strict confidence
                    gates align.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
