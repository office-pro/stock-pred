import {
  Alert,
  Chip,
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
import MarketContextBar from '../components/MarketContextBar';
import StockTable from '../components/StockTable';
import {
  RankFilter,
  isBullRunStock,
  isBestPickQuality,
  maxProfitAmong,
  rankQuotes,
} from '../lib/quote-rank';
import { useGetPredictionAccuracyQuery, useGetStocksQuery } from '../store/api';

type DashboardTab = 'NSE' | 'BSE' | 'ALERTS' | 'BEST';
type SuggestionFilter = 'ALL' | 'BUY' | 'SELL';
type HorizonFilter = 'NEXT_DAY' | 'NEXT_WEEK';

const PAGE_SIZE = 40;
const FETCH_LIMIT = 5000;

function emptyTableMessage(
  alertsMode: boolean,
  bestPickMode: boolean,
  suggestion: SuggestionFilter,
  exchange: DashboardTab,
  filters: RankFilter[],
): string {
  if (filters.includes('BULL')) {
    return 'No bull-run stocks on this tape (bull score 70+). Hydrate history or open the Scanner.';
  }
  if (bestPickMode) {
    return suggestion === 'ALL'
      ? 'No Best Picks yet. Names need 75%+ confidence and 2%+ target profit on both Buy and Sell. Use Alerts for the wider tape, or train models.'
      : `No ${suggestion} Best Picks right now. Try All, or check Alerts.`;
  }
  if (alertsMode) {
    return suggestion === 'ALL'
      ? 'No paper Buy or Sell alerts yet. Train models (`npm run train:ml`) or wait for the blend to fire.'
      : `No ${suggestion} alerts right now. Try All, or train models.`;
  }
  return suggestion === 'ALL'
    ? `No ${exchange} stocks match this search.`
    : `No ${suggestion} AI advisories on this ${exchange} page. Try All, or train models.`;
}

function apiSort(filters: RankFilter[], tab: DashboardTab): string | undefined {
  if (filters.includes('PROFIT')) return 'profit';
  if (filters.includes('CONFIDENCE')) return 'confidence';
  if (filters.includes('BULL')) return 'bull';
  if (tab === 'BEST') return 'profit';
  if (tab === 'ALERTS') return 'confidence';
  return undefined;
}

function tabFromSearch(): DashboardTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === 'alerts') return 'ALERTS';
  if (tab === 'best') return 'BEST';
  return 'NSE';
}

