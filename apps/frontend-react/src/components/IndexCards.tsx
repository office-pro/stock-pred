import { Card, CardContent, Grid, Skeleton, Typography } from '@mui/material';
import { useGetIndicesQuery } from '../store/api';
import { useAppSelector } from '../store';
import ChangeCell from './ChangeCell';

export default function IndexCards(): JSX.Element {
  const { data: indices, isLoading } = useGetIndicesQuery(undefined, { pollingInterval: 15_000 });
  const ticks = useAppSelector((state) => state.live.ticks);

  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      {(indices ?? Array.from({ length: 4 })).map((index, i) => {
        if (isLoading || !index) {
          return (
            <Grid item xs={12} sm={6} md={3} key={i}>
              <Skeleton variant="rounded" height={88} />
            </Grid>
          );
        }
        const quote = index as NonNullable<typeof index>;
        const liveTick = ticks[quote.index];
        const value = liveTick ? liveTick.price : quote.value;
        return (
          <Grid item xs={12} sm={6} md={3} key={quote.index}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  {quote.name}
                </Typography>
                <Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </Typography>
                <ChangeCell value={quote.changePercent} />
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}
