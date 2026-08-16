import { Button } from '@mui/material';
import type { MouseEvent } from 'react';
import type { StockQuote } from '@stockpred/shared-types';
import { authErrorMessage } from '../lib/auth-errors';
import { useExecuteTradeMutation } from '../store/api';

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
  const price = (stock.entry && stock.entry > 0 ? stock.entry : stock.price) || 0;
  if (price <= 0) return null;
  const quantity = Math.max(1, Math.round(stock.quantity || 1));

  const onClick = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation();
    try {
      await executeTrade({
        symbol: stock.symbol,
        side: 'BUY',
        quantity,
        price,
        target: stock.target ?? undefined,
        stopLoss: stock.stopLoss ?? undefined,
      }).unwrap();
      onResult?.(
        `Paper bought ${quantity} ${stock.symbol} at ₹${price.toLocaleString('en-IN')}. Open Paper book to see the lot.`,
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