export default function DashboardPage(): JSX.Element {
  const [exchange, setExchange] = useState<DashboardTab>(tabFromSearch);
  const [suggestion, setSuggestion] = useState<SuggestionFilter>('ALL');
  const [horizon, setHorizon] = useState<HorizonFilter>('NEXT_DAY');
  const [rankFilters, setRankFilters] = useState<RankFilter[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const alertsMode = exchange === 'ALERTS';
  const bestPickMode = exchange === 'BEST';
  const focusMode = alertsMode || bestPickMode;
  const clientRanked = focusMode || rankFilters.length > 0;

  const {
    currentData: paginatedData,
    isLoading,
    isFetching,
    isError,
  } = useGetStocksQuery(
    {
      page: clientRanked ? 1 : page,
      limit: clientRanked ? FETCH_LIMIT : PAGE_SIZE,
      search: clientRanked ? undefined : search || undefined,
      exchange: focusMode ? undefined : exchange,
      suggestion:
        bestPickMode || alertsMode ? 'ACTIONABLE' : suggestion === 'ALL' ? undefined : suggestion,
      horizon,
      sort: apiSort(rankFilters, exchange),
    },
    { pollingInterval: 10_000 },
  );

  const { data: accuracy } = useGetPredictionAccuracyQuery(
    { horizon },
    { pollingInterval: 60_000 },
  );

  const ranked = useMemo(
    () =>
      rankQuotes(paginatedData?.data ?? [], {
        bestPick: bestPickMode,
        suggestion,
        filters: rankFilters,
        search: clientRanked ? search : undefined,
      }),
    [paginatedData?.data, bestPickMode, suggestion, rankFilters, clientRanked, search],
  );
  const totalPages = clientRanked
    ? Math.max(1, Math.ceil(ranked.length / PAGE_SIZE))
    : Math.max(1, Math.ceil((paginatedData?.total ?? ranked.length) / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const stocks = clientRanked
    ? ranked.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : ranked;
  const counts = paginatedData?.counts ?? { NSE: 0, BSE: 0, all: 0 };
  const pool = paginatedData?.data ?? [];
  const qualityPool = bestPickMode ? pool.filter(isBestPickQuality) : pool;
  const suggestionCounts = {
    BUY: qualityPool.filter((row) => row.suggestion === 'BUY').length,
    SELL: qualityPool.filter((row) => row.suggestion === 'SELL').length,
    HOLD: qualityPool.filter((row) => row.suggestion === 'HOLD').length,
  };
  const bullRunCount = qualityPool.filter(isBullRunStock).length;

  const provenance = useMemo(() => {
    if (!stocks || stocks.length === 0) return null;
    const simulated = stocks.filter((s) => s.dataSource === 'simulated').length;
    const cached = stocks.filter((s) => s.dataSource === 'cached').length;
    const listed = stocks.filter((s) => s.dataSource === 'listed').length;
    return { simulated, cached, listed, total: stocks.length };
  }, [stocks]);

  const handleExchangeChange = (_event: React.SyntheticEvent, value: DashboardTab): void => {
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

  const handleRankFilterChange = (
    _event: React.MouseEvent<HTMLElement>,
    value: RankFilter[],
  ): void => {
    setRankFilters(value);
    setPage(1);
  };

  const handleClearRankFilters = (): void => {
    setRankFilters([]);
    setPage(1);
  };

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number): void => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const headlineProfit = maxProfitAmong(ranked);
  const horizonLabel = horizon === 'NEXT_WEEK' ? 'next-week' : 'next-day';
  const buyHit = accuracy?.byAction?.BUY?.hitRate;
  const scored = accuracy?.scoredCalls;

  return (
    <>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        Market Dashboard
      </Typography>
      <IndexCards />
      <MarketContextBar />

      {typeof buyHit === 'number' && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="accuracy-banner">
          {horizonLabel} model track record: {accuracy?.overallHitRate}% of {scored ?? 0} scored
          calls were labeled correctly (Buy ideas {buyHit}% right). Chips blend the ML forecast with
          stock trend and Nifty: they must not fight, and a weak model on a flat tape stays Hold.
          Paper size is 1% of ₹10 L capital. This is not investment advice.
        </Alert>
      )}
      {accuracy == null && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          ML models are not scored yet, so the Alerts Buy/Sell list uses EMA/MACD trend (and the
          70-point rule signal when it fires). Train models (`npm run train:ml`) to blend in the
          forecast. Chips will not use today&apos;s already-printed move.
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={exchange} onChange={handleExchangeChange}>
          <Tab value="NSE" label={`NSE (${counts.NSE})`} />
          <Tab value="BSE" label={`BSE (${counts.BSE})`} />
          <Tab value="ALERTS" label="Alerts" />
          <Tab value="BEST" label="Best Pick" />
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
          placeholder={
            bestPickMode
              ? 'Search best picks...'
              : alertsMode
                ? 'Search alerts...'
                : `Search ${exchange} stocks...`
          }
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
        <ToggleButton
          value="all"
          selected={rankFilters.length === 0}
          size="small"
          onClick={handleClearRankFilters}
        >
          All
        </ToggleButton>
        <ToggleButtonGroup
          size="small"
          value={rankFilters}
          onChange={handleRankFilterChange}
          aria-label="Rank by max profit, confidence, and bull run"
        >
          <ToggleButton value="PROFIT" color="success">
            Max profit
          </ToggleButton>
          <ToggleButton value="CONFIDENCE">Max confidence</ToggleButton>
          <ToggleButton value="BULL" color="warning">
            Bull run{bullRunCount ? ` (${bullRunCount})` : ''}
          </ToggleButton>
        </ToggleButtonGroup>
        {headlineProfit.pct > 0 && (
          <Chip
            color="success"
            variant="outlined"
            label={`Max profit ${headlineProfit.pct.toFixed(1)}%${
              headlineProfit.symbol ? ` · ${headlineProfit.symbol}` : ''
            }`}
          />
        )}
        <Typography variant="body2" color="text.secondary">
          {ranked.length} {bestPickMode ? 'best pick' : alertsMode ? 'focus' : exchange}
          {suggestion === 'ALL' ? '' : ` ${suggestion.toLowerCase()}`} stocks
        </Typography>
      </Stack>

      {bestPickMode && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="best-pick-banner">
          Best Pick keeps Buy and Sell names that clear both a high-confidence bar (75%+) and a high
          target-profit bar (2%+ vs entry). Max profit, Max confidence, and Bull run can be
          combined; with Max profit on, the highest Profit % is always first. This is not investment
          advice.
        </Alert>
      )}
      {alertsMode && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="alerts-banner">
          Focus list: Buy and Sell chips ranked by confidence. ML is used when models are trained;
          otherwise EMA/MACD trend fills the list. Click <b>Paper Buy</b> to open a lot in the paper
          book (₹10 L cash). Open lots and cash live under Paper book. Click the row for chart
          history. This is not investment advice.
        </Alert>
      )}
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
      {stocks && stocks.length > 0 && (
        <StockTable stocks={stocks} maxProfitSymbol={headlineProfit.symbol} />
      )}
      {!isLoading && stocks.length === 0 && (
        <Alert severity="info">
          {emptyTableMessage(alertsMode, bestPickMode, suggestion, exchange, rankFilters)}
        </Alert>
      )}

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={currentPage}
            onChange={handlePageChange}
            color="primary"
          />
        </Box>
      )}

      {stocks && stocks.length > 0 && (
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Showing {stocks.length} of {ranked.length}{' '}
            {bestPickMode ? 'best pick' : alertsMode ? 'focus' : exchange} stocks. Page{' '}
            {currentPage} of {totalPages}
          </Typography>
        </Box>
      )}
    </>
  );
}
