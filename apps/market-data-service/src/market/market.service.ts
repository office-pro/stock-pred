import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  EIA_ENERGY_SERIES,
  getPrismaClient,
  UniverseStock,
  getStockUniverse,
  getUniverseMode,
} from '@stockpred/database';
import {
  KAFKA_TOPICS,
  MarketCandleEvent,
  MarketTickEvent,
  ScannerAlertEvent,
} from '@stockpred/shared-events';
import {
  Candle,
  DepthLevel,
  Exchange,
  IndexQuote,
  IngestMode,
  DataFreshnessStatus,
  ManipulationSnapshot,
  MarketDataSource,
  MarketDepth,
  MarketIndex,
  MarketContext,
  RelativeComparison,
  StockQuote,
  Tick,
  Timeframe,
  TradeSuggestion,
  PredictionHorizon,
} from '@stockpred/shared-types';
import {
  compareToBenchmark,
  composeTradeAdvisory,
  selectBestPicks,
  sortQuotesBy,
  maxProfitAmong,
  isBullRunCandidate,
  expectedProfitPct,
  computeIndicatorSnapshot,
  computeMarketBreadth,
  sampleFromCandles,
  classifyMarketRegime,
  buildBullRunSnapshot,
  buildManipulationSnapshot,
  MANIPULATION_MIN_BARS,
  isBullRunAlert,
  isBearReversalAlert,
  scannerAlertCooldownMs,
  getEnv,
  getEnvNumber,
  round2,
  DEFAULT_PAPER_CAPITAL,
  aggregateCandles,
  classifyQuoteStatus,
  isUsableForLiveTrading,
  resolveActiveIngestMode,
  isNseCashSessionOpen,
  computeCurrentSessionReturn1d,
  sessionReturn1dToPercent,
  buildNseMarketSessionState,
  buildCryptoMarketSessionState,
  buildCommodityMarketSessionState,
  buildMarketsSessionCard,
  sanitizeSessionLiveConsistency,
  COINGECKO_FRESH_QUOTE_MAX_AGE_MS,
  COINGECKO_MAX_QUOTE_AGE_MS,
} from '@stockpred/shared-utils';
import { CandleCache } from './candle-cache';
import {
  BhavQuote,
  loadBhavcopySession,
  loadLatestBhavcopy,
  loadLatestIndexCloses,
  OfficialIndexClose,
  quoteToCandle,
  recentWeekdays,
} from './bhavcopy-quotes';
import { PredictionCache, type CachedMlPrediction } from './prediction-cache';
import { ManipulationCache } from './manipulation-cache';
import { KafkaProducerService } from './kafka.service';
import { IndexState, INTRADAY_BUFFER, SymbolState } from './market-state';
import { MarketDataProvider } from './providers/provider.interface';
import { mulberry32, seedFromSymbol, SimulatedProvider } from './providers/simulated.provider';
import { YahooProvider } from './providers/yahoo.provider';
import { CryptoMarketBook } from './providers/crypto-book';
import { CommodityMarketBook } from './providers/commodity-book';
import {
  configuredCryptoMarketDataProvider,
  normalizeBinanceKlines,
  normalizeBinanceTicker24hr,
  normalizeCoinGeckoMarketChart,
  normalizeCoinGeckoSimplePrice,
} from './providers/crypto-market-data';
import {
  normalizeAlphaVantageCommoditySeries,
  normalizeEiaSeries,
} from './providers/commodity-market-data';
import { RedisService } from './redis.service';
import { RealTimeOrchestrator, getOrchestrator, AnalysisTask } from './real-time-orchestrator';
import { InFlightRequestRegistry } from './in-flight-registry';
import {
  isFreshMemoryQuote,
  MDS_HOT_PATH_TIMEOUT_MS,
  MDS_QUOTE_REDIS_TTL_SECONDS,
  redisCandleKey,
  redisQuoteKey,
} from './quote-freshness';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 2700; // ~10 trading years of calendar days
/** Minimum cached candles considered a usable offline history. */
const MIN_CACHED_CANDLES = 40;
/**
 * Enough real 1D bars to serve batch/detail without waiting on the 10y Yahoo queue.
 * Matches batch historicalCandles AVAILABLE (≥20). Never fabricates bars.
 */
const SERVE_DAILY_MIN_BARS = 20;

const INDEX_CONFIG: { name: MarketIndex; displayName: string; basePrice: number }[] = [
  { name: MarketIndex.NIFTY_50, displayName: 'Nifty 50', basePrice: 24500 },
  { name: MarketIndex.NIFTY_MIDCAP_100, displayName: 'Nifty Midcap 100', basePrice: 57000 },
  {
    name: MarketIndex.NIFTY_SMALLCAP_100,
    displayName: 'Nifty Smallcap 100',
    basePrice: 18500,
  },
  { name: MarketIndex.INDIA_VIX, displayName: 'India VIX', basePrice: 14 },
];

@Injectable()
export class MarketService implements OnModuleInit, OnModuleDestroy {
  private readonly provider: MarketDataProvider;
  /** Set in yahoo mode: enables the real intraday refresh sweep. */
  private readonly yahooProvider: YahooProvider | null;
  /** Separate queue so a viewed symbol is not stuck behind a universe sweep. */
  private readonly onDemandYahoo = new YahooProvider();
  private readonly simulated = new SimulatedProvider();
  private readonly stocks = new Map<string, SymbolState>();
  private readonly cryptoBook = new CryptoMarketBook();
  private readonly commodityBook = new CommodityMarketBook();
  private cryptoRefreshTimer: NodeJS.Timeout | null = null;
  private readonly byIsin = new Map<string, string>();
  private readonly byBseCode = new Map<string, string>();
  private readonly indices = new Map<string, IndexState>();
  private readonly rngs = new Map<string, () => number>();
  private tickTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private liveWatchTimer: NodeJS.Timeout | null = null;
  private predictionTimer: NodeJS.Timeout | null = null;
  private mlRefreshStartupTimer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private readonly tickIntervalMs = getEnvNumber('TICK_INTERVAL_MS', 1000);
  private readonly refreshIntervalMs = getEnvNumber('QUOTE_REFRESH_INTERVAL_MS', 60_000);
  private readonly liveQuoteMinMs = getEnvNumber('LIVE_QUOTE_MIN_MS', 5_000);
  private readonly liveQuoteWaitMs = getEnvNumber('LIVE_QUOTE_WAIT_MS', MDS_HOT_PATH_TIMEOUT_MS);
  private readonly watched = new Map<string, number>();
  private readonly inFlight = new InFlightRequestRegistry();
  private orchestrator: RealTimeOrchestrator | null = null;
  private readonly predictions = new PredictionCache();
  private readonly manipulationScores = new ManipulationCache();
  private readonly paperCapital = getEnvNumber('PAPER_TRADING_CAPITAL', DEFAULT_PAPER_CAPITAL);
  private readonly advisoryMemo = new Map<string, ReturnType<typeof composeTradeAdvisory>>();
  private readonly scannerMemo = new Map<string, ReturnType<typeof buildBullRunSnapshot>>();
  private readonly manipulationMemo = new Map<string, ManipulationSnapshot | null>();
  private contextCache: { key: string; value: MarketContext } | null = null;
  private readonly alertSentAt = new Map<string, { kind: string; at: number; bullScore: number }>();
  private scannerAlertTimer: NodeJS.Timeout | null = null;
  private scannerAlertsRunning = false;
  private readonly hydrateJobs = new Map<string, Promise<void>>();
  private readonly hydrateTried = new Set<string>();
  /** Active ingest mode for this process (LIVE vs EOD). Historical backfill is job-scoped. */
  private readonly ingestMode: IngestMode;

