import {
  Alert,
  Skeleton,
  Tab,
  Tabs,
  TextField,
  Typography,
  Pagination,
  Box,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { useMemo, useState } from 'react';
import IndexCards from '../components/IndexCards';
import StockTable from '../components/StockTable';
import { useGetPredictionAccuracyQuery, useGetStocksQuery } from '../store/api';

type ExchangeTab = 'NSE' | 'BSE';
type SuggestionFilter = 'ALL' | 'BUY' | 'SELL';
type HorizonFilter = 'NEXT_DAY' | 'NEXT_WEEK';

export default function DashboardPage(): JSX.Element {
  const [exchange, setExchange] = useState<ExchangeTab>('NSE');
  const [suggestion, setSuggestion] = useState<SuggestionFilter>('ALL');
  const [horizon, setHorizon] = useState<HorizonFilter>('NEXT_DAY');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const limit = 50;

  const {
    currentData: paginatedData,
    isLoading,
    isFetching,
    isError,
  } = useGetStocksQuery(
    {
      page,
      limit,
      search: search || undefined,
      exchange,
      suggestion: suggestion === 'ALL' ? undefined : suggestion,
      horizon,
    },
    { pollingInterval: 10_000 },
  );

  const { data: accuracy } = useGetPredictionAccuracyQuery(
    { horizon },
    { pollingInterval: 60_000 },
  );

  const stocks = paginatedData?.data ?? [];
  const totalPages = paginatedData ? Math.max(1, Math.ceil(paginatedData.total / limit)) : 1;
  const counts = paginatedData?.counts ?? { NSE: 0, BSE: 0, all: 0 };
  const suggestionCounts = paginatedData?.suggestions ?? { BUY: 0, SELL: 0, HOLD: 0 };

  const provenance = useMemo(() => {
    if (!stocks || stocks.length === 0) return null;
    const simulated = stocks.filter((s) => s.dataSource === 'simulated').length;
    const cached = stocks.filter((s) => s.dataSource === 'cached').length;
    const listed = stocks.filter((s) => s.dataSource === 'listed').length;
    return { simulated, cached, listed, total: stocks.length };
  }, [stocks]);

  const handleExchangeChange = (_event: React.SyntheticEvent, value: ExchangeTab): void => {
    if (!value) return;
    setExchange(value);
    setPage(1);
  };

  const handleSuggestionChange = (
    _event: React.MouseEvent<HTMLElement>,
    value: SuggestionFilter | null,
  ): void => {
    if (!value) return;
    setSuggestion(value);
    setPage(1);
  };

  const handleHorizonChange = (
    _event: React.MouseEvent<HTMLElement>,
    value: HorizonFilter | null,
  ): void => {
    if (!value) return;
    setHorizon(value);
    setPage(1);
  };

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number): void => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const horizonLabel = horizon === 'NEXT_WEEK' ? 'next-week' : 'next-day';
  const buyHit = accuracy?.byAction?.BUY?.hitRate;
  const scored = accuracy?.scoredCalls;

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        Market Dashboard
      </Typography>
      <IndexCards />

      {typeof buyHit === 'number' && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="accuracy-banner">
          {horizonLabel} model track record: {accuracy?.overallHitRate}% of {scored ?? 0} scored
          calls were labeled correctly (Buy ideas {buyHit}% right). Paper size is 1% of ₹10 L
          capital. This is not investment advice.
        </Alert>
      )}
      {accuracy == null && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          AI Buy/Sell stays Hold until models are trained (`npm run train:ml`) and scored. Chips
          will not use today&apos;s already-printed move.
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={exchange} onChange={handleExchangeChange}>
          <Tab value="NSE" label={`NSE (${counts.NSE})`} />
          <Tab value="BSE" label={`BSE (${counts.BSE})`} />
        </Tabs>
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2 }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        flexWrap="wrap"
      >
        <TextField
          size="small"
          placeholder={`Search ${exchange} stocks...`}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 280 }}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={horizon}
          onChange={handleHorizonChange}
          aria-label="Forecast horizon"
        >
          <ToggleButton value="NEXT_DAY">Next day</ToggleButton>
          <ToggleButton value="NEXT_WEEK">Next week</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={suggestion}
          onChange={handleSuggestionChange}
          aria-label="Buy or sell suggestion"
        >
          <ToggleButton value="ALL">All</ToggleButton>
          <ToggleButton value="BUY" color="success">
            Buy ({suggestionCounts.BUY})
          </ToggleButton>
          <ToggleButton value="SELL" color="error">
            Sell ({suggestionCounts.SELL})
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary">
          {paginatedData?.total ?? 0} {exchange}
          {suggestion === 'ALL' ? '' : ` ${suggestion.toLowerCase()}`} stocks
        </Typography>
      </Stack>

      {provenance && provenance.simulated > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {provenance.simulated} of {provenance.total} symbols on this page are showing SIMULATED
          data (no live feed and no cached real data). Signals and predictions for these symbols are
          not based on real prices.
        </Alert>
      )}
      {provenance && provenance.listed > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {provenance.listed} of {provenance.total} symbols on this page are listed but have no
          official EOD prices yet. Prices load automatically from NSE/BSE bhavcopy a few seconds
          after the market-data service starts.
        </Alert>
      )}
      {(isLoading || (isFetching && stocks.length === 0)) && (
        <Skeleton variant="rounded" height={400} />
      )}
      {isError && (
        <Alert severity="error">
          Market data is unavailable. Check that the platform services are running (`npm run
          start:all`).
        </Alert>
      )}
      {stocks && stocks.length > 0 && <StockTable stocks={stocks} />}
      {!isLoading && stocks.length === 0 && (
        <Alert severity="info">
          {suggestion === 'ALL'
            ? `No ${exchange} stocks match this search.`
            : `No ${suggestion} AI advisories on this ${exchange} page. Try All, or train models.`}
        </Alert>
      )}

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination count={totalPages} page={page} onChange={handlePageChange} color="primary" />
        </Box>
      )}

      {stocks && stocks.length > 0 && (
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Showing {stocks.length} of {paginatedData?.total ?? 0} {exchange} stocks. Page {page} of{' '}
            {totalPages}
          </Typography>
        </Box>
      )}
    </>
  );
}
