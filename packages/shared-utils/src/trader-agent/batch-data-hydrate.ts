/**
 * Bounded Run Batch hydration. Fetch once, freeze BatchDataSnapshot, analyze many.
 * Workers must not call Binance / EIA / Twelve Data after freeze. CoinGecko HTTP is excluded.
 * Twelve Data is quotes + OHLCV + press_releases — never TD indicator APIs. No Alpha Vantage API key.
 * MCX/CME hydrate only from a validated JSON feed (never HTML scrape). FUTURES_ALL stays unsupported.
 * Commodities hydrate keyless Yahoo+EIA products (TWELVE_DATA_REQUIRES_GROW — no TD commodity endpoints).
 * Phase C evidence (SEC / GDELT / FinBERT / macro) attaches before freeze.
 * F5 on-chain (DefiLlama chain TVL) attaches as snapshot evidence — never quote.price.
 * F6 Reddit/social attaches as snapshot evidence — frozen aliases only, never volume BUY/SELL.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  AssetClass,
  BatchCandle,
  BatchDataSnapshot,
  BatchDerivatives,
  BatchInstrumentData,
  BatchMacroSnapshot,
  BatchQuote,
  BatchSharedData,
  FundamentalPayload,
  InstrumentRef,
  StockQuote,
} from '@stockpred/shared-types';
import {
  BATCH_DATA_SNAPSHOT_VERSION,
  BATCH_MIN_REQUIRED_COVERAGE_PCT,
  Exchange,
  PredictionHorizon,
  sanitizeFundamentalPayload,
} from '@stockpred/shared-types';
import { mapPool } from './throughput-scale';
import { computeBatchDataReadiness } from './batch-data-readiness';
import {
  BATCH_FRESHNESS_POLICY_VERSION,
  BATCH_HYDRATE_CONCURRENCY,
  requiredCapabilitiesForUniverse,
  selectBatchProvider,
  universeForcesNotReady,
} from './batch-data-requirements';
import { annotateSnapshotIdentities } from './batch-identity';
import { buildSnapshotCapabilityCoverage } from './snapshot-capability-coverage';
import { computeLocalTechnicalsFromCandles } from './local-technicals';
import {
  createTwelveDataClientFromEnv,
  hasTwelveDataApiKey,
  mapToTwelveDataSymbol,
  parseTwelveDataTimeSeries,
  TD_CREDIT_EXHAUSTED,
  TWELVE_DATA_API_KEY_MISSING,
  TwelveDataClient,
} from './twelve-data-client';
import {
  attachBatchEvidence,
  shouldAttachPhaseCEvidence,
  defaultEvidenceFetchJson,
  type EvidenceFetchJson,
  type HeadlineScorer,
} from './batch-evidence-attach';
import { overlayNseMdsEvidence, type NseMdsEvidenceInput } from './nse-mds-evidence';
import {
  discoverApprovedFuturesFeed,
  futuresContractIdentity,
  isApprovedFuturesUniverse,
  type ApprovedFuturesContract,
  type ApprovedFuturesFeedResult,
} from './approved-futures-feed';
import {
  COMMODITY_FALLBACK_REASON,
  COMMODITY_PROVIDER,
  commodityProductIdentityError,
  lookupCommodityKeylessSeries,
} from './commodity-keyless-provider';
import {
  isCryptoOnchainAsset,
  loadDefiLlamaChains,
  onchainFromChainMap,
  shouldAttachOnchain,
} from './crypto-onchain-evidence';
import {
  isBitcoinNetworkRef,
  loadDefiLlamaProtocols,
  loadMempoolBtc,
  networkProjectForRef,
  type MempoolBtcSnapshot,
} from './crypto-network-fundamentals';
import {
  loadRedditPosts,
  shouldAttachSocial,
  socialFromPosts,
  unavailableSocial,
  SOCIAL_SCRAPE_FORBIDDEN,
} from './reddit-social-evidence';
import {
  BatchFetchCoordinator,
  BATCH_HOT_PATH_TIMEOUT_MS,
  deepFreeze,
} from './batch-fetch-coordinator';

export { COMMODITY_KEYLESS_MAP } from './commodity-keyless-provider';

const BINANCE_SPOT = 'https://api.binance.com';
const BINANCE_FUTURES = 'https://fapi.binance.com';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
/** Absolute lastFundingRate at or above this is ENGINE_DERIVED fundingExtreme. */
const FUNDING_EXTREME_ABS = 0.0005;

export interface BatchHydrateFetch {
  (url: string): Promise<unknown>;
}

