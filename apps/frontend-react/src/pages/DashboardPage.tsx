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
import AgentTradingToggle from '../components/AgentTradingToggle';
import StockTable from '../components/StockTable';
import {
  RankFilter,
  SuspiciousFilter,
  isBullRunStock,
  isBestPickQuality,
  maxProfitAmong,
  rankQuotes,
} from '../lib/quote-rank';
import { INDEX_BASKET_SIZE, type IndexUniverseId, inIndexUniverse } from '../lib/index-universes';
import {
  useGetMarketDataContractQuery,
  useGetPredictionAccuracyQuery,
  useGetStocksQuery,
} from '../store/api';

type DashboardTab = 'NSE' | 'BSE' | 'NIFTY50' | 'NIFTY100' | 'NIFTY500' | 'ALERTS';
type SuggestionFilter = 'ALL' | 'BUY' | 'SELL';
type HorizonFilter = 'NEXT_DAY' | 'NEXT_WEEK';

const PAGE_SIZE = 40;
const FETCH_LIMIT = 5000;

function universeForTab(tab: DashboardTab): Exclude<IndexUniverseId, 'all'> | undefined {
  if (tab === 'NIFTY50') return 'nifty50';
  if (tab === 'NIFTY100') return 'nifty100';
  if (tab === 'NIFTY500') return 'nifty500';
  return undefined;
}

function tabNoun(tab: DashboardTab): string {
  if (tab === 'NIFTY50') return 'Nifty 50';
  if (tab === 'NIFTY100') return 'Nifty 100';
  if (tab === 'NIFTY500') return 'Nifty 500';
  if (tab === 'ALERTS') return 'focus';
  return tab;
}

function emptyTableMessage(
  alertsMode: boolean,
  suggestion: SuggestionFilter,
  exchange: DashboardTab,
  filters: RankFilter[],
  suspicious: SuspiciousFilter,
): string {
  if (suspicious !== 'ALL') {
    return `No ${suspicious.toLowerCase()} names on this tape. Try All activity, or wait for unusual-activity scores.`;
  }
  if (filters.includes('BULL')) {
    return 'No bull-run stocks on this tape (bull score 70+). Hydrate history or open the Scanner.';
  }
  if (alertsMode) {
    return suggestion === 'ALL'
      ? 'No paper Buy or Sell alerts yet. Train models (`npm run train:ml`) or wait for the blend to fire.'
      : `No ${suggestion} alerts right now. Try All, or train models.`;
  }
  const noun = tabNoun(exchange);
  return suggestion === 'ALL'
    ? `No ${noun} stocks match this search.`
    : `No ${suggestion} AI advisories on this ${noun} page. Try All, or train models.`;
}

function apiSort(filters: RankFilter[], tab: DashboardTab): string | undefined {
  if (filters.includes('PROFIT')) return 'profit';
  if (filters.includes('CONFIDENCE')) return 'confidence';
  if (filters.includes('BULL')) return 'bull';
  if (tab === 'ALERTS') return 'confidence';
  return undefined;
}

function tabFromSearch(): DashboardTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === 'alerts') return 'ALERTS';
  if (tab === 'nifty50') return 'NIFTY50';
  if (tab === 'nifty100') return 'NIFTY100';
  if (tab === 'nifty500') return 'NIFTY500';
  if (tab === 'bse') return 'BSE';
  return 'NSE';
}

function apiExchange(tab: DashboardTab): string | undefined {
  if (tab === 'NSE' || tab === 'NIFTY50' || tab === 'NIFTY100' || tab === 'NIFTY500') return 'NSE';
  if (tab === 'BSE') return 'BSE';
  return undefined;
}

