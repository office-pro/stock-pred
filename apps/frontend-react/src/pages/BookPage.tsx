import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import PaperLotCard from '../components/PaperLotCard';
import { useAppSelector } from '../store';
import {
  useGetAgentPositionsQuery,
  useGetAgentTransactionsQuery,
  useGetPortfolioQuery,
  useGetTradesQuery,
} from '../store/api';

function SummaryTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): JSX.Element {
  return (
    <Grid item xs={6} md={3}>
      <Card variant="outlined">
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="caption" color="text.secondary">
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

/**
 * Book — agent positions/transactions primary; classic paper tertiary.
 */
export default function BookPage(): JSX.Element {
  const [tab, setTab] = useState(0);
  const navigate = useNavigate();
  const loggedIn = useAppSelector((state) => Boolean(state.auth.accessToken));

  const { data: positions } = useGetAgentPositionsQuery(undefined, { pollingInterval: 10_000 });
  const { data: txAudit } = useGetAgentTransactionsQuery(
    { limit: 50 },
    { pollingInterval: 15_000 },
  );
  const { data: portfolio } = useGetPortfolioQuery(undefined, {
    pollingInterval: 10_000,
    skip: tab !== 2,
  });
  const { data: trades } = useGetTradesQuery(undefined, {
    pollingInterval: 15_000,
    skip: tab !== 2,
  });

  const lots = positions?.positions ?? [];
  const summary = useMemo(() => {
    const count = lots.length;
    let marketValue = 0;
    let unrealized = 0;
    for (const lot of lots) {
      marketValue += Number(lot.currentPrice) * Number(lot.quantity);
      unrealized += Number(lot.unrealizedPnl) || 0;
    }
    const cost = lots.reduce((s, lot) => s + Number(lot.entryPrice) * Number(lot.quantity), 0);
    const unrealizedPct = cost > 0 ? (unrealized / cost) * 100 : null;
    const realizedFromTx = (txAudit?.transactions ?? []).reduce((s, tx) => {
      if (tx.pnl == null) return s;
      return s + Number(tx.pnl);
    }, 0);
    const hasRealized = (txAudit?.transactions ?? []).some((tx) => tx.pnl != null);
    return { count, marketValue, unrealized, unrealizedPct, realizedFromTx, hasRealized };
  }, [lots, txAudit]);

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        sx={{ mb: 2 }}
        spacing={1}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Book
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Agent paper book — decisions stay on Desk.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" size="small" component={RouterLink} to="/agent">
            Open Desk
          </Button>
          <Button variant="outlined" size="small" onClick={() => navigate('/broker-config')}>
            Brokers
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <SummaryTile label="Positions" value={String(summary.count)} />
        <SummaryTile
          label="Mark value"
          value={
            summary.count
              ? `₹${summary.marketValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
              : 'Not available'
          }
        />
        <SummaryTile
          label="Unrealized PnL"
          value={
            summary.count
              ? `${summary.unrealized >= 0 ? '+' : ''}₹${summary.unrealized.toLocaleString(
                  'en-IN',
                  {
                    maximumFractionDigits: 0,
                  },
                )}${
                  summary.unrealizedPct != null
                    ? ` (${summary.unrealizedPct >= 0 ? '+' : ''}${summary.unrealizedPct.toFixed(2)}%)`
                    : ''
                }`
              : 'Not available'
          }
          color={
            summary.unrealized > 0
              ? 'success.main'
              : summary.unrealized < 0
                ? 'error.main'
                : undefined
          }
        />
        <SummaryTile
          label="Realized (tx sample)"
          value={
            summary.hasRealized
              ? `${summary.realizedFromTx >= 0 ? '+' : ''}₹${summary.realizedFromTx.toLocaleString(
                  'en-IN',
                  { maximumFractionDigits: 0 },
                )}`
              : 'Not available'
          }
        />
      </Grid>

      <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Agent Positions" />
        <Tab label="Agent Transactions" />
        <Tab label="Classic Paper" />
      </Tabs>

      {tab === 0 && (
        <>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Exit Intelligence is advisory; exit authority remains the existing policy path.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Symbol</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Avg</TableCell>
                  <TableCell align="right">LTP</TableCell>
                  <TableCell align="right">PnL</TableCell>
                  <TableCell>Exit intel</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lots.map((lot) => (
                  <TableRow key={`${lot.bookKey ?? 'sys'}-${lot.symbol}`}>
                    <TableCell>
                      <Typography
                        component={RouterLink}
                        to={`/stocks/${lot.symbol}`}
                        fontWeight={700}
                        sx={{ textDecoration: 'none' }}
                      >
                        {lot.symbol}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{lot.quantity}</TableCell>
                    <TableCell align="right">₹{lot.entryPrice}</TableCell>
                    <TableCell align="right">₹{lot.currentPrice}</TableCell>
                    <TableCell align="right">{lot.unrealizedPnl}</TableCell>
                    <TableCell>
                      {lot.exitIntelligence ? (
                        <>
                          <Chip size="small" label={lot.exitIntelligence.action} />
                          <Typography variant="caption" display="block" color="text.secondary">
                            {lot.exitIntelligence.summary}
                          </Typography>
                        </>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Not available
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {lots.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography color="text.secondary" sx={{ py: 2 }}>
                        No agent lots. Approve a BUY on Desk.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {tab === 1 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Symbol</TableCell>
                <TableCell>Side</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">PnL</TableCell>
                <TableCell>Why</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(txAudit?.transactions ?? []).map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>
                    <Typography variant="caption">
                      {new Date(tx.timestamp).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>{tx.symbol}</TableCell>
                  <TableCell>
                    <Chip size="small" label={tx.side} />
                  </TableCell>
                  <TableCell align="right">{tx.quantity}</TableCell>
                  <TableCell align="right">₹{tx.price}</TableCell>
                  <TableCell align="right">{tx.pnl ?? '—'}</TableCell>
                  <TableCell>
                    <Typography variant="caption">{tx.reason}</Typography>
                  </TableCell>
                </TableRow>
              ))}
              {(txAudit?.transactions ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography color="text.secondary" sx={{ py: 2 }}>
                      No agent transactions yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === 2 && (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            Classic paper (manual path). Agent evidence path is Desk Approve → Agent Positions.
          </Alert>
          {!loggedIn ? (
            <Alert severity="warning">Log in to view classic paper book.</Alert>
          ) : (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Cash ₹{Number(portfolio?.cash ?? 0).toLocaleString('en-IN')} · Equity ₹
                {Number(portfolio?.equity ?? 0).toLocaleString('en-IN')}
              </Typography>
              <Stack spacing={1} sx={{ mb: 2 }}>
                {(portfolio?.holdings ?? []).map((lot) => (
                  <PaperLotCard
                    key={lot.symbol}
                    lot={lot}
                    cash={portfolio?.cash ?? 0}
                    onResult={() => undefined}
                  />
                ))}
                {(portfolio?.holdings ?? []).length === 0 && (
                  <Typography color="text.secondary">No classic paper holdings.</Typography>
                )}
              </Stack>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Symbol</TableCell>
                      <TableCell>Side</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Price</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(trades ?? []).slice(0, 30).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.symbol}</TableCell>
                        <TableCell>{t.side}</TableCell>
                        <TableCell align="right">{t.quantity}</TableCell>
                        <TableCell align="right">{t.price}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </>
      )}
    </Box>
  );
}
