import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type {
  ApiResponse,
  AuthTokens,
  AuthUser,
  BacktestResult,
  Candle,
  FundamentalView,
  AltDataView,
  IndexQuote,
  MarketContext,
  MarketDepth,
  PortfolioSnapshot,
  PredictionAccuracy,
  RelativeComparison,
  ScannerBacktestSummary,
  StockQuote,
  SupportResistance,
  SymbolPatternPayload,
} from '@stockpred/shared-types';
import { API_BASE_URL } from '../config';
import { logout, setTokens } from './authSlice';
import type { RootState } from './index';

export interface SignalRow {
  id: string;
  symbol: string;
  signal: 'BUY' | 'SELL';
  confidence: number;
  price: number;
  target: number;
  stopLoss: number;
  riskReward: number;
  createdAt: string;
}

export interface SymbolSignals {
  history: SignalRow[];
  current: {
    type: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    price: number;
    target: number | null;
    stopLoss: number | null;
    riskReward: number | null;
    rules: Record<string, boolean>;
  };
}

export interface PatternRow {
  id: string;
  symbol: string;
  pattern: string;
  direction: string;
  confidence: number;
  signal: string;
  createdAt: string;
}

export interface PredictionsPayload {
  symbol: string;
  predictions: {
    symbol: string;
    horizon: string;
    direction: string;
    confidence: number;
    expectedMove: number;
    probabilities?: Record<string, number>;
    modelVersion: string;
  }[];
  disclaimer: string;
}

export type MlJobKind =
  | 'run_all'
  | 'ingest_fundamentals'
  | 'ingest_alt_data'
  | 'ingest_macro'
  | 'ingest_news'
  | 'ingest_social'
  | 'train_all'
  | 'predict_all'
  | 'train_manipulation'
  | 'walk_forward'
  | 'ml_backtest';
export type MlUniverseId = 'nifty50' | 'nifty100' | 'nifty500' | 'smallcap' | 'all';

export interface MlJobCatalogItem {
  kind: MlJobKind;
  title: string;
  npm: string;
  npmByUniverse?: Partial<Record<MlUniverseId, string>>;
  blurb: string;
}

export interface MlUniverseOption {
  id: MlUniverseId;
  label: string;
  blurb: string;
}

export interface MlJobRow {
  id: string;
  kind: MlJobKind;
  title: string;
  npm: string;
  universe?: MlUniverseId;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  percent: number;
  stage: string;
  detail?: string;
  current: number;
  total: number;
  lines: string[];
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  error: string | null;
}

export interface MlJobSnapshot {
  job: MlJobRow | null;
  available: MlJobCatalogItem[];
  universes?: MlUniverseOption[];
  modelsTrained?: boolean;
}

export interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  mode: string;
  status: string;
  target?: number;
  stopLoss?: number;
  exitPrice?: number;
  exitReason?: string;
  pnl?: number;
  executedAt: string;
  closedAt?: string;
}

export interface BrokerProfile {
  id: string;
  name: string;
  email: string;
  accountId: string;
  brokerName: string;
  brokerType: string;
  tradingSegments: string[];
}

export interface BrokerFunds {
  availableCash: number;
  usedMargin: number;
  totalMargin: number;
  marginMultiplier: number;
  buyingPower: number;
  updatedAt: number;
}

export interface BrokerPosition {
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  mode: string;
}

const unwrap = <T>(response: ApiResponse<T>): T => response.data;