  constructor(
    private readonly kafka: KafkaProducerService,
    private readonly redis: RedisService,
    private readonly cache: CandleCache,
  ) {
    if (getEnv('MARKET_DATA_PROVIDER', 'simulated') === 'yahoo') {
      this.yahooProvider = new YahooProvider();
      this.provider = this.yahooProvider;
    } else {
      this.yahooProvider = null;
      this.provider = this.simulated;
    }
    this.ingestMode = resolveActiveIngestMode({
      liveProviderEnabled: this.yahooProvider != null,
      simulatedLiveFeed: this.yahooProvider == null && getUniverseMode() === 'quick-start',
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const raw = process.env.DATABASE_URL ?? '';
      const qs = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
      const params = new URLSearchParams(qs);
      console.log(
        `[market-data] prisma_pool connection_limit=${params.get('connection_limit') ?? 'default'} ` +
          `pool_timeout=${params.get('pool_timeout') ?? 'default'} schema=${params.get('schema') ?? ''}`,
      );
    } catch {
      console.log('[market-data] prisma_pool connection_limit=unparsed pool_timeout=unparsed');
    }

    const universe = await this.loadUniverse();

    // Initialize orchestrator first (for health checks)
    this.orchestrator = getOrchestrator();
    this.setupOrchestratorListeners();

    // Start live feed immediately (before stocks load) so health checks pass
    if (this.yahooProvider) {
      this.refreshTimer = setInterval(() => void this.refreshRealQuotes(), this.refreshIntervalMs);
      console.log(
        `[market-data] real intraday refresh active (every ${this.refreshIntervalMs / 1000}s)`,
      );
      void this.refreshRealQuotes();
    } else if (getUniverseMode() === 'quick-start') {
      this.tickTimer = setInterval(() => void this.emitTicks(), this.tickIntervalMs);
      console.log(
        `[market-data] simulated live feed started (every ${this.tickIntervalMs}ms) - set MARKET_DATA_PROVIDER=yahoo for real data`,
      );
    } else {
      console.log(
        '[market-data] EOD_INGEST mode: official bhavcopy/index closes, no simulated ticks',
      );
    }
    console.log(
      `[market-data] ingestMode=${this.ingestMode} nseCashSessionOpen=${isNseCashSessionOpen()}`,
    );

    // Register every listed symbol immediately so the UI can paginate the full universe.
    for (const stock of universe) {
      this.registerListed(stock);
    }
    console.log(`[market-data] listed ${universe.length} symbols (candles load in background)`);
    this.initCryptoBooks();
    this.initCommodityBook();

    // Official EOD first (prices on the dashboard), then cache/yahoo history.
    // ML/manipulation refresh is scheduled after startup — not on the hydrate/bootstrap hot path.
    void this.hydrateThenBootstrap(universe);
    this.scheduleDeferredMlRefresh();
    this.predictionTimer = setInterval(() => {
      void this.predictions.refresh().then((count) => {
        if (count > 0) this.advisoryMemo.clear();
      });
      void this.manipulationScores.refresh().then((count) => {
        if (count > 0) this.manipulationMemo.clear();
      });
    }, 60_000);
    this.scannerAlertTimer = setInterval(() => void this.emitScannerAlerts(), 60_000);
    this.liveWatchTimer = setInterval(() => void this.refreshWatchedLiveQuotes(), 15_000);
    console.log('[market-data] on-demand live quotes: refresh viewed symbols during NSE hours');
  }

  private registerListed(stock: UniverseStock): void {
    if (this.stocks.has(stock.symbol)) return;
    this.stocks.set(stock.symbol, {
      info: {
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        indices: stock.indices,
      },
      daily: [],
      intraday: [],
      currentMinute: null,
      lastTick: null,
      previousClose: stock.basePrice,
      dayVolume: 0,
      indicators: null,
      dataSource: 'listed',
      isin: stock.isin ?? null,
      bseCode: stock.bseCode ?? null,
      yahooSymbol: stock.yahooSymbol ?? null,
    });
    if (stock.isin) this.byIsin.set(stock.isin, stock.symbol);
    if (stock.bseCode) this.byBseCode.set(stock.bseCode, stock.symbol);
  }

  private scheduleDeferredMlRefresh(): void {
    const delayMs = Math.max(0, getEnvNumber('MDS_ML_REFRESH_INITIAL_DELAY_MS', 45_000));
    console.log(
      `[market-data] ml_refresh_scheduled delay_ms=${delayMs} ` +
        `(after EOD hydrate + bootstrap kickoff; not on hot startup path)`,
    );
    this.mlRefreshStartupTimer = setTimeout(() => {
      this.mlRefreshStartupTimer = null;
      void this.predictions.refresh().then((count) => {
        this.advisoryMemo.clear();
        console.log(`[market-data] ML predictions loaded: ${count}`);
      });
      void this.manipulationScores.refresh().then((count) => {
        this.manipulationMemo.clear();
        if (count > 0) console.log(`[market-data] manipulation model scores loaded: ${count}`);
      });
    }, delayMs);
  }

  private async hydrateThenBootstrap(universe: UniverseStock[]): Promise<void> {
    try {
      const [bhav, indexCloses] = await Promise.all([
        loadLatestBhavcopy(),
        loadLatestIndexCloses(),
      ]);
      const applied = this.applyBhavQuotes(bhav);
      this.applyOfficialIndices(indexCloses);
      console.log(
        `[market-data] official EOD applied: ${applied} stock quotes, ${indexCloses.length} indices`,
      );
    } catch (error) {
      console.warn(`[market-data] bhavcopy hydrate failed: ${(error as Error).message}`);
    }
    void this.backfillBhavcopyHistory();
    void this.bootstrapInBackground(universe);
  }

  private async bootstrapInBackground(universe: UniverseStock[]): Promise<void> {
    console.log(
      `[market-data] bootstrapping ${universe.length} symbols in background via "${this.provider.name}" provider...`,
    );

    // Load indices first (required for API queries).
    // REQUIRED_HISTORY = existing compareToBenchmark windowDays (60) — one EOD bar is not enough for RS.
    const REQUIRED_HISTORY = 60;
    await Promise.all(
      INDEX_CONFIG.map(async (index) => {
        const existing = this.indices.get(index.name);
        const dailyLength = existing?.daily.length ?? 0;
        const sufficient =
          !!existing && existing.dataSource !== 'simulated' && dailyLength >= REQUIRED_HISTORY;
        const action = sufficient ? 'SKIP' : 'REFRESH';
        console.log(
          `[INDEX][BOOTSTRAP] symbol=${index.name} existing=${!!existing} ` +
            `dataSource=${existing?.dataSource ?? 'none'} dailyLength=${dailyLength} ` +
            `requiredHistory=${REQUIRED_HISTORY} action=${action}`,
        );
        if (sufficient) {
          return;
        }
        let { candles, source } = await this.loadDaily(index.name, index.basePrice);
        if (candles.length === 0) {
          console.log(
            `[INDEX][BOOTSTRAP][RESULT] symbol=${index.name} dailyLength=0 dataSource=empty ` +
              `oldest= none newest=none providerEmpty=true`,
          );
          if (getUniverseMode() !== 'quick-start') {
            return;
          }
          candles = await this.simulated.getDailyHistory(index.name, HISTORY_DAYS, index.basePrice);
          source = 'simulated';
        }
        const value = candles[candles.length - 1].close;
        const oldest = candles[0]?.time;
        const newest = candles[candles.length - 1]?.time;
        this.indices.set(index.name, {
          name: index.name,
          displayName: index.displayName,
          daily: candles,
          value,
          previousClose: candles[candles.length - 2]?.close ?? value,
          dataSource: source,
        });
        console.log(
          `[INDEX][BOOTSTRAP][RESULT] symbol=${index.name} dailyLength=${candles.length} ` +
            `dataSource=${source} oldest=${oldest ?? 'none'} newest=${newest ?? 'none'}`,
        );
      }),
    );
    console.log(`[market-data] indices loaded (${INDEX_CONFIG.length})`);

    // Bootstrap stocks in batches to avoid overwhelming the provider
    // In yahoo mode, use smaller batches + timeout to fail fast on many invalid tickers
    // Yahoo fetch concurrency stays BATCH_SIZE; CandleCache caps Prisma writes at 2.
    const BATCH_SIZE = this.yahooProvider ? 5 : 10;
    const BATCH_TIMEOUT_MS = this.yahooProvider ? 30_000 : 60_000;
    let loaded = 0;
    let skipped = 0;
    console.log(
      `[market-data] bootstrap_batches yahooConcurrent=${BATCH_SIZE} candleWriteMax=2 ` +
        `batchTimeoutMs=${BATCH_TIMEOUT_MS}`,
    );

    for (let i = 0; i < universe.length; i += BATCH_SIZE) {
      await this.cache.awaitBootstrapCapacity();
      const batch = universe.slice(i, i + BATCH_SIZE);
      try {
        // Each batch has a timeout to prevent hanging on invalid stocks
        await Promise.race([
          Promise.all(batch.map((stock) => this.bootstrapSymbol(stock))),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Batch timeout')), BATCH_TIMEOUT_MS),
          ),
        ]);
        loaded += batch.length;
      } catch (error) {
        // Batch timeout or other error: count as skipped but continue
        skipped += batch.length;
        console.warn(
          `[market-data] batch [${i}-${i + BATCH_SIZE}] failed: ${(error as Error).message}`,
        );
      }
      if ((loaded + skipped) % 50 === 0 || loaded + skipped === universe.length) {
        const wm = this.cache.getWriteMetrics();
        const pressure = this.cache.getPressureSnapshot();
        console.log(
          `[market-data] progress: ${loaded}/${universe.length} loaded, ${skipped} skipped ` +
            `candleWriteActive=${wm.candleWriteActive} candleWriteQueueDepth=${wm.candleWriteQueueDepth} ` +
            `candleWriteCompleted=${wm.candleWriteCompleted} candleWriteFailed=${wm.candleWriteFailed} ` +
            `dbPressure=${pressure.level}`,
        );
      }
    }
    const finalWm = this.cache.getWriteMetrics();
    console.log(
      `[market-data] bootstrap complete: ${loaded}/${universe.length} loaded, ${skipped} skipped ` +
        `candleWriteCompleted=${finalWm.candleWriteCompleted} candleWriteFailed=${finalWm.candleWriteFailed}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.predictionTimer) clearInterval(this.predictionTimer);
    if (this.mlRefreshStartupTimer) clearTimeout(this.mlRefreshStartupTimer);
    if (this.scannerAlertTimer) clearInterval(this.scannerAlertTimer);
    if (this.liveWatchTimer) clearInterval(this.liveWatchTimer);
    if (this.cryptoRefreshTimer) clearInterval(this.cryptoRefreshTimer);
    if (this.orchestrator) {
      await this.orchestrator.shutdown();
    }
  }

  // ---------------------------------------------------------------- queries

  getQuotes(): StockQuote[] {
    return [
      ...this.stocks.values(),
      ...this.cryptoBook.states.values(),
      ...this.commodityBook.states.values(),
    ].map((state) => this.toQuote(state));
  }

  /** In-memory daily candles only — no hydrate (B9–B17 advisory). */
  peekDailyCandles(symbol: string, limit = 300): Candle[] {
    const sym = symbol.toUpperCase();
    const index = this.indices.get(sym);
    if (index) return index.daily.slice(-limit);
    const state = this.stocks.get(sym) ?? this.cryptoBook.get(sym) ?? this.commodityBook.get(sym);
    if (!state) return [];
    return state.daily.slice(-limit);
  }

  /** Lightweight quote with scanner when available — no live refresh. */
  peekQuote(symbol: string): StockQuote | null {
    const state =
      this.stocks.get(symbol.toUpperCase()) ??
      this.cryptoBook.get(symbol) ??
      this.commodityBook.get(symbol);
    if (!state) return null;
    return this.toQuote(state, PredictionHorizon.NEXT_WEEK, true);
  }

  /** Sector membership from loaded universe (advisory). */
  listSectorMembership(): Array<{ symbol: string; sector: string }> {
    const out: Array<{ symbol: string; sector: string }> = [];
    for (const state of this.stocks.values()) {
      out.push({
        symbol: state.info.symbol,
        sector: state.info.sector || 'Unknown',
      });
    }
    return out;
  }

  getQuotesPaginated(
    page: number,
    limit: number,
    search?: string,
    exchange?: string,
    suggestion?: string,
    horizon?: string,
    sort?: string,
  ): {
    data: StockQuote[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    counts: { NSE: number; BSE: number; all: number };
    suggestions: { BUY: number; SELL: number; HOLD: number };
    maxProfitPct: number;
    maxProfitSymbol: string | null;
    bullRunCount: number;
  } {
    const horizonKey =
      horizon?.trim().toUpperCase() === PredictionHorizon.NEXT_WEEK
        ? PredictionHorizon.NEXT_WEEK
        : PredictionHorizon.NEXT_DAY;
    const suggestionUpper = suggestion?.trim().toUpperCase();
    const sortKey = (sort?.trim().toLowerCase() || 'all') as
      | 'all'
      | 'profit'
      | 'confidence'
      | 'bull'
      | 'best';
    const bestPickMode = suggestionUpper === 'BEST';
    // Always attach scanner + manipulation so dashboard/predictions can show Risk / Suspicious.
    let quotes = [...this.stocks.values()].map((state) => this.toQuote(state, horizonKey, true));
    const exchangeUpper = exchange?.trim().toUpperCase();
    if (exchangeUpper === 'CRYPTO' || exchangeUpper === 'BINANCE') {
      quotes = [...this.cryptoBook.states.values()].map((state) =>
        this.toQuote(state, horizonKey, true),
      );
    } else if (exchangeUpper === 'COMMODITY' || exchangeUpper === 'COMMODITIES') {
      quotes = [...this.commodityBook.states.values()].map((state) =>
        this.toQuote(state, horizonKey, true),
      );
    }
    const counts = {
      NSE: quotes.filter((q) => q.exchange === Exchange.NSE).length,
      BSE: quotes.filter((q) => q.exchange === Exchange.BSE).length,
      all: quotes.length,
    };

    if (exchangeUpper === Exchange.NSE || exchangeUpper === Exchange.BSE) {
      quotes = quotes.filter((q) => q.exchange === exchangeUpper);
    }

    if (search) {
      const searchUpper = search.toUpperCase();
      quotes = quotes.filter(
        (q) => q.symbol.includes(searchUpper) || q.name.toUpperCase().includes(searchUpper),
      );
    }

    const suggestions = {
      BUY: quotes.filter((q) => q.suggestion === 'BUY').length,
      SELL: quotes.filter((q) => q.suggestion === 'SELL').length,
      HOLD: quotes.filter((q) => q.suggestion === 'HOLD').length,
    };

    if (bestPickMode) {
      quotes = selectBestPicks(quotes);
      suggestions.BUY = quotes.filter((q) => q.suggestion === 'BUY').length;
      suggestions.SELL = quotes.filter((q) => q.suggestion === 'SELL').length;
      suggestions.HOLD = 0;
    } else if (
      suggestionUpper === 'BUY' ||
      suggestionUpper === 'SELL' ||
      suggestionUpper === 'HOLD'
    ) {
      quotes = quotes.filter((q) => q.suggestion === suggestionUpper);
    } else if (suggestionUpper === 'ACTIONABLE') {
      quotes = quotes.filter((q) => q.suggestion === 'BUY' || q.suggestion === 'SELL');
    }

    if (sortKey === 'bull') {
      quotes = quotes.filter((q) => isBullRunCandidate(q.scanner));
      quotes.sort(
        (a, b) =>
          (b.scanner?.bullScore ?? 0) - (a.scanner?.bullScore ?? 0) ||
          expectedProfitPct(b) - expectedProfitPct(a) ||
          a.symbol.localeCompare(b.symbol),
      );
    } else if (sortKey === 'profit' || sortKey === 'confidence' || sortKey === 'best') {
      quotes = sortQuotesBy(quotes, sortKey);
    } else if (bestPickMode) {
      quotes = sortQuotesBy(quotes, 'best');
    } else if (suggestionUpper === 'ACTIONABLE') {
      quotes = sortQuotesBy(quotes, 'confidence');
    } else {
      quotes = sortQuotesBy(quotes, 'all');
    }

    const maxProfit = maxProfitAmong(quotes);
    const bullRunCount = quotes.filter((q) => isBullRunCandidate(q.scanner)).length;
    const total = quotes.length;
    const start = (page - 1) * limit;
    const data = quotes.slice(start, start + limit);
    const hasMore = start + limit < total;

    return {
      data,
      total,
      page,
      limit,
      hasMore,
      counts,
      suggestions,
      maxProfitPct: round2(maxProfit.pct),
      maxProfitSymbol: maxProfit.symbol,
      bullRunCount,
    };
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const state = this.requireSymbol(symbol);
    this.watched.set(state.info.symbol, Date.now());
    if (this.isCommodityState(state)) {
      await this.refreshCommodityOnDemand(state.info.symbol);
    } else if (this.isCryptoState(state) && configuredCryptoMarketDataProvider() === 'coingecko') {
      const row = this.cryptoBook.rows.get(state.info.symbol);
      await this.refreshCoinGeckoOnDemand(row?.providerAssetId ?? state.info.symbol);
    } else if (!this.isCryptoState(state)) {
      if (this.isMemoryQuoteFresh(state)) {
        return this.toQuote(state, PredictionHorizon.NEXT_WEEK, true);
      }
      return this.inFlight.coalesce(`quote:${state.info.symbol}`, async () => {
        if (this.isMemoryQuoteFresh(state)) {
          return this.toQuote(state, PredictionHorizon.NEXT_WEEK, true);
        }
        const cached = await this.redis.getJson<StockQuote>(redisQuoteKey(state.info.symbol));
        if (cached && cached.price > 0) {
          this.applyCachedQuote(state, cached);
          return this.toQuote(state, PredictionHorizon.NEXT_WEEK, true);
        }
        await Promise.race([
          this.refreshSymbolLive(state),
          new Promise<void>((resolve) => setTimeout(resolve, this.liveQuoteWaitMs)),
        ]);
        return this.toQuote(state, PredictionHorizon.NEXT_WEEK, true);
      });
    }
    return this.toQuote(state, PredictionHorizon.NEXT_WEEK, true);
  }

  async getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const index = this.indices.get(symbol);
    if (index) {
      return timeframe === Timeframe.ONE_DAY ? index.daily.slice(-limit) : [];
    }
    const existing = this.stocks.get(symbol);
    if (!existing) throw new NotFoundException(`Unknown symbol: ${symbol}`);
    if (timeframe === Timeframe.ONE_DAY && existing.daily.length >= SERVE_DAILY_MIN_BARS) {
      return existing.daily.slice(-limit);
    }
    return this.inFlight.coalesce(`candles:${symbol}:${timeframe}:${limit}`, async () => {
      const current = this.stocks.get(symbol);
      if (!current) throw new NotFoundException(`Unknown symbol: ${symbol}`);
      if (timeframe === Timeframe.ONE_DAY && current.daily.length >= SERVE_DAILY_MIN_BARS) {
        return current.daily.slice(-limit);
      }
      const redisKey = redisCandleKey(symbol, timeframe, limit);
      const fromRedis = await this.redis.getJson<Candle[]>(redisKey);
      if (Array.isArray(fromRedis) && fromRedis.length > 0) {
        if (timeframe === Timeframe.ONE_DAY && current.daily.length < fromRedis.length) {
          current.daily = fromRedis;
        }
        return fromRedis.slice(-limit);
      }
      await this.ensureLoaded(symbol);
      const state = this.requireSymbol(symbol);
      let candles: Candle[];
      if (timeframe === Timeframe.ONE_DAY) {
        candles = state.daily.slice(-limit);
      } else {
        const ones = this.intradayOnes(state);
        candles =
          timeframe === Timeframe.ONE_MINUTE
            ? ones.slice(-limit)
            : aggregateCandles(ones, timeframe).slice(-limit);
      }
      if (candles.length > 0) {
        void this.redis.setJson(redisKey, candles, MDS_QUOTE_REDIS_TTL_SECONDS);
      }
      return candles;
    });
  }

  /** 1m + aggregated 5m / 15m / 1h packs for short-horizon agent setups. */
  async getMultiTimeframeCandles(
    symbol: string,
    limit: number,
  ): Promise<{
    symbol: string;
    '1m': Candle[];
    '5m': Candle[];
    '15m': Candle[];
    '1h': Candle[];
  }> {
    await this.ensureLoaded(symbol);
    const state = this.requireSymbol(symbol);
    const ones = this.intradayOnes(state);
    const capped = Math.min(Math.max(limit, 1), 5000);
    return {
      symbol: state.info.symbol,
      '1m': ones.slice(-capped),
      '5m': aggregateCandles(ones, Timeframe.FIVE_MINUTES).slice(-capped),
      '15m': aggregateCandles(ones, Timeframe.FIFTEEN_MINUTES).slice(-capped),
      '1h': aggregateCandles(ones, Timeframe.ONE_HOUR).slice(-capped),
    };
  }

  private intradayOnes(state: SymbolState): Candle[] {
    const ones = state.intraday.slice();
    if (state.currentMinute) ones.push(state.currentMinute);
    return ones;
  }

  getDepth(symbol: string): MarketDepth {
    const state = this.requireSymbol(symbol);
    const price = state.lastTick?.price ?? state.previousClose;
    const rng = this.rngFor(`${symbol}:depth`);
    const makeSide = (side: 'bid' | 'ask'): DepthLevel[] =>
      Array.from({ length: 5 }, (_, i) => {
        const offset = (i + 1) * Math.max(0.05, price * 0.0005);
        return {
          price: round2(side === 'bid' ? price - offset : price + offset),
          quantity: Math.floor(rng() * 5000) + 100,
          orders: Math.floor(rng() * 40) + 1,
        };
      });
    return { symbol, bids: makeSide('bid'), asks: makeSide('ask'), time: Date.now() };
  }

  getIndices(): IndexQuote[] {
    return [...this.indices.values()].map((state) => {
      const lastBar = state.daily[state.daily.length - 1];
      return {
        index: state.name as MarketIndex,
        name: state.displayName,
        value: round2(state.value),
        change: round2(state.value - state.previousClose),
        changePercent: round2(((state.value - state.previousClose) / state.previousClose) * 100),
        // Prefer last bar time — Date.now() falsely implies live freshness when EOD-only.
        updatedAt: lastBar?.time ?? 0,
      };
    });
  }

  getMarketContext(): MarketContext {
    return this.marketContext();
  }

  /**
   * Usable ML prediction for Trade Intelligence (fresh + drift-compatible).
   * Prefer NEXT_DAY, then NEXT_WEEK. Observe-only — never trade authorization.
   */
  getUsableMlPrediction(symbol: string, horizon?: string): CachedMlPrediction | null {
    const upper = symbol.toUpperCase();
    // Sample TCS (and explicit horizon lookups) for data-path debugging — never invent.
    const logSample = upper === 'TCS' || upper === 'RELIANCE';
    if (horizon) {
      const { row } = this.predictions.getWithDiagnostics(upper, horizon, new Date(), logSample);
      return row ?? null;
    }
    const day = this.predictions.getWithDiagnostics(
      upper,
      PredictionHorizon.NEXT_DAY,
      new Date(),
      logSample,
    );
    if (day.usable) return day.row ?? null;
    const week = this.predictions.getWithDiagnostics(
      upper,
      PredictionHorizon.NEXT_WEEK,
      new Date(),
      logSample && !day.row,
    );
    return week.row ?? null;
  }

  getScanner(
    page: number,
    limit: number,
    minScore: number,
    sort: string,
    minInvestigate = 0,
  ): {
    data: StockQuote[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    context: MarketContext;
  } {
    const context = this.marketContext();
    const sortKey = sort.trim().toLowerCase();
    const unusualSort = sortKey === 'unusual' || sortKey === 'investigate';
    const rows = [...this.stocks.values()]
      .filter((state) => state.daily.length >= (unusualSort ? MANIPULATION_MIN_BARS : 40))
      .map((state) => this.toQuote(state, PredictionHorizon.NEXT_WEEK, true))
      .filter((q) => {
        if (unusualSort) {
          return (q.manipulation?.investigateIntensity ?? 0) >= (minInvestigate || 40);
        }
        if (!q.scanner || q.scanner.bullScore < minScore) return false;
        return minInvestigate <= 0 || (q.manipulation?.investigateIntensity ?? 0) >= minInvestigate;
      });
    rows.sort((a, b) => {
      const sa = a.scanner;
      const sb = b.scanner;
      if (unusualSort) {
        return (
          (b.manipulation?.investigateIntensity ?? 0) - (a.manipulation?.investigateIntensity ?? 0)
        );
      }
      if (!sa || !sb) return 0;
      if (sortKey === 'up')
        return (sb.forecast?.upProbability ?? 0) - (sa.forecast?.upProbability ?? 0);
      if (sortKey === 'expected20d') {
        return (sb.forecast?.expectedReturn20d ?? 0) - (sa.forecast?.expectedReturn20d ?? 0);
      }
      if (sortKey === 'rs') {
        return (sb.relativeStrengthNifty50 ?? 0) - (sa.relativeStrengthNifty50 ?? 0);
      }
      if (sortKey === 'volume') return (sb.volume.volumeRatio ?? 0) - (sa.volume.volumeRatio ?? 0);
      return sb.bullScore - sa.bullScore;
    });
    const total = rows.length;
    const start = (page - 1) * limit;
    const data = rows.slice(start, start + limit);
    return { data, total, page, limit, hasMore: start + limit < total, context };
  }

  getManipulation(symbol: string): ManipulationSnapshot | null {
    const state = this.requireSymbol(symbol);
    return this.manipulationFor(state);
  }

  compare(symbol: string, benchmark: MarketIndex, windowDays: number): RelativeComparison {
    const state = this.requireSymbol(symbol);
    const benchState = this.indices.get(benchmark);
    if (!benchState) throw new NotFoundException(`Unknown benchmark: ${benchmark}`);
    const result = compareToBenchmark(symbol, benchmark, state.daily, benchState.daily, windowDays);
    if (!result) throw new NotFoundException('Not enough data for comparison');
    return result;
  }

  // ------------------------------------------------------------- data chain

  /**
   * Real-data chain: database cache (bhavcopy / previous Yahoo) when it already
   * has ≥20 bars, else live Yahoo, else listed-with-no-candles. Simulated
   * candles are only used in quick-start mode and are NEVER written to the cache.
   * Cache-first keeps Multi-Asset Batch 1D hydrate off the serialized 10y Yahoo queue.
   */
  private async loadDaily(
    symbol: string,
    basePrice: number,
    opts?: { onDemand?: boolean },
  ): Promise<{ candles: Candle[]; source: MarketDataSource }> {
    const cached = await this.cache.load(symbol, HISTORY_DAYS);
    if (cached.length >= SERVE_DAILY_MIN_BARS) {
      return { candles: cached, source: 'cached' };
    }

    if (this.yahooProvider) {
      try {
        const existing = this.stocks.get(symbol);
        const yahoo = opts?.onDemand ? this.onDemandYahoo : this.yahooProvider;
        const candles = await yahoo.getDailyHistory(symbol, HISTORY_DAYS, basePrice, {
          exchange: existing?.info.exchange,
          bseCode: existing?.bseCode,
          yahooSymbol: existing?.yahooSymbol,
        });
        // Bootstrap = low priority (adaptive pause); on-demand API traffic = high.
        void this.cache.saveHistory(candles, {
          priority: opts?.onDemand ? 'high' : 'low',
        });
        return { candles, source: 'live' };
      } catch (error) {
        console.warn(
          `[market-data] live history failed for ${symbol} (${(error as Error).message}); trying cache`,
        );
      }
    }

    if (cached.length >= 1) {
      return { candles: cached, source: 'cached' };
    }

    if (!this.yahooProvider && getUniverseMode() === 'quick-start') {
      const candles = await this.simulated.getDailyHistory(symbol, HISTORY_DAYS, basePrice);
      return { candles, source: 'simulated' };
    }

    return { candles: [], source: 'listed' };
  }

  private async loadUniverse(): Promise<UniverseStock[]> {
    const configuredUniverse = getStockUniverse();
    try {
      const prisma = getPrismaClient();
      const rows = await prisma.stock.findMany();
      if (rows.length === 0) return configuredUniverse;
      const bySymbol = new Map(configuredUniverse.map((stock) => [stock.symbol, stock]));
      for (const row of rows) {
        const base = bySymbol.get(row.symbol);
        bySymbol.set(row.symbol, {
          symbol: row.symbol,
          name: row.name || base?.name || row.symbol,
          exchange: (row.exchange as Exchange) || base?.exchange,
          sector: row.sector || base?.sector || 'Unknown',
          indices: (row.indices as MarketIndex[]) || base?.indices || [],
          basePrice: base?.basePrice ?? 0,
          isin: row.isin ?? base?.isin ?? null,
          bseCode: row.bseCode ?? base?.bseCode ?? null,
          yahooSymbol: row.yahooSymbol ?? base?.yahooSymbol ?? null,
        });
      }
      return [...bySymbol.values()];
    } catch (error) {
      console.warn(
        `[market-data] database unavailable (${(error as Error).message}); using built-in universe`,
      );
    }
    return configuredUniverse;
  }

  private async bootstrapSymbol(
    stock: UniverseStock,
    opts?: { onDemand?: boolean },
  ): Promise<void> {
    try {
      const { candles, source } = await this.loadDaily(stock.symbol, stock.basePrice, opts);
      const existing = this.stocks.get(stock.symbol);
      if (candles.length === 0) {
        // Keep bhavcopy / listed state instead of wiping it to empty.
        return;
      }
      const merged = new Map<number, Candle>();
      for (const bar of existing?.daily ?? []) merged.set(bar.time, bar);
      for (const bar of candles) {
        if (!merged.has(bar.time)) merged.set(bar.time, bar);
      }
      const daily = [...merged.values()].sort((a, b) => a.time - b.time);
      const last = daily[daily.length - 1];
      const state: SymbolState = {
        info: existing?.info ?? {
          symbol: stock.symbol,
          name: stock.name,
          exchange: stock.exchange,
          sector: stock.sector,
          indices: stock.indices,
        },
        daily,
        intraday: existing?.intraday ?? [],
        currentMinute: existing?.currentMinute ?? null,
        lastTick: existing?.lastTick ?? {
          symbol: stock.symbol,
          exchange: stock.exchange,
          price: last.close,
          volume: last.volume,
          time: last.time,
        },
        previousClose:
          daily.length >= 2 ? daily[daily.length - 2].close : (last?.close ?? stock.basePrice),
        dayVolume: last?.volume ?? 0,
        indicators:
          daily.length >= MIN_CACHED_CANDLES ? computeIndicatorSnapshot(stock.symbol, daily) : null,
        dataSource: existing?.dataSource === 'cached' ? 'cached' : source,
        isin: existing?.isin ?? stock.isin ?? null,
        bseCode: existing?.bseCode ?? stock.bseCode ?? null,
        yahooSymbol: existing?.yahooSymbol ?? stock.yahooSymbol ?? null,
      };
      this.stocks.set(stock.symbol, state);
      this.hydrateTried.add(stock.symbol);
    } catch (error) {
      if (process.env.DEBUG_STOCK_LOAD === 'true') {
        console.warn(`[market-data] failed to load ${stock.symbol}: ${(error as Error).message}`);
      }
    }
  }

  // ------------------------------------------------- real intraday refresh

  /** Sweep the universe for real intraday updates (yahoo mode only). */
  private async refreshRealQuotes(): Promise<void> {
    if (!this.yahooProvider || this.refreshing) return;
    this.refreshing = true;
    try {
      for (const state of this.stocks.values()) {
        try {
          const print = await this.yahooProvider.getTodayPrint(state.info.symbol, {
            exchange: state.info.exchange,
            bseCode: state.bseCode,
            yahooSymbol: state.yahooSymbol,
          });
          if (print) this.applyRealToday(state, print.candle, print.listedAt, print.previousClose);
        } catch {
          /* per-symbol best effort; cache/last state continues to serve */
        }
      }
      for (const index of this.indices.values()) {
        try {
          const print = await this.yahooProvider.getTodayPrint(index.name);
          if (!print) continue;
          const today = print.candle;
          const last = index.daily[index.daily.length - 1];
          if (last && last.time === today.time) {
            index.daily[index.daily.length - 1] = today;
          } else if (!last || today.time > last.time) {
            index.previousClose = last?.close ?? today.close;
            index.daily.push(today);
          }
          index.value = today.close;
          index.dataSource = 'live';
          const tick: Tick = {
            symbol: index.name,
            exchange: Exchange.NSE,
            price: today.close,
            volume: 0,
            time: print.listedAt,
          };
          void this.kafka.publish<MarketTickEvent>(KAFKA_TOPICS.MARKET_TICKS, tick, tick.symbol);
        } catch {
          /* best effort */
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  /** Refresh symbols the UI recently opened (detail page / paper lot). */
  private async refreshWatchedLiveQuotes(): Promise<void> {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [symbol, viewedAt] of [...this.watched.entries()]) {
      if (viewedAt < cutoff) {
        this.watched.delete(symbol);
        continue;
      }
      const state = this.stocks.get(symbol);
      if (state) void this.refreshSymbolLive(state);
    }
  }

  /**
   * P5 Focus handoff: prioritize live refresh for Focus Universe symbols (Tier1→2→3).
   * Optimization only — not trade authorization.
   */
  async prioritizeFocusRefresh(symbols: string[]): Promise<{
    requested: number;
    refreshed: number;
    missing: string[];
  }> {
    const missing: string[] = [];
    let refreshed = 0;
    for (const raw of symbols) {
      const symbol = raw?.trim().toUpperCase();
      if (!symbol) continue;
      const state = this.stocks.get(symbol);
      if (!state) {
        missing.push(symbol);
        continue;
      }
      this.watched.set(state.info.symbol, Date.now());
      await Promise.race([
        this.refreshSymbolLive(state),
        new Promise<void>((resolve) => setTimeout(resolve, this.liveQuoteWaitMs)),
      ]);
      refreshed += 1;
    }
    return { requested: symbols.length, refreshed, missing };
  }

  /**
   * Pull the last listed trade for one symbol while it is on screen.
   * Throttled; concurrent callers share one in-flight Yahoo request.
   */
  private async refreshSymbolLive(state: SymbolState): Promise<void> {
    if (this.isCryptoState(state) || this.isCommodityState(state)) return;
    return this.inFlight.coalesce(`live:${state.info.symbol}`, async () => {
      const now = Date.now();
      if (state.lastLiveRefresh != null && now - state.lastLiveRefresh < this.liveQuoteMinMs) {
        return;
      }
      await this.fetchAndApplyLivePrint(state);
    });
  }

  private async fetchAndApplyLivePrint(state: SymbolState): Promise<void> {
    try {
      const print = await this.onDemandYahoo.getLastTrade(state.info.symbol, {
        exchange: state.info.exchange,
        bseCode: state.bseCode,
        yahooSymbol: state.yahooSymbol,
      });
      if (print) {
        this.applyRealToday(state, print.candle, print.listedAt, print.previousClose);
        state.lastLiveRefresh = Date.now();
        return;
      }
      console.warn(`[market-data] live ${state.info.symbol}: no last trade from Yahoo`);
      state.lastLiveRefresh = Date.now() - Math.floor(this.liveQuoteMinMs / 2);
    } catch (error) {
      console.warn(`[market-data] live ${state.info.symbol}: ${(error as Error).message}`);
      state.lastLiveRefresh = Date.now() - Math.floor(this.liveQuoteMinMs / 2);
    }
  }

  /** Apply a real evolving daily candle: state, indicators, events, cache. */
  private applyRealToday(
    state: SymbolState,
    today: Candle,
    listedAt?: number,
    previousClose?: number,
  ): void {
    const daily = state.daily;
    const last = daily[daily.length - 1];
    const listed = listedAt && listedAt > 0 ? listedAt : (state.lastTick?.time ?? today.time);
    const sameIstDay =
      last != null &&
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(last.time)) ===
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(listed));
    if (last && (last.time === today.time || sameIstDay)) {
      daily[daily.length - 1] = { ...today, time: last.time };
    } else if (!last || today.time > last.time || listed > last.time) {
      state.previousClose = last?.close ?? today.close;
      daily.push(today);
    }
    state.dayVolume = today.volume;
    state.dataSource = 'live';
    if (previousClose && previousClose > 0) {
      state.previousClose = previousClose;
    }
    state.indicators = computeIndicatorSnapshot(state.info.symbol, daily);
    const tick: Tick = {
      symbol: state.info.symbol,
      exchange: state.info.exchange,
      price: today.close,
      volume: today.volume,
      time: listed,
    };
    state.lastTick = tick;
    void this.kafka.publish<MarketTickEvent>(KAFKA_TOPICS.MARKET_TICKS, tick, tick.symbol);
    void this.kafka.publish<MarketCandleEvent>(
      KAFKA_TOPICS.MARKET_CANDLES,
      { candle: today, indicators: state.indicators },
      state.info.symbol,
    );
    void this.redis.setJson(`stockpred:quote:${state.info.symbol}`, this.toQuote(state));
    void this.cache.saveToday(today);
  }

  private isMemoryQuoteFresh(state: SymbolState): boolean {
    const lastClose = state.daily[state.daily.length - 1]?.close ?? 0;
    const indianCash = state.info.exchange === Exchange.NSE || state.info.exchange === Exchange.BSE;
    return isFreshMemoryQuote({
      hasUsablePrice: (state.lastTick?.price ?? 0) > 0 || lastClose > 0,
      lastLiveRefreshMs: state.lastLiveRefresh,
      lastTickTimeMs: state.lastTick?.time,
      sessionOpen: indianCash ? isNseCashSessionOpen() : true,
    });
  }

  /** Hydrate memory from a Redis quote hit. Does not fabricate candles. */
  private applyCachedQuote(state: SymbolState, quote: StockQuote): void {
    if (!(quote.price > 0)) return;
    const time = quote.updatedAt > 0 ? quote.updatedAt : Date.now();
    state.lastTick = {
      symbol: state.info.symbol,
      exchange: state.info.exchange,
      price: quote.price,
      volume: quote.volume ?? 0,
      time,
    };
    state.lastLiveRefresh = Date.now();
  }

  // -------------------------------------------------- simulated tick mode

  private rngFor(key: string): () => number {
    let rng = this.rngs.get(key);
    if (!rng) {
      rng = mulberry32(seedFromSymbol(key) ^ Date.now());
      this.rngs.set(key, rng);
    }
    return rng;
  }

  private async emitTicks(): Promise<void> {
    const now = Date.now();
    const tasks: AnalysisTask[] = [];

    for (const state of this.stocks.values()) {
      if (state.daily.length === 0) continue;
      // Official EOD / live quotes stay put; only the simulated feed wanders.
      if (state.dataSource !== 'simulated') continue;
      const tick = this.nextTick(state, now);
      state.lastTick = tick;
      this.applyTickToCandles(state, tick);

      // Enqueue to orchestrator for controlled processing (if large universe)
      if (this.stocks.size > 100 && this.orchestrator) {
        tasks.push({
          symbol: state.info.symbol,
          tick,
          context: {
            candles: state.daily.slice(-40),
          },
        });
      } else {
        // For small universes, publish directly (backward compatible)
        void this.kafka.publish<MarketTickEvent>(KAFKA_TOPICS.MARKET_TICKS, tick, tick.symbol);
      }
      void this.redis.setJson(`stockpred:quote:${state.info.symbol}`, this.toQuote(state));
    }

    // Batch enqueue for orchestrator
    if (tasks.length > 0 && this.orchestrator) {
      void this.orchestrator.enqueueBatch(tasks);
    }

    // Index ticks (always direct, no queuing needed)
    for (const index of this.indices.values()) {
      const rng = this.rngFor(`${index.name}:tick`);
      const step = index.value * 0.0004 * (rng() * 2 - 1);
      index.value = Math.max(0.01, index.value + step);
      const tick: Tick = {
        symbol: index.name,
        exchange: Exchange.NSE,
        price: round2(index.value),
        volume: 0,
        time: now,
      };
      void this.kafka.publish<MarketTickEvent>(KAFKA_TOPICS.MARKET_TICKS, tick, tick.symbol);
    }
  }

  private nextTick(state: SymbolState, now: number): Tick {
    const rng = this.rngFor(`${state.info.symbol}:tick`);
    const lastPrice = state.lastTick?.price ?? state.daily[state.daily.length - 1].close;
    // Small mean-reverting random walk around the last close.
    const anchor = state.daily[state.daily.length - 1].close;
    const reversion = (anchor - lastPrice) * 0.02;
    const noise = lastPrice * 0.0008 * (rng() * 2 - 1);
    const price = Math.max(0.05, lastPrice + reversion + noise);
    const volume = Math.floor(rng() * 2000) + 10;
    state.dayVolume += volume;
    return {
      symbol: state.info.symbol,
      exchange: state.info.exchange,
      price: round2(price),
      volume,
      time: now,
    };
  }

  private applyTickToCandles(state: SymbolState, tick: Tick): void {
    const minuteStart = Math.floor(tick.time / MINUTE_MS) * MINUTE_MS;

    // ---- 1-minute aggregation
    if (!state.currentMinute || state.currentMinute.time !== minuteStart) {
      if (state.currentMinute) {
        state.intraday.push(state.currentMinute);
        if (state.intraday.length > INTRADAY_BUFFER) state.intraday.shift();
        void this.kafka.publish<MarketCandleEvent>(
          KAFKA_TOPICS.MARKET_CANDLES,
          { candle: state.currentMinute, indicators: null },
          state.info.symbol,
        );
      }
      state.currentMinute = {
        symbol: state.info.symbol,
        timeframe: Timeframe.ONE_MINUTE,
        time: minuteStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
      };
    } else {
      const candle = state.currentMinute;
      candle.high = Math.max(candle.high, tick.price);
      candle.low = Math.min(candle.low, tick.price);
      candle.close = tick.price;
      candle.volume += tick.volume;
    }

    // ---- daily candle update (last element of state.daily is "today")
    const dayStart = Math.floor(tick.time / DAY_MS) * DAY_MS;
    let today = state.daily[state.daily.length - 1];
    if (today.time < dayStart) {
      // Session rollover: yesterday is closed, publish it and start today.
      state.previousClose = today.close;
      state.dayVolume = 0;
      today = {
        symbol: state.info.symbol,
        timeframe: Timeframe.ONE_DAY,
        time: dayStart,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
      };
      state.daily.push(today);
    } else {
      today.high = Math.max(today.high, tick.price);
      today.low = Math.min(today.low, tick.price);
      today.close = tick.price;
      today.volume = state.dayVolume;
    }

    // Refresh indicators + publish the evolving daily candle once a minute.
    if (state.currentMinute.time === minuteStart && state.currentMinute.volume === tick.volume) {
      state.indicators = computeIndicatorSnapshot(state.info.symbol, state.daily);
      void this.kafka.publish<MarketCandleEvent>(
        KAFKA_TOPICS.MARKET_CANDLES,
        { candle: today, indicators: state.indicators },
        state.info.symbol,
      );
      void this.redis.setJson(`stockpred:indicators:${state.info.symbol}`, state.indicators);
    }
  }

  private toQuote(
    state: SymbolState,
    horizon: PredictionHorizon = PredictionHorizon.NEXT_DAY,
    includeScanner = false,
  ): StockQuote {
    const advisoryDefaults = {
      suggestion: 'HOLD' as TradeSuggestion,
      horizon,
      entry: null as number | null,
      target: null as number | null,
      stopLoss: null as number | null,
      quantity: 0,
      confidence: 0,
      expectedMove: 0,
      modelVersion: null as string | null,
    };
    const today = state.daily[state.daily.length - 1];
    if (!today) {
      return {
        ...state.info,
        price: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        dayHigh: 0,
        dayLow: 0,
        previousClose: state.previousClose,
        indicators: null,
        dataSource: 'listed',
        ...advisoryDefaults,
        relativeStrengthNifty50: null,
        scanner: null,
        manipulation: null,
        // Do not fake freshness with Date.now() when no bar exists.
        updatedAt: 0,
        ...this.freshnessFields(0, this.isCryptoState(state), this.isCommodityState(state)),
      };
    }
    const price = state.lastTick?.price ?? today.close;
    const prev = state.previousClose > 0 ? state.previousClose : today.open;
    const session1d = computeCurrentSessionReturn1d({
      candles: state.daily,
      lastPrice: state.lastTick?.price ?? today.close,
      previousClose: state.previousClose > 0 ? state.previousClose : null,
      quoteUpdatedAt: state.lastTick?.time ?? today.time,
    });
    const changePercent =
      session1d.return1d != null
        ? sessionReturn1dToPercent(session1d.return1d)
        : prev > 0
          ? round2(((price - prev) / prev) * 100)
          : 0;
    const change =
      session1d.effectivePrice != null && session1d.referenceClose != null
        ? round2(session1d.effectivePrice - session1d.referenceClose)
        : round2(price - prev);
    const ml = this.predictions.getUsable(state.info.symbol, horizon);
    const niftyDaily = this.indices.get(MarketIndex.NIFTY_50)?.daily ?? [];
    const niftyStamp = niftyDaily[niftyDaily.length - 1]?.time ?? 0;
    const memoKey = `${state.info.symbol}|${horizon}|${ml?.direction ?? ''}|${ml?.confidence ?? 0}|${today.time}|${state.daily.length}|${niftyStamp}`;
    let advisory = this.advisoryMemo.get(memoKey);
    if (!advisory) {
      advisory = composeTradeAdvisory({
        candles: state.daily.length > 80 ? state.daily.slice(-80) : state.daily,
        direction: ml?.direction,
        confidence: ml?.confidence,
        expectedMove: ml?.expectedMove,
        modelVersion: ml?.modelVersion,
        horizon,
        capital: this.paperCapital,
        marketCandles: niftyDaily.length > 6 ? niftyDaily.slice(-20) : niftyDaily,
      });
      this.advisoryMemo.set(memoKey, advisory);
    }
    return {
      ...state.info,
      price: round2(price),
      change,
      changePercent,
      volume: today.volume,
      dayHigh: today.high,
      dayLow: today.low,
      previousClose: session1d.referenceClose ?? prev,
      indicators: state.indicators,
      dataSource: state.dataSource,
      suggestion: advisory.action,
      horizon: advisory.horizon,
      entry: advisory.entry,
      target: advisory.target,
      stopLoss: advisory.stopLoss,
      quantity: advisory.quantity,
      confidence: advisory.confidence,
      expectedMove: advisory.expectedMove,
      modelVersion: advisory.modelVersion,
      relativeStrengthNifty50: includeScanner
        ? (this.scannerFor(state)?.relativeStrengthNifty50 ??
          this.niftyRs(state)?.relativeStrength ??
          null)
        : (this.niftyRs(state)?.relativeStrength ?? null),
      scanner: includeScanner ? this.scannerFor(state) : null,
      manipulation: this.manipulationFor(state),
      updatedAt: state.lastTick?.time ?? today.time,
      ...this.freshnessFields(
        state.lastTick?.time ?? today.time,
        this.isCryptoState(state),
        this.isCommodityState(state),
      ),
    };
  }

  private isCryptoState(state: SymbolState): boolean {
    return (
      state.info.sector === 'CRYPTO_SPOT' ||
      state.info.sector === 'CRYPTO_FUTURE' ||
      this.cryptoBook.states.has(state.info.symbol)
    );
  }

  private isCommodityState(state: SymbolState): boolean {
    return state.info.sector === 'COMMODITY' || this.commodityBook.states.has(state.info.symbol);
  }

  private freshnessFields(
    updatedAt: number,
    crypto = false,
    commodity = false,
  ): Pick<StockQuote, 'ingestMode' | 'freshnessStatus' | 'liveUsable'> {
    const md = configuredCryptoMarketDataProvider();
    const freshnessStatus = classifyQuoteStatus(
      updatedAt,
      Date.now(),
      crypto && md === 'coingecko'
        ? COINGECKO_MAX_QUOTE_AGE_MS
        : commodity
          ? 7 * 86_400_000
          : undefined,
      crypto && md === 'coingecko' ? COINGECKO_FRESH_QUOTE_MAX_AGE_MS : commodity ? 0 : undefined,
      crypto || commodity ? { alwaysOpen: true } : undefined,
    );
    return {
      ingestMode: this.ingestMode,
      freshnessStatus,
      liveUsable: isUsableForLiveTrading(freshnessStatus),
    };
  }

  /**
   * ML → Trade Intelligence bridge status (observational).
   * Shows which cached predictions MDS considers usable for advisory/TI —
   * never trade authorization (Risk → Portfolio → Policy → Gate).
   */
  getMlTiBridge(): {
    total: number;
    usable: number;
    rejected: {
      stale: number;
      incompatible: number;
      missingExpiry: number;
      other: number;
    };
    byHorizon: Record<string, { total: number; usable: number; rejected: number }>;
    usableSamples: ReturnType<PredictionCache['summarizeTiBridge']>['usableSamples'];
    rejectedSamples: ReturnType<PredictionCache['summarizeTiBridge']>['rejectedSamples'];
    note: string;
  } {
    const summary = this.predictions.summarizeTiBridge();
    return {
      ...summary,
      note:
        'Usable = fresh + drift-compatible for Trade Intelligence / advisory only. ' +
        'This bridge does not authorize trades (Risk → Portfolio → Policy → Gate).',
    };
  }

  /** Force-refresh ML prediction cache; returns bridge summary after refresh. */
  async refreshMlPredictions(): Promise<{
    loaded: number;
    bridge: ReturnType<MarketService['getMlTiBridge']>;
  }> {
    const loaded = await this.predictions.refresh();
    if (loaded > 0) this.advisoryMemo.clear();
    const bridge = this.getMlTiBridge();
    console.log(
      `[ML-TI-BRIDGE] requested=cache_summary found=${bridge.total} usable=${bridge.usable} ` +
        `unusable=${Math.max(0, bridge.total - bridge.usable)} noResponse=${loaded === 0 ? 'engine_and_file_empty' : 0}`,
    );
    const sample = bridge.usableSamples[0] ?? bridge.rejectedSamples[0];
    if (sample) {
      console.log(
        `[ML-TI-BRIDGE][SAMPLE] symbol=${sample.symbol} predictionFound=true ` +
          `usable=${bridge.usableSamples.length > 0} ` +
          `rejectReason=${'rejectReason' in sample ? sample.rejectReason : 'none'}`,
      );
    } else {
      console.log(`[ML-TI-BRIDGE][SAMPLE] symbol=none predictionFound=false usable=false`);
    }
    console.log(`[market-data] ML predictions refresh: loaded=${loaded}`);
    return { loaded, bridge };
  }

  /** Explicit ingest / session contract for ops and consumers (data status only). */
  getDataContract(): {
    ingestMode: IngestMode;
    nseCashSessionOpen: boolean;
    quoteStatus: DataFreshnessStatus;
    liveUsable: boolean;
    sampleSymbol: string | null;
    sampleUpdatedAt: number | null;
    note: string;
  } {
    const open = isNseCashSessionOpen();
    let sampleSymbol: string | null = null;
    let sampleUpdatedAt: number | null = null;
    for (const state of this.stocks.values()) {
      const stamp = state.lastTick?.time ?? state.daily[state.daily.length - 1]?.time ?? 0;
      if (stamp > 0) {
        sampleSymbol = state.info.symbol;
        sampleUpdatedAt = stamp;
        break;
      }
    }
    const quoteStatus = classifyQuoteStatus(sampleUpdatedAt);
    return {
      ingestMode: this.ingestMode,
      nseCashSessionOpen: open,
      quoteStatus,
      liveUsable: isUsableForLiveTrading(quoteStatus),
      sampleSymbol,
      sampleUpdatedAt,
      note: open
        ? 'LIVE/DELAYED require LIVE_INGEST + session open (LIVE≤30s, DELAYED≤60s). Risk still enforces 60s quote age. DELAYED is not authorization. Data status is not trade authorization.'
        : 'Session closed: EOD/historical data is for ML/analysis only — not live entry freshness. Data status is not trade authorization.',
    };
  }

  /**
   * Backend-owned MarketSessionState + MARKETS card projection.
   * FE must not clock-derive OPEN/CLOSED; consume this endpoint.
   */
  getMarketSessionStates(): {
    sessions: ReturnType<typeof buildMarketsSessionCard>;
    nse: ReturnType<typeof buildNseMarketSessionState>;
    commodity: ReturnType<typeof buildCommodityMarketSessionState> | null;
    note: string;
  } {
    const contract = this.getDataContract();
    const nse = sanitizeSessionLiveConsistency(
      buildNseMarketSessionState({
        lastMarketUpdateAt: contract.sampleUpdatedAt,
        source: `mds:${this.ingestMode}`,
      }),
    );
    const cryptoSample = [...this.cryptoBook.states.values()].find((s) => s.lastTick?.time);
    const md = configuredCryptoMarketDataProvider();
    const crypto = cryptoSample
      ? buildCryptoMarketSessionState({
          lastMarketUpdateAt: cryptoSample.lastTick?.time ?? null,
          source: `mds:crypto:${md}`,
          venue: 'BINANCE',
          freshMaxAgeMs: md === 'coingecko' ? COINGECKO_FRESH_QUOTE_MAX_AGE_MS : undefined,
          maxLiveAgeMs: md === 'coingecko' ? COINGECKO_MAX_QUOTE_AGE_MS : undefined,
        })
      : this.cryptoBook.states.size > 0
        ? buildCryptoMarketSessionState({
            source: `mds:crypto:${md}`,
            lastMarketUpdateAt: null,
          })
        : null;
    const commoditySample = [...this.commodityBook.states.values()].find((s) => s.lastTick?.time);
    const commodity = this.commodityBook.states.size
      ? buildCommodityMarketSessionState({
          lastMarketUpdateAt: commoditySample?.lastTick?.time ?? null,
          source: 'mds:commodity:alpha-vantage|eia',
        })
      : null;
    const futuresSample = [...this.cryptoBook.states.values()].find(
      (s) => s.info.sector === 'CRYPTO_FUTURE' && s.lastTick?.time,
    );
    const futures = this.cryptoBook.hasFutures()
      ? buildCryptoMarketSessionState({
          lastMarketUpdateAt: futuresSample?.lastTick?.time ?? null,
          source: 'mds:crypto:binance-futures',
          venue: 'BINANCE',
          assetClass: 'CRYPTO_FUTURE',
        })
      : null;
    return {
      nse,
      sessions: buildMarketsSessionCard({
        nse,
        us: null,
        crypto,
        futures,
      }),
      note: 'MarketSessionState is independent of universe membership and ExecutionReady. Simulated never becomes production LIVE.',
      commodity,
    };
  }

  private marketContext(): MarketContext {
    const nifty = this.indices.get(MarketIndex.NIFTY_50);
    const vix = this.indices.get(MarketIndex.INDIA_VIX);
    const stamp = `${nifty?.daily[nifty.daily.length - 1]?.time ?? 0}|${this.stocks.size}`;
    if (this.contextCache?.key === stamp) return this.contextCache.value;
    const samples = [];
    for (const state of this.stocks.values()) {
      const sample = sampleFromCandles(state.daily, state.indicators);
      if (sample) samples.push(sample);
    }
    const breadth = computeMarketBreadth(samples);
    const regime = classifyMarketRegime(nifty?.daily ?? [], breadth, vix?.value ?? null);
    const prev =
      nifty && nifty.previousClose > 0
        ? nifty.previousClose
        : nifty?.daily[nifty.daily.length - 2]?.close;
    const niftyChangePercent =
      nifty && prev && prev > 0 ? round2(((nifty.value - prev) / prev) * 100) : 0;
    const value: MarketContext = {
      regime,
      breadth,
      niftyChangePercent,
      vixLevel: vix ? round2(vix.value) : null,
    };
    this.contextCache = { key: stamp, value };
    return value;
  }

  private niftyRs(state: SymbolState) {
    const nifty = this.indices.get(MarketIndex.NIFTY_50);
    const benchLen = nifty?.daily.length ?? 0;
    if (!nifty || state.daily.length < 5) {
      if (state.info.symbol === 'TCS' || state.info.symbol === 'RELIANCE') {
        console.log(
          `[RS][NIFTY_RS] symbol=${state.info.symbol} stockDaily=${state.daily.length} ` +
            `benchmarkDailyLength=${benchLen} reason=${!nifty ? 'CACHE_MISSING' : 'INSUFFICIENT_HISTORY'}`,
        );
      }
      return null;
    }
    const cmp = compareToBenchmark(
      state.info.symbol,
      MarketIndex.NIFTY_50,
      state.daily,
      nifty.daily,
      60,
    );
    if ((state.info.symbol === 'TCS' || state.info.symbol === 'RELIANCE') && !cmp) {
      console.log(
        `[RS][NIFTY_RS] symbol=${state.info.symbol} stockDaily=${state.daily.length} ` +
          `benchmarkDailyLength=${benchLen} reason=VALUE_NULL`,
      );
    }
    return cmp;
  }

  private scannerFor(state: SymbolState) {
    if (state.daily.length < 40) return null;
    const context = this.marketContext();
    const last = state.daily[state.daily.length - 1];
    const memoKey = `${state.info.symbol}|${last.time}|${context.regime}|${context.breadth.asOf}`;
    const cached = this.scannerMemo.get(memoKey);
    if (cached !== undefined) return cached;
    const week = this.predictions.getUsable(state.info.symbol, PredictionHorizon.NEXT_WEEK);
    const day = this.predictions.getUsable(state.info.symbol, PredictionHorizon.NEXT_DAY);
    const ml = week ?? day;
    const snapshot = buildBullRunSnapshot({
      symbol: state.info.symbol,
      candles: state.daily,
      indicators: state.indicators,
      niftyCandles: this.indices.get(MarketIndex.NIFTY_50)?.daily ?? [],
      breadth: context.breadth,
      regime: context.regime,
      upProbability:
        ml?.probabilities?.UP !== undefined
          ? ml.probabilities.UP * (ml.probabilities.UP <= 1 ? 100 : 1)
          : undefined,
      downProbability:
        ml?.probabilities?.DOWN !== undefined
          ? ml.probabilities.DOWN * (ml.probabilities.DOWN <= 1 ? 100 : 1)
          : undefined,
      sidewaysProbability:
        ml?.probabilities?.SIDEWAYS !== undefined
          ? ml.probabilities.SIDEWAYS * (ml.probabilities.SIDEWAYS <= 1 ? 100 : 1)
          : undefined,
      mlConfidence: ml?.confidence,
      mlExpectedMove: ml?.expectedMove,
    });
    this.scannerMemo.set(memoKey, snapshot);
    if (this.scannerMemo.size > 8000) {
      const first = this.scannerMemo.keys().next().value;
      if (first) this.scannerMemo.delete(first);
    }
    return snapshot;
  }

  private manipulationFor(state: SymbolState): ManipulationSnapshot | null {
    if (state.daily.length < MANIPULATION_MIN_BARS) return null;
    const last = state.daily[state.daily.length - 1];
    const niftyDaily = this.indices.get(MarketIndex.NIFTY_50)?.daily ?? [];
    const niftyStamp = niftyDaily[niftyDaily.length - 1]?.time ?? 0;
    const ml = this.manipulationScores.get(state.info.symbol);
    const memoKey = `${state.info.symbol}|${last.time}|${state.daily.length}|${niftyStamp}|${ml?.investigateProbability ?? ''}|${ml?.modelVersion ?? ''}`;
    const cached = this.manipulationMemo.get(memoKey);
    if (cached !== undefined) return cached;
    const snapshot = buildManipulationSnapshot({
      candles: state.daily,
      niftyCandles: niftyDaily,
      investigateProbability: ml?.investigateProbability ?? null,
      modelVersion: ml?.modelVersion ?? 'statistical-v1',
    });
    this.manipulationMemo.set(memoKey, snapshot);
    if (this.manipulationMemo.size > 8000) {
      const first = this.manipulationMemo.keys().next().value;
      if (first) this.manipulationMemo.delete(first);
    }
    return snapshot;
  }

  private async emitScannerAlerts(): Promise<void> {
    if (this.scannerAlertsRunning) return;
    this.scannerAlertsRunning = true;
    try {
      await this.emitScannerAlertsInner();
    } finally {
      this.scannerAlertsRunning = false;
    }
  }

  private async emitScannerAlertsInner(): Promise<void> {
    const cooldown = scannerAlertCooldownMs();
    const now = Date.now();
    for (const state of this.stocks.values()) {
      if (state.daily.length < 40) continue;
      const snapshot = this.scannerFor(state);
      if (!snapshot) continue;
      const bull = isBullRunAlert(snapshot);
      const reversal = isBearReversalAlert(snapshot);
      if (!bull && !reversal) continue;
      const kind = reversal && !bull ? 'REVERSAL' : 'BULL_RUN';
      const prev = this.alertSentAt.get(state.info.symbol);
      const scoreDelta = Math.abs((prev?.bullScore ?? 0) - snapshot.bullScore);
      if (prev && now - prev.at < cooldown && prev.kind === kind && scoreDelta < 8) continue;
      this.alertSentAt.set(state.info.symbol, { kind, at: now, bullScore: snapshot.bullScore });
      const price = state.lastTick?.price ?? state.daily[state.daily.length - 1]?.close ?? 0;
      const payload: ScannerAlertEvent = {
        symbol: state.info.symbol,
        kind,
        price: round2(price),
        bullScore: snapshot.bullScore,
        bearScore: snapshot.bearScore,
        regime: this.marketContext().regime,
        snapshot,
        createdAt: now,
      };
      await this.kafka.publish(KAFKA_TOPICS.SCANNER_ALERTS, payload, state.info.symbol);
    }
  }

  private findStateForBhav(row: BhavQuote): SymbolState | undefined {
    if (row.exchange === Exchange.NSE) {
      const bySymbol = this.stocks.get(row.symbol);
      if (bySymbol && bySymbol.info.exchange === Exchange.NSE) return bySymbol;
      return undefined;
    }

    if (row.bseCode) {
      const symbol = this.byBseCode.get(row.bseCode);
      const byCode = symbol ? this.stocks.get(symbol) : undefined;
      if (byCode && byCode.info.exchange === Exchange.BSE) return byCode;
    }
    if (row.symbol) {
      const bySymbol = this.stocks.get(row.symbol);
      if (bySymbol && bySymbol.info.exchange === Exchange.BSE) return bySymbol;
    }
    if (row.isin) {
      const symbol = this.byIsin.get(row.isin);
      const byIsin = symbol ? this.stocks.get(symbol) : undefined;
      if (byIsin && byIsin.info.exchange === Exchange.BSE) return byIsin;
    }
    return undefined;
  }

  private applyBhavQuotes(rows: BhavQuote[]): number {
    let applied = 0;
    for (const row of rows) {
      const state = this.findStateForBhav(row);
      if (!state) continue;
      if (state.dataSource === 'simulated') continue;
      const candle = quoteToCandle({ ...row, symbol: state.info.symbol });
      const existing = state.daily.find((c) => c.time === candle.time);
      if (existing) {
        if (state.dataSource === 'live') continue;
        existing.open = candle.open;
        existing.high = candle.high;
        existing.low = candle.low;
        existing.close = candle.close;
        existing.volume = candle.volume;
      } else {
        state.daily.push(candle);
        state.daily.sort((a, b) => a.time - b.time);
      }
      const last = state.daily[state.daily.length - 1];
      if (last.time === candle.time) {
        state.previousClose = row.prevClose > 0 ? row.prevClose : state.previousClose;
        state.dayVolume = last.volume;
        state.dataSource = 'cached';
        state.lastTick = {
          symbol: state.info.symbol,
          exchange: state.info.exchange,
          price: last.close,
          volume: last.volume,
          time: last.time,
        };
      } else if (state.daily.length >= 2) {
        state.previousClose = state.daily[state.daily.length - 2].close;
      }
      applied += 1;
    }
    return applied;
  }

  private applyOfficialIndices(rows: OfficialIndexClose[]): void {
    for (const row of rows) {
      const cfg = INDEX_CONFIG.find((index) => index.name === row.index);
      if (!cfg) continue;
      const candle: Candle = {
        symbol: row.index,
        timeframe: Timeframe.ONE_DAY,
        time: row.time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: 0,
      };
      this.indices.set(row.index, {
        name: row.index,
        displayName: cfg.displayName,
        daily: [candle],
        value: row.close,
        previousClose: row.prevClose,
        dataSource: 'cached',
      });
    }
  }

  private async backfillBhavcopyHistory(): Promise<void> {
    const sessions = recentWeekdays(90).slice(1);
    let extra = 0;
    for (const session of sessions) {
      try {
        const rows = await loadBhavcopySession(session);
        if (rows.length === 0) continue;
        extra += this.applyBhavQuotes(rows);
      } catch {
        /* skip missing sessions */
      }
    }
    console.log(
      `[market-data] bhavcopy history merged (${extra} row updates) ingestMode=HISTORICAL_BACKFILL`,
    );
  }

  /** Force-reload daily history, live print, and technical indicators for one symbol. */
  async refreshTechnical(symbol: string): Promise<{
    symbol: string;
    candles: number;
    indicators: boolean;
    dataSource: string;
  }> {
    const state = this.requireSymbol(symbol);
    this.hydrateTried.delete(symbol);
    this.hydrateJobs.delete(symbol);
    await this.bootstrapSymbol({
      symbol: state.info.symbol,
      name: state.info.name,
      exchange: state.info.exchange,
      sector: state.info.sector,
      indices: state.info.indices,
      basePrice: state.previousClose || 0,
      isin: state.isin,
      bseCode: state.bseCode,
      yahooSymbol: state.yahooSymbol,
    });
    const refreshed = this.requireSymbol(symbol);
    refreshed.lastLiveRefresh = undefined;
    await this.refreshSymbolLive(refreshed);
    const finalState = this.requireSymbol(symbol);
    if (finalState.daily.length >= 2) {
      finalState.indicators = computeIndicatorSnapshot(finalState.info.symbol, finalState.daily);
    }
    return {
      symbol: finalState.info.symbol,
      candles: finalState.daily.length,
      indicators: finalState.indicators != null,
      dataSource: finalState.dataSource,
    };
  }

  private requireSymbol(symbol: string): SymbolState {
    const state =
      this.stocks.get(symbol) ?? this.cryptoBook.get(symbol) ?? this.commodityBook.get(symbol);
    if (!state) throw new NotFoundException(`Unknown symbol: ${symbol}`);
    return state;
  }

  private initCryptoBooks(): void {
    try {
      this.cryptoBook.loadSnapshots();
      console.log(`[market-data] crypto book ${this.cryptoBook.states.size} instruments`);
      if (this.cryptoBook.states.size === 0) return;
      if (!this.cryptoBook.marketDataMatchesSpotUniverse()) {
        console.warn(
          '[market-data] CRYPTO_MARKET_DATA_PROVIDER does not match crypto spot universe provider; spot quotes will not be ticker-joined',
        );
      }
      void this.refreshCryptoQuotes();
      this.cryptoRefreshTimer = setInterval(() => void this.refreshCryptoQuotes(), 60_000);
    } catch (error) {
      console.warn(`[market-data] crypto book skipped: ${(error as Error).message}`);
    }
  }

  private initCommodityBook(): void {
    try {
      this.commodityBook.loadSnapshots();
      console.log(
        `[market-data] commodity book ${this.commodityBook.states.size} products (on-demand AV/EIA, no HF poll)`,
      );
    } catch (error) {
      console.warn(`[market-data] commodity book skipped: ${(error as Error).message}`);
    }
  }

  private async refreshCryptoQuotes(): Promise<void> {
    const md = configuredCryptoMarketDataProvider();
    try {
      if (md === 'binance' && this.cryptoBook.marketDataMatchesSpotUniverse()) {
        const response = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
          headers: { Accept: 'application/json', 'User-Agent': 'stockpred-mds/1.0' },
        });
        if (response.ok) {
          const rows = (await response.json()) as Array<{
            symbol?: string;
            lastPrice?: string;
            volume?: string;
            highPrice?: string;
            lowPrice?: string;
            openPrice?: string;
            closeTime?: number;
          }>;
          this.cryptoBook.applyPrints(
            normalizeBinanceTicker24hr(rows, this.cryptoBook.eligibleSpotIds()),
          );
        }
      }
      if (this.cryptoBook.hasFutures()) {
        const fut = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', {
          headers: { Accept: 'application/json', 'User-Agent': 'stockpred-mds/1.0' },
        });
        if (fut.ok) {
          const futRows = (await fut.json()) as Array<{
            symbol?: string;
            lastPrice?: string;
            volume?: string;
            highPrice?: string;
            lowPrice?: string;
            openPrice?: string;
            closeTime?: number;
          }>;
          const futPrints = normalizeBinanceTicker24hr(
            futRows,
            this.cryptoBook.eligibleFuturesSymbols(),
          ).map((print) => ({ ...print, provider: 'binance-futures' as const }));
          this.cryptoBook.applyFuturesTickers(futPrints);
        }
      }
    } catch (error) {
      console.warn(`[market-data] crypto refresh failed: ${(error as Error).message}`);
    }
  }

  private async refreshCoinGeckoOnDemand(id: string): Promise<void> {
    if (!this.cryptoBook.marketDataMatchesSpotUniverse()) return;
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_vol=true`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'stockpred-mds/1.0' },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as Record<
        string,
        { usd?: number; usd_24h_vol?: number }
      >;
      this.cryptoBook.applyPrints(normalizeCoinGeckoSimplePrice(payload, new Set([id])));
    } catch (error) {
      console.warn(`[market-data] coingecko on-demand failed: ${(error as Error).message}`);
    }
  }

  private async refreshCommodityOnDemand(symbol: string): Promise<void> {
    const row = this.commodityBook.rows.get(symbol);
    const state = this.commodityBook.get(symbol);
    if (!row || !state) return;
    const functionId = row.providerAssetId ?? row.symbol;
    const apiKey = String(process.env.ALPHA_VANTAGE_API_KEY ?? '').trim();
    const eiaKey = String(process.env.EIA_API_KEY ?? '').trim();
    const energy = EIA_ENERGY_SERIES.find(
      (s) => s.symbol === row.symbol || s.symbol === functionId,
    );
    try {
      if (eiaKey && energy) {
        const url = `https://api.eia.gov/v2/seriesid/${encodeURIComponent(energy.id)}?api_key=${encodeURIComponent(eiaKey)}`;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (response.ok) {
          const parsed = normalizeEiaSeries(
            (await response.json()) as Parameters<typeof normalizeEiaSeries>[0],
            functionId,
          );
          if (parsed.print) {
            this.commodityBook.applyPrint(parsed.print, parsed.history);
            return;
          }
        }
      }
      if (!apiKey) return;
      const url = `https://www.alphavantage.co/query?function=${encodeURIComponent(functionId)}&interval=monthly&apikey=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const parsed = normalizeAlphaVantageCommoditySeries(
        (await response.json()) as Parameters<typeof normalizeAlphaVantageCommoditySeries>[0],
        functionId,
      );
      if (parsed.print) this.commodityBook.applyPrint(parsed.print, parsed.history);
    } catch (error) {
      console.warn(`[market-data] commodity on-demand failed: ${(error as Error).message}`);
    }
  }

  private async ensureCryptoHistory(symbol: string): Promise<void> {
    const state = this.cryptoBook.get(symbol);
    if (!state || state.daily.length >= 30) return;
    const row = this.cryptoBook.rows.get(symbol);
    if (!row) return;
    const md = configuredCryptoMarketDataProvider();
    try {
      if (row.assetClass === 'CRYPTO_FUTURE') {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(row.symbol)}&interval=1d&limit=500`;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const klines = normalizeBinanceKlines((await response.json()) as unknown[]);
        state.daily = klines.map((bar) => ({
          symbol,
          timeframe: Timeframe.ONE_DAY,
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        }));
        return;
      }
      if (md === 'coingecko') {
        const id = row.providerAssetId ?? symbol;
        const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=365`;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const klines = normalizeCoinGeckoMarketChart(
          (await response.json()) as {
            prices?: Array<[number, number]>;
            total_volumes?: Array<[number, number]>;
          },
        );
        state.daily = klines.map((bar) => ({
          symbol,
          timeframe: Timeframe.ONE_DAY,
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        }));
        return;
      }
      if (md === 'binance' && this.cryptoBook.marketDataMatchesSpotUniverse()) {
        const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(row.symbol)}&interval=1d&limit=500`;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const klines = normalizeBinanceKlines((await response.json()) as unknown[]);
        state.daily = klines.map((bar) => ({
          symbol,
          timeframe: Timeframe.ONE_DAY,
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        }));
      }
    } catch (error) {
      console.warn(`[market-data] crypto history failed: ${(error as Error).message}`);
    }
  }

  /**
   * Load full daily history for a listed symbol the moment someone opens it.
   * Background bootstrap can take hours across the full universe; the detail
   * page must not wait for that queue.
   */
  private async ensureLoaded(symbol: string): Promise<void> {
    if (this.cryptoBook.get(symbol)) {
      await this.ensureCryptoHistory(symbol);
      return;
    }
    if (this.commodityBook.get(symbol)) {
      await this.refreshCommodityOnDemand(symbol);
      return;
    }
    const state = this.stocks.get(symbol);
    if (!state) throw new NotFoundException(`Unknown symbol: ${symbol}`);
    if (state.daily.length >= SERVE_DAILY_MIN_BARS) return;
    if (this.hydrateTried.has(symbol)) return;
    const inflight = this.hydrateJobs.get(symbol);
    if (inflight) return inflight;
    const job = this.hydrateOnDemand(state).finally(() => this.hydrateJobs.delete(symbol));
    this.hydrateJobs.set(symbol, job);
    await job;
  }

  private async hydrateOnDemand(state: SymbolState): Promise<void> {
    await this.bootstrapSymbol(
      {
        symbol: state.info.symbol,
        name: state.info.name,
        exchange: state.info.exchange,
        sector: state.info.sector,
        indices: state.info.indices,
        basePrice: state.previousClose || 0,
        isin: state.isin,
        bseCode: state.bseCode,
        yahooSymbol: state.yahooSymbol,
      },
      { onDemand: true },
    );
    this.hydrateTried.add(state.info.symbol);
  }

  // -------------------------------------------------- orchestrator integration

  /**
   * Wire orchestrator events to Kafka publication
   * The orchestrator handles queueing and concurrency; we just persist the events
   */
  private setupOrchestratorListeners(): void {
    if (!this.orchestrator) return;

    // Publish market ticks from orchestrator
    this.orchestrator.on('tick', ({ symbol, tick }: { symbol: string; tick: Tick }) => {
      void this.kafka.publish<MarketTickEvent>(KAFKA_TOPICS.MARKET_TICKS, tick, symbol);
    });

    // Publish candle events for signal evaluation
    this.orchestrator.on(
      'signal-evaluate',
      ({ symbol, candles }: { symbol: string; candles: Candle[] }) => {
        const state = this.stocks.get(symbol);
        if (state && candles.length > 0 && state.indicators) {
          void this.kafka.publish<MarketCandleEvent>(
            KAFKA_TOPICS.MARKET_CANDLES,
            { candle: candles[candles.length - 1], indicators: state.indicators },
            symbol,
          );
        }
      },
    );

    // Log orchestrator errors
    this.orchestrator.on('task-error', ({ symbol, error }: { symbol: string; error: Error }) => {
      console.error(`[orchestrator] Task failed for ${symbol}:`, error.message);
    });

    // Optional: Log task completion for debugging
    if (process.env.DEBUG_ORCHESTRATOR === 'true') {
      this.orchestrator.on(
        'task-complete',
        ({ symbol, latency }: { symbol: string; latency: number }) => {
          console.debug(`[orchestrator] ${symbol} completed in ${latency}ms`);
        },
      );
    }
  }
}
