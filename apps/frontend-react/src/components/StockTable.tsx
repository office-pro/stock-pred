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
import { useNavigate } from 'react-router-dom';
import type { StockQuote } from '@stockpred/shared-types';
import { useAppSelector } from '../store';
import ChangeCell from './ChangeCell';

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '-';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Market dashboard table: live price, volume and the spec indicator set. */
export default function StockTable({ stocks }: { stocks: StockQuote[] }): JSX.Element {
  const navigate = useNavigate();
  const ticks = useAppSelector((state) => state.live.ticks);

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" data-testid="stock-table">
        <TableHead>
          <TableRow>
            <TableCell>Symbol</TableCell>
            <TableCell align="right">Price</TableCell>
            <TableCell align="right">Chg %</TableCell>
            <TableCell align="right">Volume</TableCell>
            <TableCell align="right">VWAP</TableCell>
            <TableCell align="right">RSI</TableCell>
            <TableCell align="right">MACD</TableCell>
            <TableCell align="right">ATR</TableCell>
            <TableCell align="right">EMA20</TableCell>
            <TableCell align="right">EMA50</TableCell>
            <TableCell align="right">EMA200</TableCell>
            <TableCell align="right">BB Upper</TableCell>
            <TableCell align="right">BB Lower</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {stocks.map((stock) => {
            const tick = ticks[stock.symbol];
            const price = tick ? tick.price : stock.price;
            const changePercent =
              stock.previousClose > 0
                ? ((price - stock.previousClose) / stock.previousClose) * 100
                : stock.changePercent;
            const ind = stock.indicators;
            return (
              <TableRow
                key={stock.symbol}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/stocks/${stock.symbol}`)}
              >
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {stock.symbol}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {stock.sector}
                  </Typography>
                </TableCell>
                <TableCell align="right">{fmt(price)}</TableCell>
                <TableCell align="right">
                  <ChangeCell value={changePercent} />
                </TableCell>
                <TableCell align="right">{stock.volume.toLocaleString('en-IN')}</TableCell>
                <TableCell align="right">{fmt(ind?.vwap)}</TableCell>
                <TableCell align="right">{fmt(ind?.rsi, 1)}</TableCell>
                <TableCell align="right">{fmt(ind?.macdHistogram)}</TableCell>
                <TableCell align="right">{fmt(ind?.atr)}</TableCell>
                <TableCell align="right">{fmt(ind?.ema20)}</TableCell>
                <TableCell align="right">{fmt(ind?.ema50)}</TableCell>
                <TableCell align="right">{fmt(ind?.ema200)}</TableCell>
                <TableCell align="right">{fmt(ind?.bollingerUpper)}</TableCell>
                <TableCell align="right">{fmt(ind?.bollingerLower)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
