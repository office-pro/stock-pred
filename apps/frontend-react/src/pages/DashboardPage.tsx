import { Alert, Skeleton, Typography } from '@mui/material';
import { useMemo } from 'react';
import IndexCards from '../components/IndexCards';
import StockTable from '../components/StockTable';
import { useGetStocksQuery } from '../store/api';

export default function DashboardPage(): JSX.Element {
  const { data: stocks, isLoading, isError } = useGetStocksQuery(undefined, {
    pollingInterval: 10_000,
  });

  // Data provenance: surface anything that is not real market data.
  const provenance = useMemo(() => {
    if (!stocks) return null;
    const simulated = stocks.filter((s) => s.dataSource === 'simulated').length;
    const cached = stocks.filter((s) => s.dataSource === 'cached').length;
    return { simulated, cached, total: stocks.length };
  }, [stocks]);

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        Market Dashboard
      </Typography>
      <IndexCards />
      {provenance && provenance.simulated > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {provenance.simulated} of {provenance.total} symbols are showing SIMULATED data (no live
          feed and no cached real data). Signals and predictions for these symbols are not based on
          real prices.
        </Alert>
      )}
      {provenance && provenance.simulated === 0 && provenance.cached > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Offline mode: {provenance.cached} of {provenance.total} symbols are served from the cache
          of real market data (last sync shown per row).
        </Alert>
      )}
      {isLoading && <Skeleton variant="rounded" height={400} />}
      {isError && (
        <Alert severity="error">
          Market data is unavailable. Check that the platform services are running
          (`npm run start:all`).
        </Alert>
      )}
      {stocks && <StockTable stocks={stocks} />}
    </>
  );
}