export interface BatchHydrateDeps {
  fetchJson?: BatchHydrateFetch;
  fetchNseQuote?: (symbol: string) => Promise<StockQuote | null | undefined>;
  fetchNseCandles?: (symbol: string) => Promise<BatchCandle[] | null | undefined>;
  eiaSeries?: Record<string, Array<{ t: number; v: number }>>;
  eiaBulkDir?: string;
  now?: () => number;
  minCoveragePct?: number;
  concurrency?: number;
  twelveDataClient?: TwelveDataClient;
  twelveDataApiKey?: string;
  evidenceFetchJson?: EvidenceFetchJson;
  scoreHeadline?: HeadlineScorer;
  macroSnapshot?: BatchMacroSnapshot;
  skipEvidence?: boolean;
  approvedFuturesFeedUrl?: string;
  approvedFuturesFeedBody?: string;
  fetchText?: (url: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
  skipOnchain?: boolean;
  onchainBody?: string;
  onchainFetchJson?: (url: string) => Promise<unknown>;
  skipNetwork?: boolean;
  networkProtocolsBody?: string;
  networkFetchJson?: (url: string) => Promise<unknown>;
  mempoolSnapshot?: MempoolBtcSnapshot | null;
  skipSocial?: boolean;
  socialBody?: string;
  socialFetchJson?: (url: string) => Promise<unknown>;
  /** Called as hydrate/evidence rows finish. UI progress only — not readiness math. */
  onHydrateProgress?: (done: number, total: number) => void;
  coordinator?: BatchFetchCoordinator;
  shared?: BatchSharedData;
  /** Preloaded MDS panels. Omitted = no overlay. Present even when empty = overlay + reasons. */
  nseMdsEvidence?: NseMdsEvidenceInput;
}

export interface HydrateBatchInput {
  batchId: string;
  universeId: string;
  universeVersion?: string;
  instruments: InstrumentRef[];
  eligible?: number;
  deps?: BatchHydrateDeps;
}

function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function positive(v: unknown): number | undefined {
  const n = asNum(v);
  return n != null && n > 0 ? n : undefined;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  if (/coingecko\.com/i.test(url)) throw new Error('COINGECKO_EXCLUDED');
  const once = async (): Promise<unknown> => {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'stockpred-batch-hydrate/1.0' },
      signal: AbortSignal.timeout(BATCH_HOT_PATH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  try {
    return await once();
  } catch {
    return await once();
  }
}

function wrapExternalFetch(
  coordinator: BatchFetchCoordinator,
  fetchJson: BatchHydrateFetch,
): BatchHydrateFetch {
  return (url: string) => coordinator.resolve(`http:${url}`, () => fetchJson(url), 'external');
}

function indexBySymbol<T extends { symbol?: string }>(rows: T[] | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows ?? []) {
    const symbol = String(row.symbol ?? '').toUpperCase();
    if (symbol) map.set(symbol, row);
  }
  return map;
}

function parseKlines(raw: unknown): BatchCandle[] {
  if (!Array.isArray(raw)) return [];
  const out: BatchCandle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = asNum(row[0]);
    const open = asNum(row[1]);
    const high = asNum(row[2]);
    const low = asNum(row[3]);
    const close = asNum(row[4]);
    const volume = asNum(row[5]);
    if (time == null || open == null || high == null || low == null || close == null) continue;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

function parseYahooChart(raw: unknown): { quote?: BatchQuote; candles: BatchCandle[] } {
  const result = (raw as { chart?: { result?: Array<Record<string, unknown>> } })?.chart
    ?.result?.[0];
  if (!result) return { candles: [] };
  const ts = Array.isArray(result.timestamp) ? (result.timestamp as number[]) : [];
  const quoteNode = (result.indicators as { quote?: Array<Record<string, unknown[]>> } | undefined)
    ?.quote?.[0];
  const meta = result.meta as { regularMarketPrice?: number } | undefined;
  const candles: BatchCandle[] = [];
  if (quoteNode) {
    const opens = quoteNode.open ?? [];
    const highs = quoteNode.high ?? [];
    const lows = quoteNode.low ?? [];
    const closes = quoteNode.close ?? [];
    const volumes = quoteNode.volume ?? [];
    for (let i = 0; i < ts.length; i += 1) {
      const open = asNum(opens[i]);
      const high = asNum(highs[i]);
      const low = asNum(lows[i]);
      const close = asNum(closes[i]);
      if (open == null || high == null || low == null || close == null) continue;
      candles.push({
        time: Number(ts[i]) * 1000,
        open,
        high,
        low,
        close,
        volume: asNum(volumes[i]),
      });
    }
  }
  const last = candles[candles.length - 1];
  const price = positive(meta?.regularMarketPrice) ?? positive(last?.close);
  return {
    quote: price
      ? {
          price,
          previousClose: last?.close,
          dayHigh: last?.high,
          dayLow: last?.low,
          volume: last?.volume,
        }
      : undefined,
    candles,
  };
}

function parseEiaBulk(raw: unknown): Array<{ t: number; v: number }> {
  if (!raw || typeof raw !== 'object') return [];
  const rec = raw as Record<string, unknown>;
  const series = Array.isArray(rec.data)
    ? rec.data
    : Array.isArray(rec.series)
      ? (rec.series as Array<{ data?: unknown[] }>)[0]?.data
      : undefined;
  if (!Array.isArray(series)) return [];
  const out: Array<{ t: number; v: number }> = [];
  for (const row of series) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const rawT = row[0];
    const v = asNum(row[1]);
    if (v == null || v <= 0) continue;
    const t =
      typeof rawT === 'number'
        ? rawT
        : Date.parse(
            String(rawT).length === 8
              ? `${String(rawT).slice(0, 4)}-${String(rawT).slice(4, 6)}-${String(rawT).slice(6, 8)}`
              : String(rawT),
          );
    if (!Number.isFinite(t)) continue;
    out.push({ t, v });
  }
  return out;
}

function loadEiaSeries(
  seriesId: string,
  deps: BatchHydrateDeps,
): Array<{ t: number; v: number }> | undefined {
  const injected = deps.eiaSeries?.[seriesId]?.filter((row) => row.v > 0);
  if (injected?.length) return injected;
  const dir = deps.eiaBulkDir;
  if (!dir) return undefined;
  const file = join(dir, `${seriesId.replace(/\./g, '_')}.json`);
  if (!existsSync(file)) return undefined;
  try {
    return parseEiaBulk(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

function quoteFromStock(q: StockQuote | null | undefined): BatchQuote | undefined {
  const price = positive(q?.price);
  if (!price || !q) return undefined;
  return {
    price,
    change: asNum(q.change),
    changePercent: asNum(q.changePercent),
    volume: asNum(q.volume),
    dayHigh: asNum(q.dayHigh),
    dayLow: asNum(q.dayLow),
    previousClose: asNum(q.previousClose),
    relativeStrengthNifty50:
      typeof q.relativeStrengthNifty50 === 'number' ? q.relativeStrengthNifty50 : null,
    sector: typeof q.sector === 'string' && q.sector ? q.sector : undefined,
  };
}

function listingSymbol(ref: InstrumentRef): string {
  return String(ref.symbol ?? '')
    .trim()
    .toUpperCase();
}

function perpSourceInstrument(listing: string): string {
  return `BINANCE_FUTURES:${listing}`;
}

function derivativesFromPremium(
  listing: string,
  prem: Record<string, unknown> | undefined,
  extras?: { openInterest?: number },
): BatchDerivatives | undefined {
  if (!prem && extras?.openInterest == null) return undefined;
  const markPrice = positive(prem?.markPrice);
  const indexPrice = positive(prem?.indexPrice);
  const lastFundingRate = asNum(prem?.lastFundingRate);
  const openInterest = extras?.openInterest;
  if (markPrice == null && indexPrice == null && lastFundingRate == null && openInterest == null) {
    return undefined;
  }
  const missing: string[] = [];
  if (markPrice == null) missing.push('markPrice');
  if (indexPrice == null) missing.push('indexPrice');
  if (openInterest == null) missing.push('openInterest');
  if (lastFundingRate == null) missing.push('fundingRate');
  const derivatives: BatchDerivatives = {
    source: 'SOURCE_REPORTED',
    sourceInstrument: perpSourceInstrument(listing),
    contractType: 'PERPETUAL',
    ...(markPrice != null ? { markPrice } : {}),
    ...(indexPrice != null ? { indexPrice } : {}),
    ...(openInterest != null ? { openInterest } : {}),
    ...(lastFundingRate != null ? { lastFundingRate } : {}),
    ...(missing.length ? { missing } : {}),
  };
  if (markPrice != null && indexPrice != null) {
    derivatives.basis = markPrice - indexPrice;
    derivatives.source = 'ENGINE_DERIVED';
    const rel = Math.abs(derivatives.basis) / indexPrice;
    if (rel >= 0.002) derivatives.basisExpansion = true;
    else if (rel <= 0.0002) derivatives.basisCompression = true;
  }
  if (lastFundingRate != null && Math.abs(lastFundingRate) >= FUNDING_EXTREME_ABS) {
    derivatives.fundingExtreme = true;
    derivatives.source = 'ENGINE_DERIVED';
  }
  return derivatives;
}

function unavailable(
  ref: InstrumentRef,
  reasonCode: string,
  message: string,
  extras: Partial<BatchInstrumentData> = {},
): BatchInstrumentData {
  return {
    instrumentRef: ref,
    dataStatus: 'UNAVAILABLE',
    reasonCode,
    message,
    ...extras,
  };
}

async function hydrateCryptoFutures(
  instruments: InstrumentRef[],
  fetchJson: BatchHydrateFetch,
  concurrency: number,
  now: number,
): Promise<BatchInstrumentData[]> {
  const [tickers, premium] = await Promise.all([
    fetchJson(`${BINANCE_FUTURES}/fapi/v1/ticker/24hr`).catch(() => []),
    fetchJson(`${BINANCE_FUTURES}/fapi/v1/premiumIndex`).catch(() => []),
  ]);
  const tickerMap = indexBySymbol(
    Array.isArray(tickers) ? (tickers as Array<{ symbol?: string }>) : [],
  );
  const premiumMap = indexBySymbol(
    Array.isArray(premium) ? (premium as Array<{ symbol?: string }>) : [],
  );

  return mapPool(instruments, concurrency, async (ref) => {
    if (String(ref.venue ?? '').toUpperCase() === 'COINGECKO') {
      return unavailable(ref, 'PROVIDER_MISMATCH', 'Binance never filled from CoinGecko');
    }
    const id = listingSymbol(ref);
    const ticker = tickerMap.get(id) as Record<string, unknown> | undefined;
    const prem = premiumMap.get(id) as Record<string, unknown> | undefined;
    const price = positive(ticker?.lastPrice) ?? positive(prem?.markPrice);
    const markPrice = positive(prem?.markPrice);
    const indexPrice = positive(prem?.indexPrice);
    const lastFundingRate = asNum(prem?.lastFundingRate);

    const [oiRaw, fundingRaw, klinesRaw] = await Promise.all([
      fetchJson(`${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=${encodeURIComponent(id)}`).catch(
        () => null,
      ),
      fetchJson(
        `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=${encodeURIComponent(id)}&limit=1`,
      ).catch(() => null),
      fetchJson(
        `${BINANCE_FUTURES}/fapi/v1/klines?symbol=${encodeURIComponent(id)}&interval=1h&limit=100`,
      ).catch(() => null),
    ]);

    const openInterest = positive((oiRaw as { openInterest?: unknown } | null)?.openInterest);
    const fundingFromHist = Array.isArray(fundingRaw)
      ? asNum((fundingRaw[0] as { fundingRate?: unknown } | undefined)?.fundingRate)
      : undefined;
    const funding = lastFundingRate ?? fundingFromHist;
    const candles = parseKlines(klinesRaw);
    const premWithFunding = {
      ...(prem ?? {}),
      ...(funding != null ? { lastFundingRate: funding } : {}),
    };
    const derivatives =
      derivativesFromPremium(id, premWithFunding, { openInterest }) ??
      ({
        source: 'SOURCE_REPORTED',
        sourceInstrument: perpSourceInstrument(id),
        contractType: 'PERPETUAL',
        missing: ['markPrice', 'indexPrice', 'openInterest', 'fundingRate'],
      } satisfies BatchDerivatives);

    const quote: BatchQuote | undefined = price
      ? {
          price,
          change: asNum(ticker?.priceChange),
          changePercent: asNum(ticker?.priceChangePercent),
          volume: asNum(ticker?.volume),
          dayHigh: asNum(ticker?.highPrice),
          dayLow: asNum(ticker?.lowPrice),
          previousClose: asNum(ticker?.prevClosePrice),
          markPrice,
          indexPrice,
        }
      : undefined;

    const missing = derivatives.missing ?? [];
    let dataStatus: BatchInstrumentData['dataStatus'] = 'AVAILABLE';
    let reasonCode: string | undefined;
    if (!quote) {
      dataStatus = 'UNAVAILABLE';
      reasonCode = 'NO_PROVIDER_DATA';
    } else if (openInterest == null || missing.length) {
      dataStatus = 'PARTIAL';
      reasonCode = 'MISSING_INPUT';
    }

    return {
      instrumentRef: ref,
      ...(quote ? { quote } : {}),
      ...(candles.length ? { candles } : {}),
      derivatives,
      positioning: { status: 'UNAVAILABLE', reasonCode: 'UNVERIFIED_UNTIL_SERIES_VALIDATED' },
      dataStatus,
      dataAsOf: now,
      dataAgeMs: 0,
      provider: 'binance-futures',
      source: 'binance-public-rest',
      seriesProvenance: {
        seriesType: 'INDIVIDUAL_CONTRACT',
        source: 'binance-futures',
        provider: 'binance-futures',
        providerSelectionReason: 'CRYPTO_FUTURES_ALL',
        dataAsOf: now,
      },
      reasonCode,
      message: reasonCode === 'MISSING_INPUT' ? `Missing ${missing.join(',')}` : undefined,
    };
  });
}

async function hydrateCryptoSpotBinance(
  instruments: InstrumentRef[],
  fetchJson: BatchHydrateFetch,
  concurrency: number,
  now: number,
): Promise<BatchInstrumentData[]> {
  const [tickers, premium] = await Promise.all([
    fetchJson(`${BINANCE_SPOT}/api/v3/ticker/24hr`).catch(() => []),
    fetchJson(`${BINANCE_FUTURES}/fapi/v1/premiumIndex`).catch(() => []),
  ]);
  const tickerMap = indexBySymbol(
    Array.isArray(tickers) ? (tickers as Array<{ symbol?: string }>) : [],
  );
  const premiumMap = indexBySymbol(
    Array.isArray(premium) ? (premium as Array<{ symbol?: string }>) : [],
  );
  return mapPool(instruments, concurrency, async (ref) => {
    if (String(ref.venue ?? '').toUpperCase() === 'COINGECKO') {
      return unavailable(
        ref,
        'PROVIDER_MISMATCH',
        'CoinGecko HTTP is excluded from CRYPTO_* hydrate',
      );
    }
    const id = listingSymbol(ref);
    const ticker = tickerMap.get(id) as Record<string, unknown> | undefined;
    const price = positive(ticker?.lastPrice);
    const candles = parseKlines(
      await fetchJson(
        `${BINANCE_SPOT}/api/v3/klines?symbol=${encodeURIComponent(id)}&interval=1h&limit=100`,
      ).catch(() => null),
    );
    if (!price) return unavailable(ref, 'NO_PROVIDER_DATA', 'Not in Binance ticker universe');
    const prem = premiumMap.get(id) as Record<string, unknown> | undefined;
    let derivatives: BatchDerivatives | undefined;
    if (prem) {
      const oiRaw = await fetchJson(
        `${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=${encodeURIComponent(id)}`,
      ).catch(() => null);
      const openInterest = positive((oiRaw as { openInterest?: unknown } | null)?.openInterest);
      derivatives = derivativesFromPremium(id, prem, { openInterest });
    }
    return {
      instrumentRef: ref,
      quote: {
        price,
        change: asNum(ticker?.priceChange),
        changePercent: asNum(ticker?.priceChangePercent),
        volume: asNum(ticker?.volume),
        dayHigh: asNum(ticker?.highPrice),
        dayLow: asNum(ticker?.lowPrice),
        previousClose: asNum(ticker?.prevClosePrice),
      },
      ...(candles.length ? { candles } : {}),
      ...(derivatives ? { derivatives } : {}),
      dataStatus: candles.length ? 'AVAILABLE' : 'PARTIAL',
      dataAsOf: now,
      dataAgeMs: 0,
      provider: 'binance-spot',
      source: 'binance-public-rest',
      seriesProvenance: {
        seriesType: 'SPOT',
        source: 'binance-spot',
        provider: 'binance-spot',
        dataAsOf: now,
      },
      reasonCode: candles.length ? undefined : 'MISSING_INPUT',
    };
  });
}

async function hydrateCommodity(
  instruments: InstrumentRef[],
  fetchJson: BatchHydrateFetch,
  deps: BatchHydrateDeps,
  concurrency: number,
  now: number,
): Promise<BatchInstrumentData[]> {
  return mapPool(instruments, concurrency, async (ref) => {
    const identityError = commodityProductIdentityError(ref);
    if (identityError) {
      return unavailable(ref, 'IDENTITY_MISMATCH', identityError);
    }
    const map = lookupCommodityKeylessSeries(ref);
    if (!map?.yahoo && !map?.eiaSeriesId) {
      return unavailable(ref, 'NO_PROVIDER_DATA', 'No keyless series for this commodity product');
    }
    let quote: BatchQuote | undefined;
    let candles: BatchCandle[] = [];
    if (map.yahoo) {
      const parsed = parseYahooChart(
        await fetchJson(`${YAHOO_CHART}/${map.yahoo}?interval=1d&range=6mo`).catch(() => null),
      );
      quote = parsed.quote;
      candles = parsed.candles;
    }
    const eia = map.eiaSeriesId ? loadEiaSeries(map.eiaSeriesId, deps) : undefined;
    const lastEia = eia?.filter((row) => row.v > 0).at(-1);
    let fundamentals: FundamentalPayload | undefined;
    if (lastEia && map.eiaSeriesId) {
      fundamentals = sanitizeFundamentalPayload(ref.assetClass, {
        kind: 'COMMODITY_ECONOMICS',
        asOf: lastEia.t,
        seriesId: map.eiaSeriesId,
      });
      if (!quote) {
        quote = { price: lastEia.v };
        candles = eia!
          .filter((row) => row.v > 0)
          .map((row) => ({
            time: row.t,
            open: row.v,
            high: row.v,
            low: row.v,
            close: row.v,
          }));
      }
    }
    if (!quote || !positive(quote.price)) {
      return unavailable(ref, 'NO_PROVIDER_DATA', 'Keyless commodity fetch returned no price');
    }
    return {
      instrumentRef: {
        ...ref,
        assetClass: 'COMMODITY',
        contractType: 'PRODUCT',
        underlying: ref.underlying ?? ref.symbol,
      },
      quote,
      ...(candles.length ? { candles } : {}),
      ...(fundamentals ? { fundamentals } : {}),
      dataStatus: 'AVAILABLE',
      dataAsOf: now,
      dataAgeMs: 0,
      provider: COMMODITY_PROVIDER,
      source: map.eiaSeriesId && lastEia ? 'yahoo+eia-bulk' : 'yahoo-keyless',
      seriesProvenance: {
        seriesType: 'SPOT',
        source: 'keyless-commodity',
        provider: COMMODITY_PROVIDER,
        dataAsOf: now,
        fallbackUsed: true,
        providerSelectionReason: COMMODITY_FALLBACK_REASON,
      },
    };
  });
}

async function hydrateNse(
  instruments: InstrumentRef[],
  deps: BatchHydrateDeps,
  concurrency: number,
  now: number,
): Promise<BatchInstrumentData[]> {
  let done = 0;
  const total = instruments.length;
  return mapPool(instruments, concurrency, async (ref) => {
    try {
      const q = await deps.fetchNseQuote?.(ref.symbol);
      const quote = quoteFromStock(q);
      const candles = (await deps.fetchNseCandles?.(ref.symbol)) ?? [];
      if (!quote) {
        return unavailable(ref, 'NO_PROVIDER_DATA', 'MDS quote missing at hydrate time');
      }
      return {
        instrumentRef: ref,
        quote,
        ...(candles.length ? { candles } : {}),
        dataStatus: candles.length ? 'AVAILABLE' : 'PARTIAL',
        dataAsOf: q?.updatedAt ?? now,
        dataAgeMs: Math.max(0, now - (q?.updatedAt ?? now)),
        provider: 'mds',
        source: 'mds-hydrate-copy',
        seriesProvenance: {
          seriesType: 'EQUITY_CASH',
          source: 'mds',
          provider: 'mds',
          dataAsOf: q?.updatedAt ?? now,
        },
      };
    } finally {
      done += 1;
      deps.onHydrateProgress?.(done, total);
    }
  });
}

function attachLocalTechnicals(rows: BatchInstrumentData[]): BatchInstrumentData[] {
  return rows.map((row) => {
    const technicals = computeLocalTechnicalsFromCandles(row.instrumentRef.symbol, row.candles);
    return technicals ? { ...row, technicals } : row;
  });
}

async function hydrateTwelveData(
  instruments: InstrumentRef[],
  client: TwelveDataClient,
  concurrency: number,
  now: number,
): Promise<BatchInstrumentData[]> {
  return mapPool(instruments, concurrency, async (ref) => {
    const frozenRef = ref;
    const tdSymbol = mapToTwelveDataSymbol(frozenRef);
    try {
      const raw = await client.timeSeries(tdSymbol);
      const parsed = parseTwelveDataTimeSeries(raw);
      if (!parsed.quote) {
        return unavailable(
          frozenRef,
          'NO_PROVIDER_DATA',
          'Twelve Data time_series returned no OHLCV',
        );
      }
      return {
        instrumentRef: frozenRef,
        quote: parsed.quote,
        ...(parsed.candles.length ? { candles: parsed.candles } : {}),
        dataStatus: parsed.candles.length ? 'AVAILABLE' : 'PARTIAL',
        dataAsOf: now,
        dataAgeMs: 0,
        provider: 'twelve-data',
        source: 'twelve-data-time-series',
        seriesProvenance: {
          seriesType:
            frozenRef.assetClass === 'FX' || frozenRef.assetClass === 'CRYPTO_SPOT'
              ? 'SPOT'
              : 'EQUITY_CASH',
          source: 'twelve-data',
          provider: 'twelve-data',
          dataAsOf: now,
        },
      };
    } catch (error) {
      const code = error instanceof Error ? error.name || error.message : String(error);
      if (
        code === TD_CREDIT_EXHAUSTED ||
        String((error as Error)?.message) === TD_CREDIT_EXHAUSTED
      ) {
        return unavailable(frozenRef, TD_CREDIT_EXHAUSTED, 'Twelve Data credit budget exhausted');
      }
      return unavailable(
        frozenRef,
        'NO_PROVIDER_DATA',
        error instanceof Error ? error.message : 'Twelve Data time_series failed',
      );
    }
  });
}

function hydrateGated(
  instruments: InstrumentRef[],
  reasonCode: string,
  message: string,
): BatchInstrumentData[] {
  return instruments.map((ref) => unavailable(ref, reasonCode, message));
}

function matchApprovedContract(
  ref: InstrumentRef,
  byId: Map<string, ApprovedFuturesContract>,
  bySymbol: Map<string, ApprovedFuturesContract[]>,
): ApprovedFuturesContract | 'AMBIGUOUS' | undefined {
  const pid = String(ref.providerAssetId ?? '')
    .trim()
    .toUpperCase();
  if (pid && byId.has(pid)) return byId.get(pid);
  const identity = futuresContractIdentity({
    symbol: String(ref.symbol ?? ''),
    venue: ref.venue,
    underlying: ref.underlying,
    contractMonth: ref.contractMonth,
    expiry: ref.expiry,
    contractType: ref.contractType,
  });
  if (identity && byId.has(identity)) return byId.get(identity);
  const hits = bySymbol.get(String(ref.symbol ?? '').toUpperCase()) ?? [];
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return 'AMBIGUOUS';
  return undefined;
}

function hydrateApprovedFutures(
  instruments: InstrumentRef[],
  feed: ApprovedFuturesFeedResult,
  now: number,
): BatchInstrumentData[] {
  const byId = new Map<string, ApprovedFuturesContract>();
  const bySymbol = new Map<string, ApprovedFuturesContract[]>();
  for (const row of feed.contracts) {
    byId.set(row.providerAssetId.toUpperCase(), row);
    const symbol = row.instrumentRef.symbol.toUpperCase();
    const list = bySymbol.get(symbol) ?? [];
    list.push(row);
    bySymbol.set(symbol, list);
  }
  return instruments.map((ref) => {
    const hit = matchApprovedContract(ref, byId, bySymbol);
    if (hit === 'AMBIGUOUS') {
      return unavailable(
        ref,
        'IDENTITY_MISMATCH',
        'Multiple approved-feed contracts share this symbol',
      );
    }
    if (!hit) {
      return unavailable(ref, 'NO_PROVIDER_DATA', 'Contract not present on approved feed');
    }
    const asOf = hit.asOf ?? now;
    if (!hit.quote) {
      return unavailable(ref, 'DATA_INCOMPLETE', 'Approved feed quote missing', {
        candles: hit.candles,
        dataAsOf: asOf,
        provider: 'approved-futures-feed',
        source: 'SOURCE_REPORTED',
      });
    }
    return {
      instrumentRef: {
        ...ref,
        venue: hit.instrumentRef.venue ?? ref.venue,
        quoteCurrency: hit.instrumentRef.quoteCurrency ?? ref.quoteCurrency,
        providerAssetId: hit.providerAssetId ?? ref.providerAssetId,
        underlying: hit.instrumentRef.underlying ?? ref.underlying,
        expiry: hit.instrumentRef.expiry ?? ref.expiry,
        contractMonth: hit.instrumentRef.contractMonth ?? ref.contractMonth,
        contractType: hit.instrumentRef.contractType ?? ref.contractType,
      },
      quote: hit.quote,
      candles: hit.candles,
      dataStatus: hit.delayed ? 'PARTIAL' : 'AVAILABLE',
      dataAsOf: asOf,
      provider: 'approved-futures-feed',
      source: 'SOURCE_REPORTED',
      reasonCode: hit.delayed ? 'DELAYED_FEED' : undefined,
    };
  });
}

export async function hydrateBatchDataSnapshot(
  input: HydrateBatchInput,
): Promise<{ snapshot: BatchDataSnapshot; report: ReturnType<typeof computeBatchDataReadiness> }> {
  const now = input.deps?.now?.() ?? Date.now();
  const deps = input.deps ?? {};
  const wallStart = Date.now();
  const coordinator = deps.coordinator ?? new BatchFetchCoordinator();
  const rawFetch = deps.fetchJson ?? defaultFetchJson;
  const fetchJson = wrapExternalFetch(coordinator, rawFetch);
  const concurrency = Math.max(1, deps.concurrency ?? BATCH_HYDRATE_CONCURRENCY);
  const eligible = input.eligible ?? input.instruments.length;
  const discovered = await discoverApprovedFuturesFeed(input.universeId, {
    approvedFuturesFeedUrl: deps.approvedFuturesFeedUrl,
    approvedFuturesFeedBody: deps.approvedFuturesFeedBody,
    fetchText: deps.fetchText,
    env: deps.env,
    now,
  });
  const feedReady = Boolean(discovered?.ok);
  const forced = universeForcesNotReady(input.universeId, {
    approvedFuturesFeedReady: feedReady,
    feedReasonCode: discovered?.reasonCode,
  });
  const assetClasses = input.instruments.map((row) => row.assetClass) as AssetClass[];
  const required = requiredCapabilitiesForUniverse(input.universeId, assetClasses);
  const tdAvailable = Boolean(
    deps.twelveDataClient || deps.twelveDataApiKey || (hasTwelveDataApiKey() && !deps.fetchJson),
  );
  const selection = selectBatchProvider(input.universeId, input.instruments, {
    twelveDataAvailable: tdAvailable,
    approvedFuturesFeedReady: feedReady,
  });

  let rows: BatchInstrumentData[];
  let tdClient: TwelveDataClient | null = null;
  if (eligible === 0 || input.instruments.length === 0) {
    rows = [];
  } else if (forced) {
    rows = hydrateGated(
      input.instruments,
      forced,
      discovered?.detail ?? 'No approved machine-readable feed',
    );
  } else if (selection.provider === 'approved-futures-feed' && discovered?.ok) {
    rows = hydrateApprovedFutures(input.instruments, discovered, now);
  } else if (selection.provider === 'binance-futures') {
    rows = await hydrateCryptoFutures(input.instruments, fetchJson, concurrency, now);
  } else if (selection.provider === 'binance-spot') {
    rows = await hydrateCryptoSpotBinance(input.instruments, fetchJson, concurrency, now);
  } else if (selection.provider === 'coingecko') {
    rows = hydrateGated(
      input.instruments,
      'PROVIDER_MISMATCH',
      'CoinGecko HTTP is excluded from CRYPTO_* hydrate',
    );
  } else if (selection.provider === 'keyless-commodity+eia-bulk') {
    rows = await hydrateCommodity(input.instruments, fetchJson, deps, concurrency, now);
  } else if (selection.provider === 'twelve-data') {
    tdClient =
      deps.twelveDataClient ??
      (deps.twelveDataApiKey
        ? new TwelveDataClient({ apiKey: deps.twelveDataApiKey, fetchJson })
        : createTwelveDataClientFromEnv(process.env, { fetchJson }));
    if (!tdClient) {
      rows = hydrateGated(
        input.instruments,
        TWELVE_DATA_API_KEY_MISSING,
        'TWELVE_DATA_API_KEY is not set',
      );
    } else {
      rows = await hydrateTwelveData(input.instruments, tdClient, concurrency, now);
    }
  } else if (selection.provider === 'none') {
    rows = hydrateGated(input.instruments, selection.reason, selection.reason);
  } else {
    rows = await hydrateNse(input.instruments, deps, concurrency, now);
  }

  let macro: BatchMacroSnapshot | undefined;
  const skipNonEquityEvidence =
    isApprovedFuturesUniverse(input.universeId) ||
    String(input.universeId ?? '').toUpperCase() === 'FUTURES_ALL' ||
    String(input.universeId ?? '').toUpperCase() === 'COMMODITY_ALL' ||
    String(input.universeId ?? '').toUpperCase() === 'COMMODITIES_CUSTOM';
  if (rows.length > 0 && !skipNonEquityEvidence && shouldAttachPhaseCEvidence(deps)) {
    const evidenceFetch =
      deps.evidenceFetchJson ?? (!deps.fetchJson ? defaultEvidenceFetchJson : undefined);
    const wrappedEvidence = evidenceFetch
      ? wrapExternalFetch(coordinator, evidenceFetch)
      : undefined;
    console.log(
      `[batch-hydrate] ${input.batchId} attaching evidence rows=${rows.length} universe=${input.universeId}`,
    );
    const attached = await attachBatchEvidence(rows, {
      twelveDataClient: tdClient,
      evidenceFetchJson: wrappedEvidence,
      scoreHeadline: deps.scoreHeadline,
      macroSnapshot: deps.macroSnapshot,
      concurrency,
      now,
    });
    rows = attached.rows;
    macro = attached.macro;
    console.log(
      `[batch-hydrate] ${input.batchId} evidence attached universe=${input.universeId} macro=${macro ? 'yes' : 'no'}`,
    );
  }
  if (deps.nseMdsEvidence) {
    rows = overlayNseMdsEvidence(rows, deps.nseMdsEvidence);
    const fundamentalsHit = rows.filter(
      (row) => row.fundamentals?.kind === 'EQUITY_STATEMENTS',
    ).length;
    const newsHit = rows.filter((row) => (row.news?.headlineCount ?? 0) > 0).length;
    console.log(
      `[batch-hydrate] ${input.batchId} nseMdsOverlay fundamentalsHit=${fundamentalsHit} newsHit=${newsHit}` +
        `${deps.nseMdsEvidence.fundamentalsUnavailableReason ? ` fundamentalsUnavailableReason=${deps.nseMdsEvidence.fundamentalsUnavailableReason}` : ''}` +
        `${deps.nseMdsEvidence.newsUnavailableReason ? ` newsUnavailableReason=${deps.nseMdsEvidence.newsUnavailableReason}` : ''}`,
    );
  }
  if (tdClient) tdClient.freeze();

  rows = attachLocalTechnicals(rows);

  const cryptoRows = rows.some((row) => isCryptoOnchainAsset(row.instrumentRef));
  let llamaChains: Map<string, { tvlUsd: number; chain: string }> | undefined;
  if (cryptoRows && shouldAttachOnchain(deps)) {
    const chains = await loadDefiLlamaChains({
      onchainBody: deps.onchainBody,
      onchainFetchJson: deps.onchainFetchJson,
    });
    llamaChains = chains;
    rows = rows.map((row) =>
      isCryptoOnchainAsset(row.instrumentRef)
        ? { ...row, onchain: onchainFromChainMap(row.instrumentRef, chains, now) }
        : row,
    );
  }

  const attachNetwork =
    cryptoRows &&
    !deps.skipNetwork &&
    (shouldAttachOnchain(deps) ||
      deps.networkProtocolsBody != null ||
      Boolean(deps.networkFetchJson) ||
      deps.mempoolSnapshot !== undefined);
  if (attachNetwork) {
    const networkFetch = deps.networkFetchJson ?? (!deps.fetchJson ? defaultFetchJson : undefined);
    const needsMempool = rows.some(
      (row) => isCryptoOnchainAsset(row.instrumentRef) && isBitcoinNetworkRef(row.instrumentRef),
    );
    const mempool =
      deps.mempoolSnapshot !== undefined
        ? deps.mempoolSnapshot
        : needsMempool && networkFetch
          ? await loadMempoolBtc({ fetchJson: networkFetch, now })
          : null;
    const protocols =
      deps.networkProtocolsBody != null || networkFetch
        ? await loadDefiLlamaProtocols({
            body: deps.networkProtocolsBody,
            fetchJson: networkFetch,
          })
        : new Map();
    const chains = llamaChains ?? new Map();
    rows = rows.map((row) => {
      if (!isCryptoOnchainAsset(row.instrumentRef)) return row;
      return {
        ...row,
        fundamentals: sanitizeFundamentalPayload(
          row.instrumentRef.assetClass,
          networkProjectForRef(row.instrumentRef, { mempool, chains, protocols, now }),
        ),
      };
    });
  }

  if (cryptoRows && shouldAttachSocial(deps)) {
    const loaded = await loadRedditPosts({
      socialBody: deps.socialBody,
      socialFetchJson: deps.socialFetchJson,
    });
    rows = await mapPool(rows, concurrency, async (row) =>
      isCryptoOnchainAsset(row.instrumentRef)
        ? {
            ...row,
            social: loaded.scrapeForbidden
              ? unavailableSocial(SOCIAL_SCRAPE_FORBIDDEN, now)
              : await socialFromPosts(row.instrumentRef, loaded.posts, deps.scoreHeadline, now),
          }
        : row,
    );
  }

  const extraReasons = forced ? [forced] : [];
  if (selection.provider === 'none' && !forced) extraReasons.push(selection.reason);
  const report = computeBatchDataReadiness({
    instruments: rows,
    eligible,
    requiredCapabilities: required,
    minRequiredCoveragePct: deps.minCoveragePct ?? BATCH_MIN_REQUIRED_COVERAGE_PCT,
    extraReasons,
  });

  const shared: BatchSharedData = deepFreeze({
    ...(deps.shared ?? {}),
    ...(macro ? { macro } : {}),
    ...(discovered?.session
      ? {
          marketReference: { ...(deps.shared?.marketReference ?? {}), session: discovered.session },
        }
      : {}),
  });
  coordinator.freeze();

  const snapshot: BatchDataSnapshot = annotateSnapshotIdentities({
    schemaVersion: BATCH_DATA_SNAPSHOT_VERSION,
    batchId: input.batchId,
    universeId: input.universeId,
    universeVersion: input.universeVersion,
    provider: selection.provider,
    providerSelectionReason: selection.reason,
    instruments: rows,
    dataAsOf: now,
    createdAt: now,
    coverage: report,
    freshnessPolicyVersion: BATCH_FRESHNESS_POLICY_VERSION,
    dataSnapshotVersion: BATCH_DATA_SNAPSHOT_VERSION,
    frozen: true,
    ...(macro ? { macro } : {}),
    ...(discovered?.session ? { marketSession: discovered.session } : {}),
    shared,
    performance: {
      ...coordinator.metrics(),
      totalTimeMs: Date.now() - wallStart,
      postFreezeProviderRequestCount: 0,
    },
  });
  snapshot.capabilityCoverage = buildSnapshotCapabilityCoverage(snapshot);
  return { snapshot, report };
}

export function quotesMapFromSnapshot(snapshot: BatchDataSnapshot): Map<string, StockQuote> {
  const map = new Map<string, StockQuote>();
  for (const row of snapshot.instruments) {
    const q = batchInstrumentToStockQuote(row);
    if (q) map.set(row.instrumentRef.symbol, q);
  }
  return map;
}

function isIndianCashEquity(ref: { assetClass: string; venue: string }): boolean {
  const assetClass = String(ref.assetClass ?? '').toUpperCase();
  const venue = String(ref.venue ?? '').toUpperCase();
  return (
    (assetClass === 'EQUITY' || assetClass === 'INDEX' || assetClass === 'ETF') &&
    (venue === 'NSE' || venue === 'BSE')
  );
}

function stockQuoteExchangeFromRef(ref: { assetClass: string; venue: string }): string {
  const venue = String(ref.venue ?? '').trim();
  if (isIndianCashEquity(ref) && venue.toUpperCase() === 'NSE') return Exchange.NSE;
  if (isIndianCashEquity(ref) && venue.toUpperCase() === 'BSE') return Exchange.BSE;
  return venue;
}

export function batchInstrumentToStockQuote(row: BatchInstrumentData): StockQuote | undefined {
  const price = positive(row.quote?.price);
  if (!price || !row.quote) return undefined;
  const updatedAt = row.dataAsOf ?? Date.now();
  const venue = String(row.instrumentRef.venue ?? '').trim();
  return {
    symbol: row.instrumentRef.symbol,
    name: row.instrumentRef.symbol,
    exchange: stockQuoteExchangeFromRef(row.instrumentRef),
    venue,
    sector: row.quote.sector ?? '',
    indices: [],
    price,
    change: row.quote.change ?? 0,
    changePercent: row.quote.changePercent ?? 0,
    volume: row.quote.volume ?? 0,
    dayHigh: row.quote.dayHigh ?? price,
    dayLow: row.quote.dayLow ?? price,
    previousClose: row.quote.previousClose ?? price,
    indicators: row.technicals
      ? {
          symbol: row.instrumentRef.symbol,
          time: row.dataAsOf ?? updatedAt,
          rsi: row.technicals.rsi ?? null,
          macd: row.technicals.macd ?? null,
          macdSignal: row.technicals.macdSignal ?? null,
          macdHistogram: row.technicals.macdHistogram ?? null,
          atr: row.technicals.atr ?? null,
          ema20: row.technicals.ema20 ?? null,
          ema50: row.technicals.ema50 ?? null,
          ema200: row.technicals.ema200 ?? null,
          vwap: row.technicals.vwap ?? null,
          bollingerUpper: row.technicals.bollingerUpper ?? null,
          bollingerMiddle: row.technicals.bollingerMiddle ?? null,
          bollingerLower: row.technicals.bollingerLower ?? null,
          avgVolume20: null,
          adx: row.technicals.adx ?? null,
        }
      : null,
    dataSource: 'cached',
    suggestion: 'HOLD',
    horizon: PredictionHorizon.NEXT_DAY,
    entry: null,
    target: null,
    stopLoss: null,
    quantity: 0,
    confidence: 0,
    expectedMove: 0,
    modelVersion: null,
    relativeStrengthNifty50: row.quote.relativeStrengthNifty50 ?? null,
    updatedAt,
    freshnessStatus: 'LIVE',
    liveUsable: true,
  };
}

export function instrumentDataBySymbol(
  snapshot: BatchDataSnapshot,
): Map<string, BatchInstrumentData> {
  const map = new Map<string, BatchInstrumentData>();
  for (const row of snapshot.instruments) {
    map.set(row.instrumentRef.symbol, row);
  }
  return map;
}
