import {
  Alert,
  Box,
  Chip,
  Pagination,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import type { StockQuote } from '@stockpred/shared-types';
import StockTable from '../components/StockTable';
import {
  RankFilter,
  SuspiciousFilter,
  isBullRunStock,
  isBestPickQuality,
  matchesSuspicious,
  maxProfitAmong,
  profitPct,
  rankQuotes,
} from '../lib/quote-rank';
import { useGetPredictionAccuracyQuery, useGetStocksQuery } from '../store/api';

type SuggestionFilter = 'ALL' | 'BUY' | 'SELL';
type HorizonFilter = 'ALL' | 'NEXT_DAY' | 'NEXT_WEEK';

const PAGE_SIZE = 50;
const FETCH_LIMIT = 5000;

function emptyMessage(
  bestPickMode: boolean,
  suggestion: SuggestionFilter,
  filters: RankFilter[],
  suspicious: SuspiciousFilter,
): string {
  if (suspicious !== 'ALL') {
    return `No ${suspicious.toLowerCase()} names match. Try All activity, or wait for unusual-activity scores.`;
  }
  if (filters.includes('BULL')) {
    return 'No bull-run names match (bull score 70+). Train models or try without Bull run.';
  }
  if (bestPickMode) {
    return suggestion === 'ALL'
      ? 'No Best Picks yet. Names need 75%+ confidence and 2%+ target profit on Buy or Sell.'
      : `No ${suggestion} Best Picks right now. Try All or relax rank filters.`;
  }
  return suggestion === 'ALL'
    ? 'No predictions match this search. Train models (`npm run train:ml`) or wait for the next refresh.'
    : `No ${suggestion} advisories on this page. Try All or train models.`;
}

function apiSort(filters: RankFilter[], bestPickMode: boolean): string | undefined {
  if (filters.includes('PROFIT')) return 'profit';
  if (filters.includes('CONFIDENCE')) return 'confidence';
  if (filters.includes('BULL')) return 'bull';
  if (bestPickMode) return 'profit';
  return undefined;
}

export default function PredictionsPage(): JSX.Element {
  const [bestPickMode, setBestPickMode] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestionFilter>('ALL');
  const [horizon, setHorizon] = useState<HorizonFilter>('NEXT_DAY');
  const [rankFilters, setRankFilters] = useState<RankFilter[]>([]);
  const [suspicious, setSuspicious] = useState<SuspiciousFilter>('ALL');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const clientRanked =
    bestPickMode || rankFilters.length > 0 || suspicious !== 'ALL' || Boolean(search.trim());

  const suggestionParam = bestPickMode
    ? 'ACTIONABLE'
    : suggestion === 'ALL'
      ? undefined
      : suggestion;
  const sortParam = apiSort(rankFilters, bestPickMode);

  const dayQuery = useGetStocksQuery(
    {
      page: 1,
      limit: FETCH_LIMIT,
      horizon: 'NEXT_DAY',
      suggestion: suggestionParam,
      sort: sortParam,
    },
    { pollingInterval: 30_000, skip: horizon === 'NEXT_WEEK' },
  );

  const weekQuery = useGetStocksQuery(
    {
      page: 1,
      limit: FETCH_LIMIT,
      horizon: 'NEXT_WEEK',
      suggestion: suggestionParam,
      sort: sortParam,
    },
    { pollingInterval: 30_000, skip: horizon === 'NEXT_DAY' },
  );

  const { data: accuracy } = useGetPredictionAccuracyQuery(
    horizon === 'ALL' ? undefined : ({ horizon } as unknown as { horizon: string }),
    { pollingInterval: 60_000, skip: horizon === 'ALL' },
  );

  const isLoaded =
    horizon === 'ALL'
      ? Boolean(dayQuery.currentData && weekQuery.currentData)
      : horizon === 'NEXT_WEEK'
        ? Boolean(weekQuery.currentData)
        : Boolean(dayQuery.currentData);

  const baseRows: StockQuote[] = useMemo(() => {
    if (horizon !== 'ALL') {
      return (
        (horizon === 'NEXT_WEEK' ? weekQuery.currentData?.data : dayQuery.currentData?.data) ?? []
      );
    }

    const dayRows = dayQuery.currentData?.data ?? [];
    const weekRows = weekQuery.currentData?.data ?? [];
    const allRows = [...dayRows, ...weekRows];

    const bySymbol = new Map<string, StockQuote[]>();
    for (const row of allRows) {
      if (!row.symbol) continue;
      const list = bySymbol.get(row.symbol) ?? [];
      list.push(row);
      bySymbol.set(row.symbol, list);
    }

    const wantProfit = rankFilters.includes('PROFIT');
    const wantConf = rankFilters.includes('CONFIDENCE');
    const wantBull = rankFilters.includes('BULL');

    const bullScore = (r: StockQuote): number => r.scanner?.bullScore ?? 0;

    const compare = (a: StockQuote, b: StockQuote): number => {
      if (wantProfit) {
        return (
          profitPct(b) - profitPct(a) ||
          (wantConf ? b.confidence - a.confidence : 0) ||
          (wantBull ? bullScore(b) - bullScore(a) : 0) ||
          a.symbol.localeCompare(b.symbol)
        );
      }
      if (wantConf) {
        return (
          b.confidence - a.confidence ||
          profitPct(b) - profitPct(a) ||
          (wantBull ? bullScore(b) - bullScore(a) : 0) ||
          a.symbol.localeCompare(b.symbol)
        );
      }
      if (wantBull) {
        return (
          bullScore(b) - bullScore(a) ||
          profitPct(b) - profitPct(a) ||
          a.symbol.localeCompare(b.symbol)
        );
      }
      if (bestPickMode) {
        return (
          b.confidence * profitPct(b) - a.confidence * profitPct(a) ||
          profitPct(b) - profitPct(a) ||
          a.symbol.localeCompare(b.symbol)
        );
      }
      return a.symbol.localeCompare(b.symbol);
    };

    const representatives: StockQuote[] = [];
    for (const [, candidates] of bySymbol.entries()) {
      let pool = candidates;

      if (suggestion === 'BUY' || suggestion === 'SELL') {
        pool = pool.filter((r) => r.suggestion === suggestion);
      }

      if (bestPickMode) {
        pool = pool.filter(isBestPickQuality);
      }

      if (rankFilters.includes('BULL')) {
        pool = pool.filter(isBullRunStock);
      }

      if (suspicious !== 'ALL') {
        pool = pool.filter((r) => matchesSuspicious(r, suspicious));
      }

      if (pool.length === 0) continue;

      pool.sort(compare);
      representatives.push(pool[0]);
    }

    return representatives;
  }, [
    horizon,
    bestPickMode,
    suggestion,
    rankFilters,
    suspicious,
    dayQuery.currentData?.data,
    weekQuery.currentData?.data,
  ]);

  const ranked = useMemo(
    () =>
      rankQuotes(baseRows, {
        bestPick: bestPickMode,
        suggestion,
        filters: rankFilters,
        suspicious,
        search: clientRanked ? search : undefined,
      }),
    [baseRows, bestPickMode, suggestion, rankFilters, suspicious, search, clientRanked],
  );

  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const stocks = ranked.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const qualityPool = bestPickMode ? baseRows.filter(isBestPickQuality) : baseRows;
  const suggestionCounts = {
    BUY: qualityPool.filter((row) => row.suggestion === 'BUY').length,
    SELL: qualityPool.filter((row) => row.suggestion === 'SELL').length,
  };
  const bullRunCount = qualityPool.filter(isBullRunStock).length;
  const suspiciousCounts = {
    NORMAL: qualityPool.filter((row) => row.manipulation?.band === 'NORMAL').length,
    SUSPICIOUS: qualityPool.filter((row) => row.manipulation?.band === 'SUSPICIOUS').length,
    INVESTIGATE: qualityPool.filter((row) => row.manipulation?.band === 'INVESTIGATE').length,
  };
  const headlineProfit = maxProfitAmong(ranked);

  const horizonLabel =
    horizon === 'ALL' ? 'all horizons' : horizon === 'NEXT_WEEK' ? 'next-week' : 'next-day';
  const buyHit = accuracy?.byAction?.BUY?.hitRate;
  const scored = accuracy?.scoredCalls;

  return (
    <>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
        ML Predictions
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ranked {horizonLabel} forecasts for all NSE/BSE names. Combine Max profit, Max confidence,
        and Bull run; Best Pick keeps only high-confidence, high-profit Buy and Sell ideas.
      </Typography>

      {scored != null && scored > 0 && buyHit != null && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Recent {horizonLabel} buy hit rate: <b>{buyHit.toFixed(1)}%</b> ({scored} scored calls).
        </Typography>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mb: 2 }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        flexWrap="wrap"
      >
        <TextField
          size="small"
          placeholder={bestPickMode ? 'Search best picks...' : 'Filter by symbol...'}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 220 }}
        />

        <ToggleButtonGroup
          exclusive
          size="small"
          value={horizon}
          onChange={(_event, value: HorizonFilter | null) => {
            if (!value) return;
            setHorizon(value);
            setPage(1);
          }}
          aria-label="Forecast horizon"
        >
          <ToggleButton value="ALL">All horizons</ToggleButton>
          <ToggleButton value="NEXT_DAY">Next day</ToggleButton>
          <ToggleButton value="NEXT_WEEK">Next week</ToggleButton>
        </ToggleButtonGroup>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={suggestion}
          onChange={(_event, value: SuggestionFilter | null) => {
            if (!value) return;
            setSuggestion(value);
            setPage(1);
          }}
          aria-label="Buy or sell filter"
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
          onChange={(_event, value: SuspiciousFilter | null) => {
            if (!value) return;
            setSuspicious(value);
            setPage(1);
          }}
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
          value="best"
          selected={bestPickMode}
          size="small"
          color="primary"
          onChange={() => {
            setBestPickMode((on) => !on);
            setPage(1);
          }}
          data-testid="best-pick-toggle"
        >
          Best Pick
        </ToggleButton>

        <ToggleButton
          value="all"
          selected={rankFilters.length === 0}
          size="small"
          onClick={() => {
            setRankFilters([]);
            setPage(1);
          }}
        >
          All ranks
        </ToggleButton>

        <ToggleButtonGroup
          size="small"
          value={rankFilters}
          onChange={(_event, value: RankFilter[]) => {
            setRankFilters(value);
            setPage(1);
          }}
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
          {ranked.length} {suggestion === 'ALL' ? '' : `${suggestion.toLowerCase()} `}
          predictions
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

      {(dayQuery.isLoading || dayQuery.isFetching || weekQuery.isLoading || weekQuery.isFetching) &&
      !isLoaded ? (
        <Skeleton variant="rounded" height={420} />
      ) : dayQuery.isError || weekQuery.isError ? (
        <Alert severity="error">Could not load predictions. Check that services are running.</Alert>
      ) : stocks.length === 0 ? (
        <Alert severity="info">
          {emptyMessage(bestPickMode, suggestion, rankFilters, suspicious)}
        </Alert>
      ) : (
        <StockTable stocks={stocks} maxProfitSymbol={headlineProfit.symbol} />
      )}

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination
            count={totalPages}
            page={currentPage}
            onChange={(_event, value) => {
              setPage(value);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Showing {stocks.length} of {ranked.length} predictions (page {currentPage}/{totalPages}).
        Refreshes every 30s. This is not investment advice.
      </Typography>
    </>
  );
}
