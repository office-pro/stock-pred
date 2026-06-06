import { Chip } from '@mui/material';

export default function SignalBadge({ signal }: { signal: 'BUY' | 'SELL' | 'HOLD' }): JSX.Element {
  const color = signal === 'BUY' ? 'success' : signal === 'SELL' ? 'error' : 'default';
  return <Chip size="small" label={signal} color={color} data-testid={`signal-${signal}`} />;
}
