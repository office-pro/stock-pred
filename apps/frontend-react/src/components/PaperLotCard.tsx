import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { PaperHolding } from '@stockpred/shared-types';
import { authErrorMessage } from '../lib/auth-errors';
import { useExecuteTradeMutation } from '../store/api';

function inr(value: number, digits = 2): string {
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function signedInr(value: number): string {
  const abs = inr(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

function signedPct(value: number): string {
  const abs = `${Math.abs(value).toFixed(2)}%`;
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

function lotStats(lot: PaperHolding): {
  invested: number;
  marketValue: number;
  pnl: number;
  pct: number;
  perShare: number;
} {
  const invested = lot.invested ?? lot.quantity * lot.entryPrice;
  const marketValue = lot.marketValue ?? lot.quantity * lot.currentPrice;
  const pnl = lot.unrealizedPnl;
  const pct = lot.unrealizedPnlPercent ?? (invested > 0 ? (pnl / invested) * 100 : 0);
  return {
    invested,
    marketValue,
    pnl,
    pct,
    perShare: lot.currentPrice - lot.entryPrice,
  };
}

export default function PaperLotCard({
  lot,
  cash,
  onResult,
}: {
  lot: PaperHolding;
  cash: number;
  onResult: (message: string, severity: 'success' | 'error' | 'info') => void;
}): JSX.Element {
  const [executeTrade, { isLoading }] = useExecuteTradeMutation();
  const [action, setAction] = useState<'buy' | 'sell' | null>(null);
  const [qty, setQty] = useState('1');
  const stats = lotStats(lot);
  const pnlColor = stats.pnl > 0 ? 'success.main' : stats.pnl < 0 ? 'error.main' : 'text.primary';
  const grew = stats.pnl >= 0;
  const parsedQty = Math.max(1, Math.round(Number(qty) || 1));
  const buyCost = parsedQty * lot.currentPrice;
  const sellQty = Math.min(parsedQty, lot.quantity);
  const sellProceeds = sellQty * lot.currentPrice;
  const sellPnl = (lot.currentPrice - lot.entryPrice) * sellQty;
  const maxBuy = lot.currentPrice > 0 ? Math.max(1, Math.floor(cash / lot.currentPrice)) : 1;
  const targetGapPct =
    lot.currentPrice > 0 ? ((lot.target - lot.currentPrice) / lot.currentPrice) * 100 : 0;
  const stopGapPct =
    lot.currentPrice > 0 ? ((lot.currentPrice - lot.stopLoss) / lot.currentPrice) * 100 : 0;

  const closeDialog = (): void => setAction(null);

  const openBuy = (): void => {
    setQty('1');
    setAction('buy');
  };

  const openSell = (): void => {
    setQty(String(lot.quantity));
    setAction('sell');
  };

  const submit = async (): Promise<void> => {
    try {
      if (action === 'buy') {
        await executeTrade({
          symbol: lot.symbol,
          side: 'BUY',
          quantity: parsedQty,
          price: lot.currentPrice,
        }).unwrap();
        onResult(
          `Bought ${parsedQty} more ${lot.symbol} at ${inr(lot.currentPrice)}. Average entry updates on this lot.`,
          'success',
        );
      } else if (action === 'sell') {
        await executeTrade({
          symbol: lot.symbol,
          side: 'SELL',
          quantity: sellQty,
          price: lot.currentPrice,
        }).unwrap();
        onResult(
          sellQty >= lot.quantity
            ? `Sold all ${lot.quantity} ${lot.symbol} at ${inr(lot.currentPrice)}. ${grew ? 'Gain' : 'Result'}: ${signedInr(sellPnl)}.`
            : `Sold ${sellQty} ${lot.symbol} at ${inr(lot.currentPrice)}. ${grew ? 'Gain' : 'Result'}: ${signedInr(sellPnl)}. ${lot.quantity - sellQty} still open.`,
          'success',
        );
      }
      closeDialog();
    } catch (error) {
      onResult(
        authErrorMessage(
          error,
          `Could not ${action === 'buy' ? 'buy more' : 'sell'} ${lot.symbol}.`,
        ),
        'error',
      );
    }
  };

  return (
    <>
      <Card variant="outlined" data-testid={`paper-lot-${lot.symbol}`}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1 }}>
            <Box>
              <Button
                component={RouterLink}
                to={`/stocks/${lot.symbol}`}
                size="small"
                sx={{ px: 0 }}
              >
                {lot.symbol}
              </Button>
              <Typography variant="body2" color="text.secondary">
                {lot.quantity} share{lot.quantity === 1 ? '' : 's'}
                {lot.openedAt ? ` · opened ${new Date(lot.openedAt).toLocaleString()}` : ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Button
                size="small"
                variant="outlined"
                color="success"
                disabled={isLoading}
                onClick={openBuy}
              >
                Buy more
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                disabled={isLoading}
                onClick={openSell}
              >
                Sell
              </Button>
            </Box>
          </Box>

          <Typography
            variant="h5"
            sx={{ fontWeight: 700, color: pnlColor, fontVariantNumeric: 'tabular-nums' }}
          >
            {grew ? 'Grown ' : 'Down '}
            {signedInr(stats.pnl)}{' '}
            <Typography component="span" variant="h6" color={pnlColor}>
              ({signedPct(stats.pct)})
            </Typography>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {signedInr(stats.perShare)} per share vs your average buy
          </Typography>

          <Grid container spacing={1}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Invested
              </Typography>
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {inr(stats.invested, 0)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Now worth
              </Typography>
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {inr(stats.marketValue, 0)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Avg buy
              </Typography>
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {inr(lot.entryPrice)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Last price
              </Typography>
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {inr(lot.currentPrice)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Target
              </Typography>
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {inr(lot.target)} ({signedPct(targetGapPct)} away)
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Stop
              </Typography>
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {inr(lot.stopLoss)} ({signedPct(stopGapPct)} from last)
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Dialog open={action !== null} onClose={closeDialog} fullWidth maxWidth="xs">
        <DialogTitle>
          {action === 'buy' ? `Buy more ${lot.symbol}` : `Sell ${lot.symbol}`}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {action === 'buy'
              ? `Cash available ${inr(cash, 0)}. Last ${inr(lot.currentPrice)}. This adds to the same lot and averages your buy price.`
              : `You hold ${lot.quantity}. Selling books paper P&L at last ${inr(lot.currentPrice)}. Sell all or part.`}
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Quantity"
            type="number"
            fullWidth
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            inputProps={{ min: 1, max: action === 'sell' ? lot.quantity : maxBuy, step: 1 }}
          />
          {action === 'buy' && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Cost about {inr(buyCost, 0)}
              {buyCost > cash ? ' — not enough cash' : ''}
            </Typography>
          )}
          {action === 'sell' && (
            <Typography
              variant="body2"
              sx={{ mt: 1, color: sellPnl >= 0 ? 'success.main' : 'error.main' }}
            >
              Proceeds about {inr(sellProceeds, 0)}. Estimated {sellPnl >= 0 ? 'gain' : 'loss'}{' '}
              {signedInr(sellPnl)} (
              {signedPct(lot.entryPrice > 0 ? (sellPnl / (lot.entryPrice * sellQty)) * 100 : 0)}
              ).
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          {action === 'sell' && parsedQty !== lot.quantity && (
            <Button onClick={() => setQty(String(lot.quantity))}>Sell all</Button>
          )}
          <Button
            variant="contained"
            color={action === 'buy' ? 'success' : 'error'}
            disabled={
              isLoading ||
              parsedQty < 1 ||
              (action === 'buy' && buyCost > cash) ||
              (action === 'sell' && sellQty < 1)
            }
            onClick={() => void submit()}
          >
            {isLoading ? 'Working…' : action === 'buy' ? 'Buy more' : 'Sell'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
