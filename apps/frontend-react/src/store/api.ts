import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type {
  ApiResponse,
  AuthTokens,
  AuthUser,
  BacktestResult,
  Candle,
  IndexQuote,
  MarketDepth,
  PortfolioSnapshot,
  RelativeComparison,
  StockQuote,
  SupportResistance,
} from '@stockpred/shared-types';
import { API_BASE_URL } from '../config';
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

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: `${API_BASE_URL}/api`,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.accessToken;
      if (token) headers.set('authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: ['Stocks', 'Signals', 'Portfolio', 'Trades'],
  endpoints: (builder) => ({
    getStocks: builder.query<StockQuote[], void>({
      query: () => '/stocks',
      providesTags: ['Stocks'],
    }),
    getStock: builder.query<StockQuote, string>({
      query: (symbol) => `/stocks/${symbol}`,
    }),
    getIndices: builder.query<IndexQuote[], void>({
      query: () => '/indices',
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
      query: ({ symbol, benchmark = 'NIFTY_MIDCAP_100', window = 60 }) =>
        `/stocks/${symbol}/compare?benchmark=${benchmark}&window=${window}`,
    }),
    getSignals: builder.query<SignalRow[], void>({
      query: () => '/signals',
      transformResponse: unwrap<SignalRow[]>,
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
    getSymbolPatterns: builder.query<{ history: PatternRow[]; current: unknown[] }, string>({
      query: (symbol) => `/patterns/${symbol}`,
      transformResponse: unwrap<{ history: PatternRow[]; current: unknown[] }>,
    }),
    getPredictions: builder.query<PredictionsPayload, string>({
      query: (symbol) => `/predictions/${symbol}`,
      transformResponse: unwrap<PredictionsPayload>,
    }),
    runBacktest: builder.mutation<
      BacktestResult,
      { symbol: string; years: number; initialCapital?: number; riskPerTradePercent?: number }
    >({
      query: (body) => ({ url: '/backtest', method: 'POST', body }),
      transformResponse: unwrap<BacktestResult>,
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
      { symbol: string; side: 'BUY' | 'SELL'; quantity: number }
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
      { connected: boolean; message: string },
      { brokerType: string }
    >({
      query: (body) => ({ url: '/brokers/test', method: 'POST', body }),
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
  useGetIndicesQuery,
  useGetCandlesQuery,
  useGetIndexCandlesQuery,
  useGetDepthQuery,
  useGetCompareQuery,
  useGetSignalsQuery,
  useGetSymbolSignalsQuery,
  useGetSupportResistanceQuery,
  useGetSymbolPatternsQuery,
  useGetPredictionsQuery,
  useRunBacktestMutation,
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
} = api;
