import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type {
  AccessExtensionRequestDto,
  ApiResponse,
  AppView,
  AuthTokens,
  AuthUser,
  BacktestResult,
  BrandSummary,
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
  UserRole,
  UserStatus,
  WaitRecommendation,
  StructuredThesis,
  ExitRecommendation,
  DecisionWithLifecycle,
  TradeLifecycleSnapshot,
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
  | 'ml_backtest'
  | 'ml_lifecycle_full'
  | 'ml_lifecycle_refresh';
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

export type MlModelStatus = 'CANDIDATE' | 'ACTIVE' | 'RETIRED';

export interface MlRegistryModel {
  modelId: string;
  horizon: string;
  modelVersion: string;
  featureVersion: string;
  datasetVersion: string;
  algorithm?: string;
  status: MlModelStatus;
  active: boolean;
  artifactDir?: string | null;
  createdAt?: string;
  promotedAt?: string | null;
  metrics?: Record<string, unknown>;
  calibration?: Record<string, unknown>;
  trainingWindow?: Record<string, unknown>;
}

export interface MlRegistryResponse {
  models: MlRegistryModel[];
  count: number;
  disclaimer?: string;
}

export interface MlRegistryActiveResponse {
  active: Record<string, MlRegistryModel | null>;
  disclaimer?: string;
}

export interface MlOverviewResponse {
  counts: { active: number; candidate: number; retired: number; total: number };
  activeByHorizon: Record<string, MlRegistryModel | null>;
  modelsTrained: boolean;
  currentJob: {
    kind?: string;
    status?: string;
    universe?: string;
    percent?: number;
    stage?: string;
    startedAt?: string | number;
    finishedAt?: string | number | null;
  } | null;
  evaluationsPresent: {
    holdout: boolean;
    walkForward: boolean;
    mlBacktest: boolean;
    datasetQuality?: boolean;
  };
  note?: string;
  disclaimer?: string;
}

export interface MlDatasetQualityReport {
  schemaVersion?: string;
  generatedAt?: string;
  rows?: number;
  nFeatures?: number;
  symbols?: number;
  symbolCoverage?: number;
  timeMin?: number | null;
  timeMax?: number | null;
  missingRate?: number;
  classCounts?: Record<string, number>;
  pitViolations?: number;
  pitMembershipViolations?: number;
  pitExamples?: Array<Record<string, unknown>>;
  pricePolicy?: {
    mode?: string | null;
    version?: string | null;
    unverifiedAdjustment?: boolean;
  };
  thresholds?: Record<string, unknown>;
  hardFailures?: string[];
  warnings?: string[];
  passed?: boolean;
}

export interface MlWalkForwardStability {
  foldCount?: number;
  foldHitRates?: number[];
  meanHitRate?: number | null;
  hitRateStd?: number | null;
  worstFoldHitRate?: number | null;
  thresholds?: Record<string, unknown>;
  passed?: boolean;
  failures?: string[];
}

export interface MlWalkForwardHorizon {
  overallHitRate?: number;
  folds?: Array<Record<string, unknown>>;
  stability?: MlWalkForwardStability;
  [key: string]: unknown;
}

export interface MlEvaluationsResponse {
  holdout: Record<string, unknown>;
  walkForward: {
    universe?: string;
    days?: number;
    horizons?: Record<string, MlWalkForwardHorizon>;
    [key: string]: unknown;
  };
  mlBacktest: Record<string, unknown>;
  datasetQuality: MlDatasetQualityReport;
  present?: {
    holdout: boolean;
    walkForward: boolean;
    mlBacktest: boolean;
    datasetQuality: boolean;
  };
  note?: string;
  disclaimer?: string;
}

export interface MlPromoteResponse {
  model: MlRegistryModel;
  message: string;
  disclaimer?: string;
}

export type MarketIngestMode = 'LIVE_INGEST' | 'EOD_INGEST' | 'HISTORICAL_BACKFILL';
export type MarketQuoteStatus = 'LIVE' | 'DELAYED' | 'CLOSED_MARKET' | 'STALE' | 'UNKNOWN';

/** Ops contract from market-data — informational only; not trade authorization. */
export interface MarketDataContract {
  ingestMode: MarketIngestMode;
  nseCashSessionOpen: boolean;
  quoteStatus: MarketQuoteStatus;
  liveUsable: boolean;
  sampleSymbol: string | null;
  sampleUpdatedAt: number | null;
  note: string;
}

/** M4 drift report per horizon (read-only artifact). */
export interface MlDriftHorizonReport {
  status?: string;
  featureDrift?: Record<string, unknown>;
  calibrationDrift?: Record<string, unknown>;
  outcomeSampleSize?: number;
  reasons?: string[];
  [key: string]: unknown;
}

export interface MlDriftResponse {
  horizons: Record<string, MlDriftHorizonReport>;
  present: Record<string, boolean>;
  note?: string;
  disclaimer?: string;
}

export interface MlReportCatalogItem {
  id: string;
  title: string;
  phase: string;
  artifact: string;
  present: boolean | null;
  detail?: Record<string, unknown>;
  external?: boolean;
  labPath: string;
  blurb: string;
}

/** Phase 5: index of existing M2–M4 report artifacts (presence only). */
export interface MlReportsResponse {
  reports: MlReportCatalogItem[];
  counts: {
    present: number;
    missing: number;
    external: number;
    total: number;
  };
  note?: string;
  disclaimer?: string;
}

export type MlLifecycleStageStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'SKIPPED'
  | 'BLOCKED';

export interface MlLifecycleStage {
  id: string;
  status: MlLifecycleStageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
  exitCode: number | null;
}

export interface MlLifecycleRun {
  runId: string;
  mode: 'full' | 'refresh' | string;
  universe: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  resumeFrom?: string | null;
  stages: MlLifecycleStage[];
  note?: string;
  disclaimer?: string;
}

/** Staged lifecycle orchestration observation (Jobs / control center). */
export interface MlLifecycleLatestResponse {
  run: MlLifecycleRun | null;
  note?: string;
  disclaimer: string;
}

export interface MlTiBridgeSample {
  symbol: string;
  horizon: string;
  direction: string;
  confidence: number;
  expectedMove?: number;
  driftStatus?: string;
  freshnessStatus?: string;
  expiresAt?: string;
  modelId?: string;
  rejectReason?: string;
}

/** Observational ML → Trade Intelligence usability (not trade auth). */
export interface MlTiBridgeResponse {
  total: number;
  usable: number;
  rejected: {
    stale: number;
    incompatible: number;
    missingExpiry: number;
    other: number;
  };
  byHorizon: Record<string, { total: number; usable: number; rejected: number }>;
  usableSamples: MlTiBridgeSample[];
  rejectedSamples: MlTiBridgeSample[];
  note: string;
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
    'Patterns',
    'Portfolio',
    'Trades',
    'MlJobs',
    'MlRegistry',
    'AgentMode',
    'AgentDecisions',
    'AgentRiskBudgets',
    'AgentWalkForward',
    'AgentSoak',
    'AgentOps',
    'AgentSuggestions',
    'AgentOpportunities',
    'IntelligenceBatches',
    'ContinuousIntel',
    'Fundamentals',
    'AltData',
    'AuthUser',
    'Brands',
    'AuthUsers',
    'Extensions',
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
    getMarketDataContract: builder.query<MarketDataContract, void>({
      query: () => '/market/data-contract',
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
      providesTags: (_r, _e, symbol) => [{ type: 'Patterns', id: symbol }],
    }),
    getAllPredictions: builder.query<
      {
        predictions: Array<{
          symbol: string;
          horizon: string;
          direction: string;
          confidence: number;
          expectedMove: number;
          createdAt?: string;
          modelVersion?: string;
          modelId?: string;
          driftStatus?: string;
          calibratedProbabilities?: Record<string, number>;
          expectedReturn?: number | null;
          expectedMfe?: number | null;
          expectedMae?: number | null;
          expiresAt?: string;
          freshnessStatus?: string;
        }>;
        total?: number;
        page?: number;
        limit?: number;
        hasMore?: boolean;
        note?: string;
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
      providesTags: (_r, _e, symbol) => [{ type: 'Predictions', id: symbol }],
    }),
    getMlJob: builder.query<MlJobSnapshot, void>({
      query: () => '/ml/jobs/current',
      providesTags: ['MlJobs'],
    }),
    startMlJob: builder.mutation<
      { job: MlJobRow },
      { kind: MlJobKind; universe?: MlUniverseId; symbols?: string }
    >({
      query: (body) => ({ url: '/ml/jobs', method: 'POST', body }),
      invalidatesTags: ['MlJobs', 'Predictions'],
    }),
    cancelMlJob: builder.mutation<MlJobSnapshot, void>({
      query: () => ({ url: '/ml/jobs/current/cancel', method: 'POST' }),
      invalidatesTags: ['MlJobs'],
    }),
    getMlOverview: builder.query<MlOverviewResponse, void>({
      query: () => '/ml/overview',
      providesTags: ['MlRegistry', 'MlJobs'],
    }),
    getMlEvaluations: builder.query<MlEvaluationsResponse, void>({
      query: () => '/ml/evaluations',
      providesTags: ['MlRegistry', 'MlJobs'],
    }),
    getMlDrift: builder.query<MlDriftResponse, void>({
      query: () => '/ml/drift',
      providesTags: ['MlRegistry', 'Predictions'],
    }),
    getMlReports: builder.query<MlReportsResponse, void>({
      query: () => '/ml/reports',
      providesTags: ['MlRegistry', 'MlJobs', 'Predictions'],
    }),
    getMlLifecycleLatest: builder.query<MlLifecycleLatestResponse, void>({
      query: () => '/ml/lifecycle/latest',
      providesTags: ['MlJobs'],
    }),
    getMlTiBridge: builder.query<MlTiBridgeResponse, void>({
      query: () => '/market/ml-ti-bridge',
      providesTags: ['Predictions'],
    }),
    getMlRegistry: builder.query<MlRegistryResponse, { horizon?: string; status?: string } | void>({
      query: (params) => ({
        url: '/ml/registry',
        params: params ?? undefined,
      }),
      providesTags: ['MlRegistry'],
    }),
    getMlRegistryActive: builder.query<MlRegistryActiveResponse, void>({
      query: () => '/ml/registry/active',
      providesTags: ['MlRegistry'],
    }),
    promoteMlModel: builder.mutation<MlPromoteResponse, { horizon: string; modelId?: string }>({
      query: (body) => ({ url: '/ml/promote', method: 'POST', body }),
      invalidatesTags: ['MlRegistry', 'MlJobs'],
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
    getMe: builder.query<AuthUser, void>({
      query: () => '/auth/me',
      providesTags: ['AuthUser'],
    }),
    getBrands: builder.query<BrandSummary[], void>({
      query: () => '/auth/brands',
      providesTags: ['Brands'],
    }),
    getBrand: builder.query<BrandSummary, string>({
      query: (id) => `/auth/brands/${id}`,
      providesTags: ['Brands'],
    }),
    createBrand: builder.mutation<
      BrandSummary,
      {
        name: string;
        domain: string;
        paperCapital: number;
        adminEmail?: string;
        adminName?: string;
        adminPassword?: string;
        contactEmail?: string;
        notes?: string;
      }
    >({
      query: (body) => ({ url: '/auth/brands', method: 'POST', body }),
      invalidatesTags: ['Brands'],
    }),
    updateBrand: builder.mutation<
      BrandSummary,
      {
        id: string;
        name?: string;
        domain?: string;
        paperCapital?: number;
        contactEmail?: string;
        contactPhone?: string;
        notes?: string;
        status?: string;
      }
    >({
      query: ({ id, ...body }) => ({ url: `/auth/brands/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Brands'],
    }),
    getAuthUsers: builder.query<AuthUser[], string | void>({
      query: (brandId) =>
        brandId ? `/auth/users?brandId=${encodeURIComponent(brandId)}` : '/auth/users',
      providesTags: ['AuthUsers'],
    }),
    createUser: builder.mutation<
      AuthUser,
      {
        email: string;
        name: string;
        password: string;
        role: UserRole;
        brandId?: string;
        allowedViews: AppView[];
        accessExpiresAt?: string;
      }
    >({
      query: (body) => ({ url: '/auth/users', method: 'POST', body }),
      invalidatesTags: ['AuthUsers'],
    }),
    updateUser: builder.mutation<
      AuthUser,
      {
        id: string;
        name?: string;
        allowedViews?: AppView[];
        accessExpiresAt?: string | null;
        status?: UserStatus | string;
      }
    >({
      query: ({ id, ...body }) => ({ url: `/auth/users/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['AuthUsers'],
    }),
    deleteUser: builder.mutation<void, string>({
      query: (id) => ({ url: `/auth/users/${id}`, method: 'DELETE' }),
      invalidatesTags: ['AuthUsers'],
    }),
    getExtensions: builder.query<AccessExtensionRequestDto[], void>({
      query: () => '/auth/extensions',
      providesTags: ['Extensions'],
    }),
    requestExtension: builder.mutation<
      AccessExtensionRequestDto,
      { requestedUntil?: string; days?: number; hours?: number; minutes?: number; notes?: string }
    >({
      query: (body) => ({ url: '/auth/extensions', method: 'POST', body }),
      invalidatesTags: ['Extensions'],
    }),
    reviewExtension: builder.mutation<
      AccessExtensionRequestDto,
      { id: string; decision: 'APPROVED' | 'DENIED'; notes?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/auth/extensions/${id}/review`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Extensions', 'AuthUsers'],
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
    getP5EvidenceUnlock: builder.query<
      {
        unlocked: boolean;
        overallDecision: 'GO' | 'NO-GO' | 'INCONCLUSIVE' | 'UNKNOWN';
        path?: string;
        exists?: boolean;
        generatedAt?: string;
        reason: string;
        reasonCode?: string;
      },
      void
    >({
      query: () => '/agent/p5-evidence-unlock',
      providesTags: ['AgentMode'],
    }),
    getAgentMode: builder.query<
      {
        tradingEnabled: boolean;
        mode: 'RESEARCH' | 'PAPER' | 'LIVE';
        decisionMode: 'APPROVAL' | 'AUTONOMOUS';
        killSwitch: boolean;
        liveArming: {
          armed: boolean;
          blockers: string[];
          brokerConfigured: boolean;
          brokerTestOk: boolean;
        };
        liveAutoArmed: boolean;
        liveAutoEffective: boolean;
        evidenceUnlock: {
          unlocked: boolean;
          overallDecision: 'GO' | 'NO-GO' | 'INCONCLUSIVE' | 'UNKNOWN';
          reason: string;
          reasonCode?: string;
        };
        breakers?: {
          tripped: boolean;
          activeBreakers: string[];
          reasonCodes: string[];
          reasons: string[];
          lastTripAt: number | null;
          lastTripReasonCodes?: string[];
          lastTripReasons?: string[];
          dailyAutoAcceptCount: number;
          consecutiveVetoCount: number;
        };
        scale?: {
          maxSymbolsScanned: number;
          maxOpportunities: number;
          maxAutonomousAcceptsPerCycle: number;
          analysisConcurrency: number;
          strategyTags: string[];
        };
        lastCycleMetrics?: {
          scanMs: number;
          analysisMs: number;
          acceptMs: number;
          symbolsScanned: number;
          opportunitiesBuilt: number;
          autonomousAttempted: number;
          autonomousAccepted: number;
        } | null;
        disclaimer: string;
        riskBudgets?: {
          perTradeRiskPercent: number;
          maxOpenPositions: number;
          maxNameExposurePct: number;
          maxSectorExposurePct: number;
          cashReservePct: number;
          maxPriceDeviationPct: number;
        };
      },
      void
    >({
      query: () => '/agent/mode',
      providesTags: ['AgentMode'],
    }),
    getAgentRiskBudgets: builder.query<
      {
        riskBudgets: {
          perTradeRiskPercent: number;
          maxOpenPositions: number;
          maxNameExposurePct: number;
          maxSectorExposurePct: number;
          cashReservePct: number;
          maxPriceDeviationPct: number;
        };
      },
      void
    >({
      query: () => '/agent/risk-budgets',
      providesTags: ['AgentRiskBudgets'],
    }),
    getAgentWalkForward: builder.query<
      {
        report: {
          schemaVersion: string;
          verdict: {
            technical: 'PASS' | 'FAIL';
            trading: 'STRONG' | 'ACCEPTABLE' | 'REVIEW' | 'FAIL';
            notes: string[];
          };
          funnel: {
            candidates: number;
            autonomousEligible: number;
            autoAccepted: number;
            gatePass: number;
            gateBlocked: number;
            filled: number;
            humanRequired: number;
            riskBlocked: number;
            portfolioBlocked: number;
          };
          grossPerformance: { grossPnl: number; tradeCount: number };
          netPerformance: { netPnl: number; tradeCount: number; feesTotal: number };
        } | null;
        path: string | null;
      },
      void
    >({
      query: () => '/agent/walk-forward',
      providesTags: ['AgentWalkForward'],
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
    setAgentLiveAutoArm: builder.mutation<
      {
        liveAutoArmed: boolean;
        liveAutoEffective: boolean;
        evidence: {
          unlocked: boolean;
          overallDecision: string;
          reason: string;
          reasonCode?: string;
        };
      },
      { armed: boolean; confirmLiveAuto?: string }
    >({
      query: (body) => ({ url: '/agent/live-auto-arm', method: 'POST', body }),
      invalidatesTags: ['AgentMode'],
    }),
    setAgentDecisionMode: builder.mutation<
      { decisionMode: 'APPROVAL' | 'AUTONOMOUS'; note: string },
      { decisionMode: 'APPROVAL' | 'AUTONOMOUS' }
    >({
      query: (body) => ({ url: '/agent/decision-mode', method: 'POST', body }),
      invalidatesTags: ['AgentMode', 'AgentDecisions'],
    }),
    getAgentDecisions: builder.query<
      {
        decisions: DecisionWithLifecycle[];
        decisionMode: 'APPROVAL' | 'AUTONOMOUS';
      },
      { limit?: number; decisionId?: string } | void
    >({
      query: (args) => {
        const params = new URLSearchParams();
        params.set('limit', String(args?.limit ?? 40));
        if (args?.decisionId) params.set('decisionId', args.decisionId);
        return `/agent/decisions?${params.toString()}`;
      },
      providesTags: ['AgentDecisions'],
    }),
    getAgentDecisionLifecycle: builder.query<{ lifecycle: TradeLifecycleSnapshot | null }, string>({
      query: (decisionId) => `/agent/decisions/${encodeURIComponent(decisionId)}/lifecycle`,
      providesTags: ['AgentDecisions'],
    }),
    getAgentSoak: builder.query<
      {
        soak: {
          soakRunId: string;
          state: 'IDLE' | 'RUNNING' | 'PASSED' | 'KILLED' | 'WAIVED';
          startedAt: number;
          endedAt?: number;
          targetDurationMs: number;
          baseline: { equity: number; cash: number; openPositions: number };
          killClass?: string;
          killCode?: string;
          killReason?: string;
          waiveReason?: string;
        } | null;
      },
      void
    >({
      query: () => '/agent/soak',
      providesTags: ['AgentSoak'],
    }),
    startAgentSoak: builder.mutation<unknown, { targetDurationMs?: number } | void>({
      query: (body) => ({ url: '/agent/soak/start', method: 'POST', body: body ?? {} }),
      invalidatesTags: ['AgentSoak', 'AgentOps', 'AgentMode'],
    }),
    stopAgentSoak: builder.mutation<unknown, void>({
      query: () => ({ url: '/agent/soak/stop', method: 'POST', body: {} }),
      invalidatesTags: ['AgentSoak', 'AgentOps'],
    }),
    waiveAgentSoak: builder.mutation<unknown, { reason: string }>({
      query: (body) => ({ url: '/agent/soak/waive', method: 'POST', body }),
      invalidatesTags: ['AgentSoak', 'AgentOps'],
    }),
    getAgentOps: builder.query<
      {
        soakRunId: string | null;
        candidates: number;
        eligible: number;
        riskVeto: number;
        portfolioVeto: number;
        gateVeto: number;
        accepted: number;
        filled: number;
        acceptsPerDay: number;
        circuitTrips: number;
        avgHoldMs: number | null;
        autoGrossPnl: number;
        autoNetPnl: number;
        avgR: number | null;
        medianR: number | null;
        latency: {
          signalToDecisionMs: number | null;
          decisionToSubmitMs: number | null;
          submitToFillMs: number | null;
          decisionToFillMs: number | null;
        };
        health: {
          risk: string;
          execution: string;
          data: string;
          decision: string;
          portfolio: string;
        };
      },
      { soakRunId?: string } | void
    >({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.soakRunId) params.set('soakRunId', args.soakRunId);
        const q = params.toString();
        return q ? `/agent/ops?${q}` : '/agent/ops';
      },
      providesTags: ['AgentOps'],
    }),
    getAgentCalibration: builder.query<
      {
        soakRunId: string | null;
        disclaimer: string;
        byScore: Array<{
          band: string;
          n: number;
          hitRate: number | null;
          avgR: number | null;
          medianR: number | null;
          profitFactor: number | null;
          avgPnlPercent: number | null;
        }>;
        byConfidence: Array<{
          band: string;
          n: number;
          hitRate: number | null;
          avgR: number | null;
          medianR: number | null;
          profitFactor: number | null;
          avgPnlPercent: number | null;
        }>;
      },
      { soakRunId?: string } | void
    >({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.soakRunId) params.set('soakRunId', args.soakRunId);
        const q = params.toString();
        return q ? `/agent/calibration?${q}` : '/agent/calibration';
      },
      providesTags: ['AgentOps'],
    }),
    getAgentSoakCompare: builder.query<
      {
        soakRunId: string | null;
        rows: Array<{
          metric: string;
          walkForward: number | null;
          paperSoak: number | null;
          delta: number | null;
        }>;
      },
      { soakRunId?: string } | void
    >({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.soakRunId) params.set('soakRunId', args.soakRunId);
        const q = params.toString();
        return q ? `/agent/soak/compare?${q}` : '/agent/soak/compare';
      },
      providesTags: ['AgentOps', 'AgentWalkForward'],
    }),
    getAgentSoakReport: builder.query<
      {
        schemaVersion: string;
        soakRunId: string;
        phase4Status: 'PASSED' | 'KILLED' | 'WAIVED';
        startedAt: number;
        endedAt: number;
        durationMs: number;
        killCode?: string;
        killReason?: string;
        waiveReason?: string;
        technicalChecklist: {
          liveAutoNeverArmed: boolean;
          killPathExercisedOrWaived: boolean;
          riskPortfolioGateRespected: boolean;
          outcomesComplete: boolean;
        };
        performance: {
          grossPnl: number;
          netPnl: number;
          avgR: number | null;
        };
      } | null,
      void
    >({
      query: () => '/agent/soak/report',
      providesTags: ['AgentSoak', 'AgentOps'],
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
          status: 'open' | 'brief_ready' | 'acknowledged' | 'implementing' | 'completed' | 'failed';
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
    reopenAgentSuggestion: builder.mutation<unknown, { id: string }>({
      query: ({ id }) => ({ url: `/agent/suggestions/${id}/reopen`, method: 'POST', body: {} }),
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
        /** P5 legacy display rank (may include rankScore — keep for desk sort only). */
        ranked?: Array<{
          opportunityId: string;
          symbol: string;
          rankScore: number;
          quality: number;
          expectedValueR: number;
          signalScore: number;
          quantity: number;
          portfolioFit: string;
        }>;
        /** T1.8 lexicographic shortlist / decision briefing — never authorize. */
        opportunityRanking?: {
          context: {
            tradeHorizon: string;
            strategyTag?: string;
            timestamp: string;
          };
          timestamp: string;
          engineVersion: string;
          calculationVersion: string;
          candidateUniverse: string[];
          noClearWinner: boolean;
          rankings: Array<{
            rank: number;
            symbol: string;
            opportunityId: string;
            dominance: string;
            dataCompleteness: string;
            stale: boolean;
            strengths: Array<{ code: string; message: string }>;
            weaknesses: Array<{ code: string; message: string }>;
            pairwiseReasons: Array<{
              peerSymbol: string;
              polarity: 'ABOVE' | 'BELOW';
              evidence: Array<{ code: string; message: string }>;
            }>;
            dimensions: {
              ev: string;
              rs: string;
              sector: string;
              mtf: string;
              regime: string;
              eventSafety: string;
              technical: string;
              liquidity: string;
              freshness: string;
              portfolioFit: string;
            };
          }>;
        };
        added: Array<{
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
          missingCapabilities?: string[];
          executedAt: number;
          quantity: number;
          status: 'APPROVED' | 'EXECUTED';
        }>;
        capabilityRequests: Array<{
          id: string;
          title: string;
          whyNeeded: string;
          priority: string;
        }>;
        disclaimer: string;
        waitIntelligenceById?: Record<string, WaitRecommendation>;
        thesisIntelligenceById?: Record<string, StructuredThesis>;
        focusBatchId?: string | null;
        opportunityProvenanceById?: Record<
          string,
          {
            discoverySource: 'OFFLINE_PRESELECTED' | 'LIVE_DISCOVERED';
            batchId?: string;
            focusTier?: 1 | 2 | 3;
            liveReady: boolean;
            dataProvenance: {
              dataAsOf: number;
              receivedAt: number;
              analysisAt: number;
              dataAgeMs: number;
              dataStatus: MarketQuoteStatus;
            };
          }
        >;
      },
      { limit?: number } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 20;
        return `/agent/opportunities?limit=${limit ?? 20}`;
      },
      providesTags: ['AgentOpportunities'],
    }),
    getFocusUniverseLatest: builder.query<
      {
        batchId: string;
        generatedAt: number;
        dataAsOf: number;
        source: string;
        dataStatus: string;
        universeSize: number;
        candidates: Array<{ symbol: string; focusTier: 1 | 2 | 3; rank: number }>;
      } | null,
      void
    >({
      query: () => `/agent/focus-universe/latest`,
      providesTags: ['AgentOpportunities'],
    }),
    runOfflineFocusBatch: builder.mutation<
      {
        batchId: string;
        generatedAt: number;
        universeSize: number;
        candidates: Array<{ symbol: string; focusTier: 1 | 2 | 3; rank: number }>;
      },
      { limit?: number } | void
    >({
      query: (arg) => ({
        url: `/agent/focus-universe/run-offline?limit=${arg && 'limit' in arg && arg.limit ? arg.limit : 80}`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['AgentOpportunities'],
    }),
    listIntelligenceBatches: builder.query<
      Array<{
        batchId: string;
        universe: string;
        status: string;
        progress?: {
          processed: number;
          total: number;
          percent: number;
          stages: Array<{ id: string; availability: string; done: number; total: number }>;
        };
        updatedAt: number;
      }>,
      { limit?: number } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 20;
        return `/agent/intelligence-batches?limit=${limit ?? 20}`;
      },
      providesTags: ['IntelligenceBatches'],
    }),
    getIntelligenceBatch: builder.query<
      {
        batchId: string;
        universe: string;
        status: string;
        progress?: {
          processed: number;
          total: number;
          percent: number;
          stages: Array<{ id: string; availability: string; done: number; total: number }>;
        };
        checkpoint?: {
          currentSymbol?: string | null;
          partitionId?: string | null;
          completedSymbols?: string[];
        };
        tasks?: Array<{
          symbol: string;
          status: string;
          partitionId?: string;
          error?: string;
          completedAt?: number;
          startedAt?: number;
          intelligenceContext?: { overallScore?: number; decision?: string };
        }>;
        updatedAt?: number;
      },
      string
    >({
      query: (id) => `/agent/intelligence-batches/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'IntelligenceBatches', id }],
    }),
    getIntelligenceBatchResults: builder.query<
      {
        batchId: string;
        rankings: Array<{
          rank: number;
          symbol: string;
          opportunityId: string;
          companyName?: string;
          exchange?: string;
          identityStatus?: string;
          price?: number;
          intelligenceContext?: Record<string, unknown>;
        }>;
        total: number;
        page: number;
        pageSize: number;
        sort: string;
        order: 'asc' | 'desc';
        defaultSort: 'rank';
        rankingContextVersion: string;
        bullRunAvailable: false;
        preset?: string | null;
        stages?: Array<{
          id: string;
          availability: string;
          done: number;
          total: number;
          unavailableReason?: string;
        }>;
        diagnostics?: {
          ml?: { usable: number; unavailable: number; byReason: Record<string, number> };
          rs?: { usable: number; unavailable: number; byReason: Record<string, number> };
        };
        generatedAt?: number;
        dataAsOf?: number;
        dataStatus?: string;
      },
      {
        id: string;
        page?: number;
        pageSize?: number;
        q?: string;
        preset?: string;
        recommendation?: string;
        thesisState?: string;
        mlAvailable?: boolean;
        sort?: string;
        order?: 'asc' | 'desc';
        targetReturn?: number;
        horizon?: string;
        bullRunConfidence?: string;
        bullRunStage?: string;
        integrityStatus?: string;
        excludeIntegrity?: string;
        executionReady?: boolean;
        dataStatus?: string;
        sector?: string;
      }
    >({
      query: ({ id, ...params }) => ({
        url: `/agent/intelligence-batches/${id}/results`,
        params: {
          page: params.page,
          pageSize: params.pageSize,
          q: params.q || undefined,
          preset: params.preset || undefined,
          recommendation: params.recommendation || undefined,
          thesisState: params.thesisState || undefined,
          mlAvailable: params.mlAvailable ? '1' : undefined,
          sort: params.sort,
          order: params.order,
          targetReturn: params.targetReturn != null ? String(params.targetReturn) : undefined,
          horizon: params.horizon || undefined,
          bullRunConfidence: params.bullRunConfidence || undefined,
          bullRunStage: params.bullRunStage || undefined,
          integrityStatus: params.integrityStatus || undefined,
          excludeIntegrity: params.excludeIntegrity || undefined,
          executionReady:
            params.executionReady === true
              ? 'true'
              : params.executionReady === false
                ? 'false'
                : undefined,
          dataStatus: params.dataStatus || undefined,
          sector: params.sector || undefined,
        },
      }),
      providesTags: (_r, _e, arg) => [{ type: 'IntelligenceBatches', id: arg.id }],
    }),
    createIntelligenceBatch: builder.mutation<
      { batchId: string },
      {
        universe: string;
        symbols?: string[];
        scanKind?: string;
        sector?: string;
        allLimit?: number;
        inverseDownsideThreshold?: number;
        globalEventType?: string;
      }
    >({
      query: (body) => ({ url: '/agent/intelligence-batches', method: 'POST', body }),
      invalidatesTags: ['IntelligenceBatches'],
    }),
    getIntelligenceSectors: builder.query<
      { sectors: Array<{ sector: string; memberCount: number }> },
      void
    >({
      query: () => '/intelligence/sectors',
    }),
    getSectorIntelligence: builder.query<
      {
        status: string;
        state?: string;
        reason?: string;
        sector: string;
        coverageSymbols?: number;
      },
      string
    >({
      query: (sector) => `/intelligence/sectors/${encodeURIComponent(sector)}`,
    }),
    getBullRunIntelligence: builder.query<
      {
        status: string;
        stage?: string;
        reason?: string;
        symbol: string;
        evidence?: string[];
        invalidation?: string[];
        v2?: {
          status?: string;
          dataStatus?: string;
          executionReadyFromBullRun?: boolean;
          cells?: Array<{
            targetReturn: number;
            horizon: string;
            status: string;
            probability?: number | null;
            confidence?: string;
            expectedReturnRange?: { low: number; high: number } | null;
            expectedDrawdownRange?: { low: number; high: number } | null;
            timeToTargetRange?: { lowSessions?: number; highSessions?: number } | null;
            sampleSize?: number | null;
            calibration?: string | null;
            reason?: string;
          }>;
          sampleSize?: number | null;
        };
        cells?: Array<{
          targetReturn: number;
          horizon: string;
          status: string;
          probability?: number | null;
          confidence?: string;
          sampleSize?: number | null;
          calibration?: string | null;
        }>;
      },
      string
    >({
      query: (symbol) => `/intelligence/bull-run/${encodeURIComponent(symbol)}`,
    }),
    getLatestBatchResearchReport: builder.query<
      {
        available: boolean;
        reason?: string;
        missingCapability?: string;
        report?: {
          schemaVersion?: string;
          batchId: string;
          completedAt: number;
          universe: string;
          outcome: string;
          disclaimer: string;
          commandCenterHorizon?: string;
          matrixTargets?: number[];
          coverage: { total: number; processed: number; failed: number };
          marketSummary?: { regime?: string; note?: string; breadth?: string };
          sectorSummary: Array<{
            sector: string;
            state?: string;
            memberCount: number;
            bullCandidates: number;
          }>;
          sectorRotation?: {
            leading: string[];
            improving: string[];
            weakening: string[];
            lagging: string[];
          };
          bullRunCountsByHorizon: Array<{
            horizon: string;
            targetReturn: number;
            candidateCount: number;
          }>;
          bestOpportunities: Array<{
            symbol: string;
            rank: number;
            recommendation?: string;
            tradePlanExecutionReady?: boolean;
            targetReturn?: number;
            horizon?: string;
            probability?: number | null;
            confidence?: string;
            sector?: string;
            tradePlanStatus?: string;
            isBestPick?: boolean;
            integrityStatus?: string;
            bullRunMatrix?: Array<{
              horizon: string;
              cells: Array<{
                targetReturn: number;
                status: string;
                p?: number | null;
                conf?: string;
              }>;
            }>;
            thesis?: string;
            tradePlanExpectedR?: number;
            tradePlanHorizon?: string;
            invalidationPrice?: number;
          }>;
          bestPicks?: Array<{
            symbol: string;
            rank: number;
            recommendation?: string;
            tradePlanExecutionReady?: boolean;
            confidence?: string;
            sector?: string;
            tradePlanStatus?: string;
            isBestPick?: boolean;
            integrityStatus?: string;
            bullRunMatrix?: Array<{
              horizon: string;
              cells: Array<{
                targetReturn: number;
                status: string;
                p?: number | null;
                conf?: string;
              }>;
            }>;
            thesis?: string;
            tradePlanExpectedR?: number;
            tradePlanHorizon?: string;
            invalidationPrice?: number;
          }>;
          bullRunOpportunities?: Array<{
            symbol: string;
            rank: number;
            sector?: string;
            targetReturn: number;
            horizon: string;
            probability: number;
            confidence?: string;
            integrityStatus?: string;
            recommendation?: string;
            tradePlanExecutionReady?: boolean;
            isBestPick?: boolean;
          }>;
          integritySummary?: {
            normal: number;
            investigate: number;
            suspicious: number;
            unknown: number;
          };
          calibrationNote?: string;
          dataQuality: {
            analyzed: number;
            incomplete: number;
            quoteGaps: number;
            fabricated: number;
            insufficientHistory?: number;
          };
          dataStatus?: string;
        };
      },
      { universe?: string } | void
    >({
      query: (arg) => ({
        url: '/agent/intelligence-batches/latest/research-report',
        params: arg && 'universe' in arg ? { universe: arg.universe } : undefined,
      }),
      providesTags: ['IntelligenceBatches'],
    }),
    getBatchResearchReport: builder.query<
      {
        available: boolean;
        reason?: string;
        missingCapability?: string;
        report?: Record<string, unknown>;
      },
      string
    >({
      query: (id) => `/agent/intelligence-batches/${encodeURIComponent(id)}/research-report`,
      providesTags: (_r, _e, id) => [{ type: 'IntelligenceBatches', id }],
    }),
    getIntelligenceBatchResultsBySector: builder.query<
      {
        batchId: string;
        sectors: Array<{
          sector: string;
          memberCount: number;
          bullCandidates: number;
          state?: string;
          rankings: Array<Record<string, unknown>>;
        }>;
        total: number;
        note?: string;
      },
      string
    >({
      query: (id) => `/agent/intelligence-batches/${encodeURIComponent(id)}/results/by-sector`,
      providesTags: (_r, _e, id) => [{ type: 'IntelligenceBatches', id }],
    }),
    getFnoIntelligence: builder.query<{ status: string; reason?: string; symbol: string }, string>({
      query: (symbol) => `/intelligence/fno/${encodeURIComponent(symbol)}`,
    }),
    getCrossAssetIntelligence: builder.query<
      { status: string; reason?: string; left: string; asset: string; pearson?: number | null },
      { symbol: string; asset?: string }
    >({
      query: ({ symbol, asset }) => ({
        url: `/intelligence/cross-asset/${encodeURIComponent(symbol)}`,
        params: asset ? { asset } : undefined,
      }),
    }),
    assessGlobalEvent: builder.mutation<
      {
        event: { status: string; direction?: string; affectedSectors?: unknown[] };
        targetedUniverse: { sectors: string[]; symbols: string[] };
      },
      { eventType?: string; headline?: string; source?: string }
    >({
      query: (body) => ({ url: '/intelligence/global-events', method: 'POST', body }),
    }),
    pauseIntelligenceBatch: builder.mutation<unknown, string>({
      query: (id) => ({
        url: `/agent/intelligence-batches/${id}/pause`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['IntelligenceBatches'],
    }),
    resumeIntelligenceBatch: builder.mutation<unknown, string>({
      query: (id) => ({
        url: `/agent/intelligence-batches/${id}/resume`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['IntelligenceBatches'],
    }),
    cancelIntelligenceBatch: builder.mutation<unknown, string>({
      query: (id) => ({
        url: `/agent/intelligence-batches/${id}/cancel`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: ['IntelligenceBatches'],
    }),
    getContinuousEvents: builder.query<
      Array<{
        eventId: string;
        symbol: string;
        priority: string;
        trigger: string;
        dataStatus: string;
        message: string;
        occurredAt: number;
      }>,
      { limit?: number } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 50;
        return `/agent/continuous/events?limit=${limit ?? 50}`;
      },
      providesTags: ['ContinuousIntel'],
    }),
    getPositionManagementPlans: builder.query<
      Array<{
        positionId: string;
        symbol: string;
        recommendedAction: string;
        recommendation: string;
        reassessmentReason: string;
        thesisState?: string;
        currentPrice: number;
        originalEntry: number;
      }>,
      { limit?: number } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 50;
        return `/agent/continuous/position-plans?limit=${limit ?? 50}`;
      },
      providesTags: ['ContinuousIntel'],
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
          bookKey?: string;
          userId?: string | null;
          brandId?: string | null;
          exitMode?: 'AGENT_POLICY' | 'CLASSIC_STOP_TARGET';
          monitored?: boolean;
          exitIntelligence?: ExitRecommendation;
        }>;
        killSwitch: boolean;
        agentTradingEnabled: boolean;
      },
      void
    >({
      query: () => '/agent/positions',
      providesTags: ['Portfolio', 'AgentOpportunities'],
    }),
    getAgentTransactions: builder.query<
      {
        transactions: Array<{
          id: string;
          symbol: string;
          side: 'BUY' | 'SELL';
          quantity: number;
          price: number;
          entryPrice?: number | null;
          exitPrice?: number | null;
          pnl?: number | null;
          status: string;
          mode: string;
          exitReason?: string | null;
          reason: string;
          explanation: string;
          decision?: string | null;
          stopLoss?: number | null;
          target?: number | null;
          recommendationId?: string | null;
          timestamp: number;
        }>;
        disclaimer: string;
      },
      { limit?: number } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 50;
        return `/agent/transactions?limit=${limit ?? 50}`;
      },
      providesTags: ['Trades', 'AgentOpportunities'],
    }),
    getAgentMonitoringLogs: builder.query<
      {
        events: Array<{
          id: string;
          ts: number;
          symbol: string;
          bookKey: string;
          userId: string | null;
          mode: string;
          action: string;
          policy: string;
          note: string;
          price: number;
          stopLoss: number;
          target: number;
          quantity?: number;
          reason?: string;
        }>;
        meta: {
          agentTradingEnabled: boolean;
          tickSource: string;
          expectedTickIntervalMs: number;
          holdSampleIntervalMs: number;
          lastTickAt: number | null;
          ticksReceived: number;
          ticksLastMinute: number;
          checksLogged: number;
          openLotsHint: number;
        };
        disclaimer: string;
      },
      { limit?: number; symbol?: string } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 80;
        const symbol = arg && 'symbol' in arg ? arg.symbol : undefined;
        const params = new URLSearchParams({ limit: String(limit ?? 80) });
        if (symbol) params.set('symbol', symbol);
        return `/agent/monitoring-logs?${params.toString()}`;
      },
      providesTags: ['Portfolio'],
    }),
    approveAgentRecommendation: builder.mutation<unknown, { id: string; quantity?: number }>({
      query: ({ id, quantity }) => ({
        url: `/agent/recommendations/${id}/approve`,
        method: 'POST',
        body: quantity != null ? { quantity } : {},
      }),
      invalidatesTags: ['Portfolio', 'Trades', 'AgentOpportunities'],
    }),
    waitAgentRecommendation: builder.mutation<unknown, { id: string; reason?: string }>({
      query: ({ id, reason }) => ({
        url: `/agent/recommendations/${id}/wait`,
        method: 'POST',
        body: reason ? { reason } : {},
      }),
      invalidatesTags: ['AgentOpportunities', 'AgentDecisions'],
    }),
    rejectAgentRecommendation: builder.mutation<unknown, { id: string; reason?: string }>({
      query: ({ id, reason }) => ({
        url: `/agent/recommendations/${id}/reject`,
        method: 'POST',
        body: reason ? { reason } : {},
      }),
      invalidatesTags: ['AgentOpportunities', 'AgentDecisions'],
    }),
    getAgentHumanIntelMetrics: builder.query<
      {
        metrics: {
          reviewed: number;
          agreementPct: number;
          overridePct: number;
          waitThenLaterCount: number;
        };
      },
      { limit?: number } | void
    >({
      query: (arg) => {
        const limit = arg && 'limit' in arg ? arg.limit : 500;
        return `/agent/human-intel-metrics?limit=${limit ?? 500}`;
      },
      providesTags: ['AgentDecisions'],
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
  useGetMarketDataContractQuery,
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
  useLazyGetMlJobQuery,
  useStartMlJobMutation,
  useCancelMlJobMutation,
  useGetMlOverviewQuery,
  useGetMlEvaluationsQuery,
  useGetMlDriftQuery,
  useGetMlReportsQuery,
  useGetMlLifecycleLatestQuery,
  useGetMlTiBridgeQuery,
  useGetMlRegistryQuery,
  useGetMlRegistryActiveQuery,
  usePromoteMlModelMutation,
  useRunBacktestMutation,
  useRunScannerBacktestMutation,
  useGetPortfolioQuery,
  useGetTradesQuery,
  useExecuteTradeMutation,
  useLoginMutation,
  useGetMeQuery,
  useGetBrandsQuery,
  useGetBrandQuery,
  useCreateBrandMutation,
  useUpdateBrandMutation,
  useGetAuthUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  useGetExtensionsQuery,
  useRequestExtensionMutation,
  useReviewExtensionMutation,
  useGetBrokerProfileQuery,
  useGetBrokerFundsQuery,
  useGetBrokerPositionsQuery,
  useConfigureBrokerMutation,
  useTestBrokerConnectionMutation,
  useLoginToBrokerMutation,
  useLogoutFromBrokerMutation,
  useGetAgentModeQuery,
  useGetP5EvidenceUnlockQuery,
  useGetAgentRiskBudgetsQuery,
  useGetAgentWalkForwardQuery,
  useSetAgentTradingEnabledMutation,
  useSetAgentModeMutation,
  useSetAgentLiveAutoArmMutation,
  useSetAgentDecisionModeMutation,
  useGetAgentDecisionsQuery,
  useGetAgentDecisionLifecycleQuery,
  useGetAgentSoakQuery,
  useStartAgentSoakMutation,
  useStopAgentSoakMutation,
  useWaiveAgentSoakMutation,
  useGetAgentOpsQuery,
  useGetAgentCalibrationQuery,
  useGetAgentSoakCompareQuery,
  useGetAgentSoakReportQuery,
  useSetAgentKillSwitchMutation,
  useGetAgentCapabilitiesQuery,
  useAckAgentCapabilityMutation,
  useGetAgentSuggestionsQuery,
  useAckAgentSuggestionMutation,
  useReopenAgentSuggestionMutation,
  useImplementAgentSuggestionMutation,
  useGetAgentOpportunitiesQuery,
  useGetFocusUniverseLatestQuery,
  useRunOfflineFocusBatchMutation,
  useListIntelligenceBatchesQuery,
  useGetIntelligenceBatchQuery,
  useGetIntelligenceBatchResultsQuery,
  useCreateIntelligenceBatchMutation,
  useGetIntelligenceSectorsQuery,
  useGetSectorIntelligenceQuery,
  useGetBullRunIntelligenceQuery,
  useGetLatestBatchResearchReportQuery,
  useGetBatchResearchReportQuery,
  useGetIntelligenceBatchResultsBySectorQuery,
  useGetFnoIntelligenceQuery,
  useGetCrossAssetIntelligenceQuery,
  useAssessGlobalEventMutation,
  usePauseIntelligenceBatchMutation,
  useResumeIntelligenceBatchMutation,
  useCancelIntelligenceBatchMutation,
  useGetContinuousEventsQuery,
  useGetPositionManagementPlansQuery,
  useGetAgentAnalysisQuery,
  useGetAgentPositionsQuery,
  useGetAgentTransactionsQuery,
  useGetAgentMonitoringLogsQuery,
  useApproveAgentRecommendationMutation,
  useWaitAgentRecommendationMutation,
  useRejectAgentRecommendationMutation,
  useGetAgentHumanIntelMetricsQuery,
  useNotifyAgentBrokerReadyMutation,
} = api;
