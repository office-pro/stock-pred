import {
  Chip,
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
import type { StockQuote } from '@stockpred/shared-types';
import { useAppSelector } from '../store';
import ChangeCell from './ChangeCell';
import SignalBadge from './SignalBadge';

function fmtPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value <= 0) return '-';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtVolume(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return Math.round(value).toLocaleString('en-IN');
}

/** Compact market table with AI advisory levels. */
export default function StockTable({ stocks }: { stocks: StockQuote[] }): JSX.Element {
  const navigate = useNavigate();
  const ticks = useAppSelector((state) => state.live.ticks);

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" data-testid="stock-table">
        <TableHead>
          <TableRow>
            <TableCell>Stock</TableCell>
            <TableCell>Exchange</TableCell>
            <TableCell align="right">Price (₹)</TableCell>
            <TableCell align="right">Change %</TableCell>
            <TableCell align="right">Volume</TableCell>
            <TableCell align="center">Action</TableCell>
            <TableCell align="right">Buy/Sell at</TableCell>
            <TableCell align="right">Target</TableCell>
            <TableCell align="right">Stop</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell align="right">Conf</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {stocks.map((stock) => {
            const tick = ticks[stock.symbol];
            const price = tick ? tick.price : stock.price;
            const hasPrice = price > 0;
            const changePercent =
              stock.previousClose > 0
                ? ((price - stock.previousClose) / stock.previousClose) * 100
                : stock.changePercent;
            return (
              <TableRow
                key={`${stock.exchange}-${stock.symbol}`}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/stocks/${stock.symbol}`)}
              >
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {stock.symbol}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {stock.name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={stock.exchange}
                    color={stock.exchange === 'NSE' ? 'primary' : 'secondary'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" fontWeight={600}>
                    {fmtPrice(price)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {hasPrice ? <ChangeCell value={changePercent} /> : '-'}
                </TableCell>
                <TableCell align="right">{hasPrice ? fmtVolume(stock.volume) : '-'}</TableCell>
                <TableCell align="center">
                  <SignalBadge signal={stock.suggestion ?? 'HOLD'} />
                </TableCell>
                <TableCell align="right">{fmtPrice(stock.entry)}</TableCell>
                <TableCell align="right">{fmtPrice(stock.target)}</TableCell>
                <TableCell align="right">{fmtPrice(stock.stopLoss)}</TableCell>
                <TableCell align="right">
                  {stock.quantity ? stock.quantity.toLocaleString('en-IN') : '-'}
                </TableCell>
                <TableCell align="right">
                  {stock.confidence ? `${stock.confidence.toFixed(0)}%` : '-'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
