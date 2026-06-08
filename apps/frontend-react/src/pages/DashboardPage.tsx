import { Alert, Skeleton, Typography, Pagination, Box } from '@mui/material';
import { useMemo, useState } from 'react';
import IndexCards from '../components/IndexCards';
import StockTable from '../components/StockTable';
import { useGetStocksQuery } from '../store/api';

export default function DashboardPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const limit = 50;

  const {
    data: paginatedData,
    isLoading,
    isError,
  } = useGetStocksQuery(
    { page, limit },
    {
      pollingInterval: 10_000,
    },
  );

  const stocks = paginatedData?.data ?? [];
  const totalPages = paginatedData ? Math.ceil(paginatedData.total / limit) : 1;

  // Data provenance: surface anything that is not real market data.
  const provenance = useMemo(() => {
    if (!stocks || stocks.length === 0) return null;
    const simulated = stocks.filter((s) => s.dataSource === 'simulated').length;
    const cached = stocks.filter((s) => s.dataSource === 'cached').length;
    return { simulated, cached, total: stocks.length };
  }, [stocks]);

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        Market Dashboard ({paginatedData?.total ?? 0} stocks)
      </Typography>
      <IndexCards />
      {provenance && provenance.simulated > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {provenance.simulated} of {provenance.total} symbols on this page are showing SIMULATED
          data (no live feed and no cached real data). Signals and predictions for these symbols are
          not based on real prices.
        </Alert>
      )}
      {provenance && provenance.simulated === 0 && provenance.cached > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Offline mode: {provenance.cached} of {provenance.total} symbols on this page are served
          from the cache of real market data (last sync shown per row).
        </Alert>
      )}
      {isLoading && <Skeleton variant="rounded" height={400} />}
      {isError && (
        <Alert severity="error">
          Market data is unavailable. Check that the platform services are running (`npm run
          start:all`).
        </Alert>
      )}
      {stocks && stocks.length > 0 && <StockTable stocks={stocks} />}

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination count={totalPages} page={page} onChange={handlePageChange} color="primary" />
        </Box>
      )}

      {stocks && stocks.length > 0 && (
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Showing {stocks.length} of {paginatedData?.total ?? 0} stocks. Page {page} of{' '}
            {totalPages}
          </Typography>
        </Box>
      )}
    </>
  );
}
