import {
  Alert,
  Chip,
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
import type { StockQuote } from '@stockpred/shared-types';
import { useAppSelector } from '../store';
import ChangeCell from './ChangeCell';
import PaperBuyButton from './PaperBuyButton';
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

function profitPct(stock: StockQuote): number | null {
  if (stock.entry != null && stock.target != null && stock.entry > 0) {
    return (Math.abs(stock.target - stock.entry) / stock.entry) * 100;
  }
  if (stock.expectedMove) return Math.abs(stock.expectedMove);
  return null;
}

/** Compact market table with AI advisory levels. */
export default function StockTable({
  stocks,
  maxProfitSymbol,
}: {
  stocks: StockQuote[];
  maxProfitSymbol?: string | null;
}): JSX.Element {
  const navigate = useNavigate();
  const ticks = useAppSelector((state) => state.live.ticks);
  const [toast, setToast] = useState<{
    text: string;
    severity: 'success' | 'error' | 'info';
  } | null>(null);

  return (
    <>
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
              <TableCell align="right">Profit %</TableCell>
              <TableCell align="right">Conf</TableCell>
              <TableCell align="center">Paper</TableCell>
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
              const expectedProfit = profitPct(stock);
              const isBull =
                stock.scanner?.band === 'BULL_RUN_CANDIDATE' ||
                stock.scanner?.band === 'STRONG_BULLISH' ||
                (stock.scanner?.bullScore ?? 0) >= 70;
              const isMaxProfit = Boolean(maxProfitSymbol) && stock.symbol === maxProfitSymbol;
              return (
                <TableRow
                  key={`${stock.exchange}-${stock.symbol}`}
                  hover
                  selected={isMaxProfit}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/stocks/${stock.symbol}`)}
                >
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" fontWeight={600}>
                        {stock.symbol}
                      </Typography>
                      {isBull && (
                        <Chip
                          size="small"
                          color="warning"
                          label={`Bull ${stock.scanner?.bullScore ?? ''}`}
                        />
                      )}
                      {isMaxProfit && <Chip size="small" color="success" label="Max profit" />}
                    </Stack>
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
                    {expectedProfit == null ? (
                      '-'
                    ) : (
                      <Typography variant="body2" fontWeight={600} color="success.main">
                        {expectedProfit.toFixed(1)}%
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {stock.confidence ? `${stock.confidence.toFixed(0)}%` : '-'}
                  </TableCell>
                  <TableCell align="center" onClick={(event) => event.stopPropagation()}>
                    <PaperBuyButton
                      stock={{ ...stock, price }}
                      onResult={(text, severity) => setToast({ text, severity })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
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
