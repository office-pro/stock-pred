import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link } from 'react-router-dom';
import SignalBadge from '../components/SignalBadge';
import { useAppSelector } from '../store';
import { useGetSignalsQuery } from '../store/api';

export default function SignalsPage(): JSX.Element {
  const { data: signals } = useGetSignalsQuery(undefined, { pollingInterval: 15_000 });
  const liveFeed = useAppSelector((state) => state.live.signalFeed);

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        Actionable Signals
      </Typography>
      {liveFeed.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {liveFeed.length} live signal(s) received this session.
        </Typography>
      )}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Symbol</TableCell>
              <TableCell>Signal</TableCell>
              <TableCell align="right">Confidence</TableCell>
              <TableCell align="right">Price</TableCell>
              <TableCell align="right">Target</TableCell>
              <TableCell align="right">Stop Loss</TableCell>
              <TableCell align="right">R:R</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(signals ?? []).map((signal) => (
              <TableRow key={signal.id} hover>
                <TableCell>{new Date(signal.createdAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Link to={`/stocks/${signal.symbol}`} style={{ color: '#4f8cff' }}>
                    {signal.symbol}
                  </Link>
                </TableCell>
                <TableCell>
                  <SignalBadge signal={signal.signal} />
                </TableCell>
                <TableCell align="right">{signal.confidence}</TableCell>
                <TableCell align="right">{signal.price}</TableCell>
                <TableCell align="right">{signal.target}</TableCell>
                <TableCell align="right">{signal.stopLoss}</TableCell>
                <TableCell align="right">{signal.riskReward}</TableCell>
              </TableRow>
            ))}
            {signals && signals.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary">
                    No actionable signals yet - the engine emits only rule-confirmed BUY/SELL
                    setups.
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
