import { Typography } from '@mui/material';

export default function ChangeCell({
  value,
  suffix = '%',
}: {
  value: number;
  suffix?: string;
}): JSX.Element {
  const color = value > 0 ? 'success.main' : value < 0 ? 'error.main' : 'text.secondary';
  const sign = value > 0 ? '+' : '';
  return (
    <Typography variant="body2" sx={{ color, fontVariantNumeric: 'tabular-nums' }}>
      {sign}
      {value.toFixed(2)}
      {suffix}
    </Typography>
  );
}