export default function DashboardPage(): JSX.Element {
  const [exchange, setExchange] = useState<DashboardTab>(tabFromSearch);
  const [suggestion, setSuggestion] = useState<SuggestionFilter>('ALL');
  const [horizon, setHorizon] = useState<HorizonFilter>('NEXT_DAY');
  const [rankFilters, setRankFilters] = useState<RankFilter[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousFilter>('ALL');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const alertsMode = exchange === 'ALERTS';
  const bestPickMode = false;
  const universe = universeForTab(exchange);
  const indexMode = Boolean(universe);
  const focusMode = alertsMode;
  const clientRanked = focusMode || indexMode || rankFilters.length > 0 || suspicious !== 'ALL';

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
      exchange: apiExchange(exchange),
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
        suspicious,
        search: clientRanked ? search : undefined,
        universe,
      }),
    [
      paginatedData?.data,
      bestPickMode,
      suggestion,
      rankFilters,
      suspicious,
      clientRanked,
      search,
      universe,
    ],
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
  const scopedPool = universe ? pool.filter((row) => inIndexUniverse(row.symbol, universe)) : pool;
  const qualityPool = bestPickMode ? scopedPool.filter(isBestPickQuality) : scopedPool;
  const suggestionCounts = {
    BUY: qualityPool.filter((row) => row.suggestion === 'BUY').length,
    SELL: qualityPool.filter((row) => row.suggestion === 'SELL').length,
    HOLD: qualityPool.filter((row) => row.suggestion === 'HOLD').length,
  };
  const bullRunCount = qualityPool.filter(isBullRunStock).length;
  const suspiciousCounts = {
    NORMAL: qualityPool.filter((row) => row.manipulation?.band === 'NORMAL').length,
    SUSPICIOUS: qualityPool.filter((row) => row.manipulation?.band === 'SUSPICIOUS').length,
    INVESTIGATE: qualityPool.filter((row) => row.manipulation?.band === 'INVESTIGATE').length,
  };

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

  const handleSuspiciousChange = (
    _event: React.MouseEvent<HTMLElement>,
    value: SuspiciousFilter | null,
  ): void => {
    if (!value) return;
    setSuspicious(value);
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
  const { data: contract } = useGetMarketDataContractQuery(undefined, { pollingInterval: 15_000 });

  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2 }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Market
          </Typography>
          <Typography variant="body2" color="text.secondary">
            What is happening? Indices, tape, and session — not a decision surface.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            color={contract?.nseCashSessionOpen ? 'success' : 'default'}
            label={contract?.nseCashSessionOpen ? 'Session OPEN' : 'Session CLOSED'}
          />
          <Chip
            size="small"
            variant="outlined"
            label={contract?.quoteStatus ?? 'Status Not available'}
          />
          <AgentTradingToggle compact />
        </Stack>
      </Stack>
      <IndexCards />
      <MarketContextBar />

      <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
        Market Breadth intelligence is Not available (future backlog). Tape uses existing market
        APIs only.
      </Alert>

      {typeof buyHit === 'number' && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="accuracy-banner">
          {horizonLabel} model track record: {accuracy?.overallHitRate}% of {scored ?? 0} scored
          calls (Buy {buyHit}%). Display only — not trade authorization.
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={exchange}
          onChange={handleExchangeChange}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          <Tab value="NSE" label={`NSE (${counts.NSE})`} />
          <Tab value="BSE" label={`BSE (${counts.BSE})`} />
          <Tab value="NIFTY50" label={`Nifty 50 stocks (${INDEX_BASKET_SIZE.nifty50})`} />
          <Tab value="NIFTY100" label={`Nifty 100 stocks (${INDEX_BASKET_SIZE.nifty100})`} />
          <Tab value="NIFTY500" label={`Nifty 500 stocks (${INDEX_BASKET_SIZE.nifty500})`} />
          <Tab value="ALERTS" label="Alerts" />
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
          placeholder={alertsMode ? 'Search alerts...' : `Search ${tabNoun(exchange)} stocks...`}
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
        <ToggleButtonGroup
          exclusive
          size="small"
          value={suspicious}
          onChange={handleSuspiciousChange}
          aria-label="Unusual activity band"
          data-testid="suspicious-filter"
        >
          <ToggleButton value="ALL">All activity</ToggleButton>
          <ToggleButton value="NORMAL">
            Normal{suspiciousCounts.NORMAL ? ` (${suspiciousCounts.NORMAL})` : ''}
          </ToggleButton>
          <ToggleButton value="SUSPICIOUS" color="warning">
            Suspicious{suspiciousCounts.SUSPICIOUS ? ` (${suspiciousCounts.SUSPICIOUS})` : ''}
          </ToggleButton>
          <ToggleButton value="INVESTIGATE" color="error">
            Investigate{suspiciousCounts.INVESTIGATE ? ` (${suspiciousCounts.INVESTIGATE})` : ''}
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
          aria-label="Filter by expected return, confidence, and bull-run scanner band"
        >
          <ToggleButton value="PROFIT" color="success">
            Expected Return
          </ToggleButton>
          <ToggleButton value="CONFIDENCE">Max confidence</ToggleButton>
          <ToggleButton value="BULL" color="warning">
            Bull-Run scanner{bullRunCount ? ` (${bullRunCount})` : ''}
          </ToggleButton>
        </ToggleButtonGroup>
        {headlineProfit.pct > 0 && (
          <Chip
            color="success"
            variant="outlined"
            label={`Expected return ${headlineProfit.pct.toFixed(1)}%${
              headlineProfit.symbol ? ` · ${headlineProfit.symbol}` : ''
            }`}
          />
        )}
        <Typography variant="body2" color="text.secondary">
          {ranked.length} {tabNoun(exchange)}
          {suggestion === 'ALL' ? '' : ` ${suggestion.toLowerCase()}`} stocks
        </Typography>
      </Stack>

      {indexMode && universe && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="index-banner">
          Showing NSE names in the {tabNoun(exchange)} basket ({INDEX_BASKET_SIZE[universe]}) as of
          the last index snapshot. Missing rows usually mean the symbol is not in the live book yet.
        </Alert>
      )}
      {alertsMode && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="alerts-banner">
          Tape alerts only — not the agent evidence path. Manual Paper Buy is classic paper; agent
          ACTUAL evidence requires Desk Approve. Prefer Prep → Desk for trading decisions.
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
          {emptyTableMessage(alertsMode, suggestion, exchange, rankFilters, suspicious)}
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
            Showing {stocks.length} of {ranked.length} {tabNoun(exchange)} stocks. Page{' '}
            {currentPage} of {totalPages}
          </Typography>
        </Box>
      )}
    </>
  );
}
