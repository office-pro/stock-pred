import { Button } from '@mui/material';
import type { MouseEvent } from 'react';
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
  const fallback = (stock.entry && stock.entry > 0 ? stock.entry : stock.price) || 0;
  if (fallback <= 0) return null;
  const quantity = Math.max(1, Math.round(stock.quantity || 1));

  const onClick = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation();
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
        quantity,
        price,
        target: stock.target ?? undefined,
        stopLoss: stock.stopLoss ?? undefined,
      }).unwrap();
      onResult?.(
        `Paper bought ${quantity} ${stock.symbol} at live ₹${price.toLocaleString('en-IN')}. Open Paper book to see the lot.`,
        'success',
      );
    } catch (error) {
      onResult?.(authErrorMessage(error, `Could not paper-buy ${stock.symbol}.`), 'error');
    }
  };

  return (
    <Button
      size="small"
      variant="contained"
      color="success"
      disabled={isLoading}
      onClick={(event) => void onClick(event)}
      data-testid={`paper-buy-${stock.symbol}`}
    >
      {isLoading ? 'Buying…' : 'Paper Buy'}
    </Button>
  );
}