const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${API_BASE_URL}/api`,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  },
});

const isAuthRoute = (args: string | FetchArgs): boolean => {
  const url = typeof args === 'string' ? args : args.url;
  return url.startsWith('/auth/');
};

const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extra,
) => {
  let result = await rawBaseQuery(args, api, extra);
  if (result.error?.status !== 401 || isAuthRoute(args)) return result;
  const refreshToken = (api.getState() as RootState).auth.refreshToken;
  if (!refreshToken) return result;
  const refreshed = await rawBaseQuery(
    { url: '/auth/refresh', method: 'POST', body: { refreshToken } },
    api,
    extra,
  );
  if (refreshed.data) {
    api.dispatch(setTokens(refreshed.data as AuthTokens));
    result = await rawBaseQuery(args, api, extra);
  } else {
    api.dispatch(logout());
  }
  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: [
    'Stocks',
    'Signals',
    'Predictions',
    'Portfolio',
    'Trades',
    'MlJobs',
    'AgentMode',
    'AgentSuggestions',
    'AgentOpportunities',
    'Fundamentals',
    'AltData',
  ],
  endpoints: (builder) => ({
    getStocks: builder.query<
      {
        data: StockQuote[];
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
        counts?: { NSE: number; BSE: number; all: number };
        suggestions?: { BUY: number; SELL: number; HOLD: number };
        maxProfitPct?: number;
        maxProfitSymbol?: string | null;
        bullRunCount?: number;
      },
      {
        page?: number;
        limit?: number;
        search?: string;
        exchange?: string;
        suggestion?: string;
        horizon?: string;
        sort?: string;
      }
    >({
      query: ({ page = 1, limit = 50, search, exchange, suggestion, horizon, sort } = {}) => {
        const params = new URLSearchParams();
        params.append('page', page.toString());
        params.append('limit', limit.toString());
        if (search) params.append('search', search);
        if (exchange) params.append('exchange', exchange);
        if (suggestion) params.append('suggestion', suggestion);
        if (horizon) params.append('horizon', horizon);
        if (sort) params.append('sort', sort);
        return `/stocks?${params.toString()}`;
      },
      providesTags: ['Stocks'],
    }),
    getStock: builder.query<StockQuote, string>({
      query: (symbol) => `/stocks/${symbol}`,
    }),
    getFundamentals: builder.query<FundamentalView, string>({
      query: (symbol) => `/stocks/${symbol}/fundamentals`,
      providesTags: (_r, _e, symbol) => [{ type: 'Fundamentals', id: symbol }],
    }),
    getPeerValuation: builder.query<import('@stockpred/shared-types').PeerValuationView, string>({
      query: (symbol) => `/stocks/${symbol}/peer-valuation`,
      providesTags: (_r, _e, symbol) => [{ type: 'Fundamentals', id: symbol }],
    }),
    getAltData: builder.query<AltDataView, string>({
      query: (symbol) => `/stocks/${symbol}/alt-data`,
      providesTags: (_r, _e, symbol) => [{ type: 'AltData', id: symbol }],
    }),
    ingestFundamentals: builder.mutation<
      { symbol: string; snapshots: number; skipped?: boolean; reason?: string; cached?: boolean },
      { symbol: string; full?: boolean }
    >({
      query: ({ symbol, full = true }) => ({
        url: `/stocks/${symbol}/fundamentals/ingest?full=${full ? '1' : '0'}`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, { symbol }) => [{ type: 'Fundamentals', id: symbol }],
    }),
    refreshTechnical: builder.mutation<
      { symbol: string; candles: number; indicators: boolean; dataSource: string },
      string
    >({
      query: (symbol) => ({
        url: `/stocks/${symbol}/technical/refresh`,
        method: 'POST',
      }),
      invalidatesTags: ['Stocks'],
    }),
    ingestNews: builder.mutation<unknown, { symbol: string; full?: boolean }>({
      query: ({ symbol, full = true }) => ({
        url: `/stocks/${symbol}/alt-data/news/ingest?full=${full ? '1' : '0'}`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, { symbol }) => [{ type: 'AltData', id: symbol }],
    }),
    ingestSocial: builder.mutation<unknown, { symbol: string; full?: boolean }>({
      query: ({ symbol, full = true }) => ({
        url: `/stocks/${symbol}/alt-data/social/ingest?full=${full ? '1' : '0'}`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, { symbol }) => [{ type: 'AltData', id: symbol }],
    }),
    ingestMacro: builder.mutation<unknown, { full?: boolean; includeIndia?: boolean } | void>({
      query: (arg) => {
        const full = !(arg && 'full' in arg && arg.full === false);
        const includeIndia = Boolean(arg && 'includeIndia' in arg && arg.includeIndia);
        return {
          url: `/alt-data/ingest/macro?full=${full ? '1' : '0'}&includeIndia=${includeIndia ? '1' : '0'}`,
          method: 'POST',
        };
      },
      invalidatesTags: ['AltData'],
    }),
    getIndices: builder.query<IndexQuote[], void>({
      query: () => '/indices',
    }),
    getMarketContext: builder.query<MarketContext, void>({
      query: () => '/market/context',
    }),
    getScanner: builder.query<
      {
        data: StockQuote[];
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
        context: MarketContext;
      },
      { page?: number; limit?: number; minScore?: number; sort?: string; minInvestigate?: number }
    >({
      query: ({ page = 1, limit = 40, minScore = 55, sort = 'score', minInvestigate = 0 } = {}) => {
        const params = new URLSearchParams();
        params.append('page', page.toString());
        params.append('limit', limit.toString());
        params.append('minScore', minScore.toString());
        params.append('sort', sort);
        params.append('minInvestigate', minInvestigate.toString());
        return `/scanner?${params.toString()}`;
      },
      providesTags: ['Stocks'],
    }),
    getCandles: builder.query<Candle[], { symbol: string; timeframe?: string; limit?: number }>({
      query: ({ symbol, timeframe = '1d', limit = 300 }) =>
        `/stocks/${symbol}/candles?timeframe=${timeframe}&limit=${limit}`,
    }),
    getIndexCandles: builder.query<Candle[], { index: string; limit?: number }>({
      query: ({ index, limit = 300 }) => `/indices/${index}/candles?limit=${limit}`,
    }),
    getDepth: builder.query<MarketDepth, string>({
      query: (symbol) => `/stocks/${symbol}/depth`,
    }),
    getCompare: builder.query<
      RelativeComparison,
      { symbol: string; benchmark?: string; window?: number }
    >({
      query: ({ symbol, benchmark = 'NIFTY_50', window = 60 }) =>
        `/stocks/${symbol}/compare?benchmark=${benchmark}&window=${window}`,
    }),
    getSignals: builder.query<SignalRow[], void>({
      query: () => '/signals',
      transformResponse: unwrap<SignalRow[]>,
      providesTags: ['Signals'],
    }),
    getSignalsPaginated: builder.query<
      {
        data: SignalRow[];
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
      },
      { page?: number; limit?: number; search?: string; signal?: string; all?: boolean }
    >({
      query: ({ page = 1, limit = 50, search, signal, all = true } = {}) => {
        const params = new URLSearchParams();
        params.append('page', page.toString());
        params.append('limit', limit.toString());
        params.append('all', all.toString());
        if (search) params.append('search', search);
        if (signal) params.append('signal', signal);
        return `/signals?${params.toString()}`;
      },
      transformResponse: (
        response: ApiResponse<{
          data: SignalRow[];
          total: number;
          page: number;
          limit: number;
          hasMore: boolean;
        }>,
      ) => response.data,
      providesTags: ['Signals'],
    }),
    getSymbolSignals: builder.query<SymbolSignals, string>({
      query: (symbol) => `/signals/${symbol}`,
      transformResponse: unwrap<SymbolSignals>,
    }),
    getSupportResistance: builder.query<SupportResistance, string>({
      query: (symbol) => `/support-resistance/${symbol}`,
      transformResponse: unwrap<SupportResistance>,
    }),
    getSymbolPatterns: builder.query<SymbolPatternPayload, string>({
      query: (symbol) => `/patterns/${symbol}`,
      transformResponse: unwrap<SymbolPatternPayload>,
    }),
    getAllPredictions: builder.query<
      {
        predictions: Array<{
          symbol: string;
          horizon: string;
          direction: string;
          confidence: number;
          expectedMove: number;
          createdAt: string;
        }>;
        total?: number;
        page?: number;
        limit?: number;
        hasMore?: boolean;
      },
      { limit?: number; page?: number; search?: string; horizon?: string; direction?: string }
    >({
      query: ({ limit = 50, page = 1, search, horizon, direction } = {}) => {
        const params = new URLSearchParams();
        params.append('limit', String(limit));
        params.append('page', String(page));
        if (search) params.append('search', search);
        if (horizon) params.append('horizon', horizon);
        if (direction) params.append('direction', direction);
        return `/predictions?${params.toString()}`;
      },
      transformResponse: unwrap,
      providesTags: ['Predictions'],
    }),
    getPredictionAccuracy: builder.query<PredictionAccuracy, { horizon?: string } | void>({
      query: (arg) => {
        const horizon = arg && 'horizon' in arg ? arg.horizon : 'NEXT_DAY';
        return `/predictions/accuracy?horizon=${horizon ?? 'NEXT_DAY'}`;
      },
      transformResponse: unwrap<PredictionAccuracy>,
      providesTags: ['Predictions'],
    }),
    getPredictions: builder.query<PredictionsPayload, string>({
      query: (symbol) => `/predictions/${symbol}`,
      transformResponse: unwrap<PredictionsPayload>,
    }),
    getMlJob: builder.query<MlJobSnapshot, void>({
      query: () => '/ml/jobs/current',
      providesTags: ['MlJobs'],
    }),
    startMlJob: builder.mutation<{ job: MlJobRow }, { kind: MlJobKind; universe?: MlUniverseId }>({
      query: (body) => ({ url: '/ml/jobs', method: 'POST', body }),
      invalidatesTags: ['MlJobs'],
    }),
    cancelMlJob: builder.mutation<MlJobSnapshot, void>({
      query: () => ({ url: '/ml/jobs/current/cancel', method: 'POST' }),
      invalidatesTags: ['MlJobs'],
    }),
    runBacktest: builder.mutation<
      BacktestResult,
      { symbol: string; years: number; initialCapital?: number; riskPerTradePercent?: number }
    >({
      query: (body) => ({ url: '/backtest', method: 'POST', body }),
      transformResponse: unwrap<BacktestResult>,
    }),
    runScannerBacktest: builder.mutation<
      ScannerBacktestSummary,
      { symbol: string; minBullScore?: number }
    >({
      query: (body) => ({ url: '/backtest/scanner', method: 'POST', body }),
      transformResponse: unwrap<ScannerBacktestSummary>,
    }),
    getPortfolio: builder.query<PortfolioSnapshot, void>({
      query: () => '/portfolio',
      providesTags: ['Portfolio'],
    }),
    getTrades: builder.query<TradeRow[], void>({
      query: () => '/trades',
      providesTags: ['Trades'],
    }),
    executeTrade: builder.mutation<
      unknown,
      {
        symbol: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        price?: number;
        target?: number;
        stopLoss?: number;
      }
    >({
      query: (body) => ({ url: '/trade/execute', method: 'POST', body }),
      invalidatesTags: ['Portfolio', 'Trades'],
    }),
    login: builder.mutation<
      { user: AuthUser; tokens: AuthTokens },
      { email: string; password: string }
    >({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
    register: builder.mutation<
      { user: AuthUser; tokens: AuthTokens },
      { email: string; password: string; name: string }
    >({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
    }),
    getBrokerProfile: builder.query<BrokerProfile, void>({
      query: () => '/brokers/profile',
      providesTags: ['Portfolio'],
    }),
    getBrokerFunds: builder.query<BrokerFunds, void>({
      query: () => '/brokers/funds',
      providesTags: ['Portfolio'],
    }),
    getBrokerPositions: builder.query<BrokerPosition[], void>({
      query: () => '/brokers/positions',
      providesTags: ['Portfolio'],
    }),
    configureBroker: builder.mutation<
      { success: boolean; message: string },
      { brokerType: string; credentials?: Record<string, string> }
    >({
      query: (body) => ({ url: '/brokers/config', method: 'POST', body }),
      invalidatesTags: ['Portfolio'],
    }),
    testBrokerConnection: builder.mutation<
      { success?: boolean; connected?: boolean; message: string },
      { brokerType: string }
    >({
      query: (body) => ({ url: '/brokers/test', method: 'POST', body }),
    }),
    getAgentMode: builder.query<
      {
        tradingEnabled: boolean;
        mode: 'RESEARCH' | 'PAPER' | 'LIVE';
        killSwitch: boolean;
        liveArming: {
          armed: boolean;
          blockers: string[];
          brokerConfigured: boolean;
          brokerTestOk: boolean;
        };
        disclaimer: string;
      },
      void
    >({
      query: () => '/agent/mode',
      providesTags: ['AgentMode'],
    }),
    setAgentTradingEnabled: builder.mutation<{ tradingEnabled: boolean }, { enabled: boolean }>({
      query: (body) => ({ url: '/agent/trading-enabled', method: 'POST', body }),
      invalidatesTags: ['AgentMode'],
    }),
    setAgentMode: builder.mutation<
      unknown,
      { mode: 'RESEARCH' | 'PAPER' | 'LIVE'; confirmLive?: string }
    >({
      query: (body) => ({ url: '/agent/mode', method: 'POST', body }),
      invalidatesTags: ['AgentMode'],
    }),
    setAgentKillSwitch: builder.mutation<unknown, { enabled: boolean; flatten?: boolean }>({
      query: (body) => ({ url: '/agent/kill-switch', method: 'POST', body }),
      invalidatesTags: ['AgentMode'],
    }),
    getAgentCapabilities: builder.query<
      {
        capabilities: Array<{
          id: string;
          title: string;
          required: boolean;
          available: boolean;
          stale: boolean;
          owner: string;
          detail?: string;
        }>;
        requests: Array<{
          id: string;
          title: string;
          whyNeeded: string;
          priority: string;
          suggestedOwner: string;
          acknowledged?: boolean;
        }>;
      },
      void
    >({
      query: () => '/agent/capabilities',
      providesTags: ['MlJobs'],
    }),
    ackAgentCapability: builder.mutation<unknown, { id: string }>({
      query: (body) => ({ url: '/agent/capability-requests/ack', method: 'POST', body }),
      invalidatesTags: ['MlJobs', 'AgentSuggestions'],
    }),
    getAgentSuggestions: builder.query<
      {
        suggestions: Array<{
          id: string;
          title: string;
          whyNeeded: string;
          suggestedOwner: string;
          priority: string;
          status: 'open' | 'acknowledged' | 'implementing' | 'completed' | 'failed';
          createdAt: number;
          updatedAt: number;
          acknowledgedAt?: number;
          taskBriefPath?: string;
          cursorAgentId?: string;
          cursorRunId?: string;
          resultSummary?: string;
          lastError?: string;
          progressLog?: string[];
        }>;
        cursorSdk: { configured: boolean; installed: boolean };
      },
      void
    >({
      query: () => '/agent/suggestions',
      providesTags: ['AgentSuggestions'],
    }),
    ackAgentSuggestion: builder.mutation<unknown, { id: string }>({
      query: ({ id }) => ({ url: `/agent/suggestions/${id}/ack`, method: 'POST', body: {} }),
      invalidatesTags: ['AgentSuggestions', 'MlJobs'],
    }),
    implementAgentSuggestion: builder.mutation<
      {
        id: string;
        status: string;
        taskBriefPath?: string;
        resultSummary?: string;
        lastError?: string;
      },
      { id: string }
    >({
      query: ({ id }) => ({
        url: `/agent/suggestions/${id}/implement`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['AgentSuggestions'],
    }),
    getAgentOpportunities: builder.query<
      {
        opportunities: Array<{
          symbol: string;
          decision: string;
          currentPrice: number | null;
          scores: { overall: number; fundamental: number | null; technical: number | null };
          setup: {
            positionSize: number;
            entry: number | null;
            stopLoss: number | null;
            target1: number | null;
          };
          thesis: string;
          recommendationId?: string;
          missingCapabilities: string[];
        }>;
        capabilityRequests: Array<{
          id: string;
          title: string;
          whyNeeded: string;
          priority: string;
        }>;
        disclaimer: string;
      },
      { limit?: number } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 20;
        return `/agent/opportunities?limit=${limit ?? 20}`;
      },
      providesTags: ['AgentOpportunities'],
    }),
    getAgentAnalysis: builder.query<Record<string, unknown>, string>({
      query: (symbol) => `/agent/analysis/${symbol}`,
    }),
    getAgentPositions: builder.query<
      {
        positions: Array<{
          symbol: string;
          quantity: number;
          entryPrice: number;
          currentPrice: number;
          target: number;
          stopLoss: number;
          unrealizedPnl: number;
          policy: string;
          policyNote: string;
        }>;
        killSwitch: boolean;
      },
      void
    >({
      query: () => '/agent/positions',
      providesTags: ['Portfolio', 'AgentOpportunities'],
    }),
    approveAgentRecommendation: builder.mutation<unknown, { id: string; quantity?: number }>({
      query: ({ id, quantity }) => ({
        url: `/agent/recommendations/${id}/approve`,
        method: 'POST',
        body: quantity != null ? { quantity } : {},
      }),
      invalidatesTags: ['Portfolio', 'Trades', 'AgentOpportunities'],
    }),
    notifyAgentBrokerReady: builder.mutation<unknown, { configured: boolean; testOk?: boolean }>({
      query: (body) => ({ url: '/agent/broker-ready', method: 'POST', body }),
    }),
    loginToBroker: builder.mutation<
      { authenticated: boolean; message: string },
      { brokerType: string }
    >({
      query: (body) => ({ url: '/brokers/login', method: 'POST', body }),
      invalidatesTags: ['Portfolio'],
    }),
    logoutFromBroker: builder.mutation<
      { authenticated: boolean; message: string },
      { brokerType: string }
    >({
      query: (body) => ({ url: '/brokers/logout', method: 'POST', body }),
      invalidatesTags: ['Portfolio'],
    }),
  }),
});

export const {
  useGetStocksQuery,
  useGetStockQuery,
  useGetFundamentalsQuery,
  useGetPeerValuationQuery,
  useGetAltDataQuery,
  useIngestFundamentalsMutation,
  useRefreshTechnicalMutation,
  useIngestNewsMutation,
  useIngestSocialMutation,
  useIngestMacroMutation,
  useLazyGetStockQuery,
  useGetIndicesQuery,
  useGetMarketContextQuery,
  useGetScannerQuery,
  useGetCandlesQuery,
  useGetIndexCandlesQuery,
  useGetDepthQuery,
  useGetCompareQuery,
  useGetSignalsQuery,
  useGetSignalsPaginatedQuery,
  useGetSymbolSignalsQuery,
  useGetSupportResistanceQuery,
  useGetSymbolPatternsQuery,
  useGetAllPredictionsQuery,
  useGetPredictionAccuracyQuery,
  useGetPredictionsQuery,
  useGetMlJobQuery,
  useStartMlJobMutation,
  useCancelMlJobMutation,
  useRunBacktestMutation,
  useRunScannerBacktestMutation,
  useGetPortfolioQuery,
  useGetTradesQuery,
  useExecuteTradeMutation,
  useLoginMutation,
  useRegisterMutation,
  useGetBrokerProfileQuery,
  useGetBrokerFundsQuery,
  useGetBrokerPositionsQuery,
  useConfigureBrokerMutation,
  useTestBrokerConnectionMutation,
  useLoginToBrokerMutation,
  useLogoutFromBrokerMutation,
  useGetAgentModeQuery,
  useSetAgentTradingEnabledMutation,
  useSetAgentModeMutation,
  useSetAgentKillSwitchMutation,
  useGetAgentCapabilitiesQuery,
  useAckAgentCapabilityMutation,
  useGetAgentSuggestionsQuery,
  useAckAgentSuggestionMutation,
  useImplementAgentSuggestionMutation,
  useGetAgentOpportunitiesQuery,
  useGetAgentAnalysisQuery,
  useGetAgentPositionsQuery,
  useApproveAgentRecommendationMutation,
  useNotifyAgentBrokerReadyMutation,
} = api;
