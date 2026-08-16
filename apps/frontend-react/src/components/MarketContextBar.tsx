import { Card, CardContent, Grid, Skeleton, Typography } from '@mui/material';
import type { MarketContext } from '@stockpred/shared-types';
import { useGetMarketContextQuery } from '../store/api';

export default function MarketContextBar({ context }: { context?: MarketContext }): JSX.Element {
  const { data, isLoading } = useGetMarketContextQuery(undefined, {
    pollingInterval: 30_000,
    skip: Boolean(context),
  });
  const snapshot = context ?? data;
  if (isLoading && !snapshot) {
    return <Skeleton variant="rounded" height={72} sx={{ mb: 2 }} />;
  }
  if (!snapshot) return <></>;
  const items = [
    { label: 'Regime', value: snapshot.regime.replace('_', ' ') },
    {
      label: 'NIFTY 50',
      value: `${snapshot.niftyChangePercent >= 0 ? '+' : ''}${snapshot.niftyChangePercent}%`,
    },
    {
      label: 'Advance / Decline',
      value: `${snapshot.breadth.advancing} / ${snapshot.breadth.declining}`,
    },
    { label: '% above EMA50', value: `${snapshot.breadth.percentAboveEma50}%` },
    { label: '% above EMA200', value: `${snapshot.breadth.percentAboveEma200}%` },
    {
      label: '52w high / low',
      value: `${snapshot.breadth.newHighs52w} / ${snapshot.breadth.newLows52w}`,
    },
    { label: 'Participation', value: snapshot.breadth.participation },
    { label: 'India VIX', value: snapshot.vixLevel === null ? '—' : String(snapshot.vixLevel) },
  ];
  return (
    <Grid container spacing={1} sx={{ mb: 2 }}>
      {items.map((item) => (
        <Grid item xs={6} sm={3} md={1.5} key={item.label}>
          <Card variant="outlined">
            <CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}>
              <Typography variant="caption" color="text.secondary">
                {item.label}
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
              >
                {item.value}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
