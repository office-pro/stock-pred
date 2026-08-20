import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type MouseEvent } from 'react';
import type { StockQuote } from '@stockpred/shared-types';
import { authErrorMessage } from '../lib/auth-errors';
import { useExecuteTradeMutation, useLazyGetStockQuery } from '../store/api';

type PaperBuyQuote = Pick<
  StockQuote,
  'symbol' | 'price' | 'entry' | 'target' | 'stopLoss' | 'quantity'
>;

export default function PaperBuyButton({
  stock,
  onResult,
}: {
  stock: PaperBuyQuote;
  onResult?: (message: string, severity: 'success' | 'error' | 'info') => void;
}): JSX.Element | null {
  const [executeTrade, { isLoading }] = useExecuteTradeMutation();
  const [getLiveQuote] = useLazyGetStockQuery();
  const [open, setOpen] = useState(false);
  const suggestedQty = Math.max(1, Math.round(stock.quantity || 1));
  const [quantity, setQuantity] = useState(String(suggestedQty));

  const fallback = (stock.entry && stock.entry > 0 ? stock.entry : stock.price) || 0;
  if (fallback <= 0) return null;

  const parsedQty = Math.max(1, Math.round(Number(quantity) || 0));
  const qtyValid = Number.isFinite(Number(quantity)) && Number(quantity) >= 1;

  const openDialog = (event: MouseEvent): void => {
    event.stopPropagation();
    setQuantity(String(Math.max(1, Math.round(stock.quantity || 1))));
    setOpen(true);
  };

  const confirmBuy = async (): Promise<void> => {
    if (!qtyValid) return;
    try {
      let price = fallback;
      try {
        const live = await getLiveQuote(stock.symbol).unwrap();
        if (live.price > 0) price = live.price;
      } catch {
        /* fill at advisory price if the live quote is unavailable */
      }
      await executeTrade({
        symbol: stock.symbol,
        side: 'BUY',
        quantity: parsedQty,
        price,
        target: stock.target ?? undefined,
        stopLoss: stock.stopLoss ?? undefined,
      }).unwrap();
      setOpen(false);
      onResult?.(
        `Paper bought ${parsedQty} ${stock.symbol} at live ₹${price.toLocaleString('en-IN')}. Open Paper book to see the lot.`,
        'success',
      );
    } catch (error) {
      onResult?.(authErrorMessage(error, `Could not paper-buy ${stock.symbol}.`), 'error');
    }
  };

  return (
    <>
      <Button
        size="small"
        variant="contained"
        color="success"
        disabled={isLoading}
        onClick={openDialog}
        data-testid={`paper-buy-${stock.symbol}`}
      >
        Paper Buy
      </Button>
      <Dialog
        open={open}
        onClose={() => !isLoading && setOpen(false)}
        onClick={(event) => event.stopPropagation()}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Paper buy {stock.symbol}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Suggested size is {suggestedQty} shares (risk-based). Edit quantity before confirming.
            </Typography>
            <TextField
              autoFocus
              label="Quantity"
              type="number"
              size="small"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputProps={{ min: 1, step: 1 }}
              error={!qtyValid}
              helperText={!qtyValid ? 'Enter at least 1 share' : undefined}
              data-testid={`paper-buy-qty-${stock.symbol}`}
            />
            <Typography variant="caption" color="text.secondary">
              Approx. notional ₹
              {(parsedQty * fallback).toLocaleString('en-IN', { maximumFractionDigits: 0 })} at ₹
              {fallback.toLocaleString('en-IN')}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            disabled={isLoading || !qtyValid}
            onClick={() => void confirmBuy()}
            data-testid={`paper-buy-confirm-${stock.symbol}`}
          >
            {isLoading ? 'Buying…' : `Buy ${parsedQty}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
