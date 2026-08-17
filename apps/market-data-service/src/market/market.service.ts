import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
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
import { PredictionCache } from './prediction-cache';
import { ManipulationCache } from './manipulation-cache';
import { KafkaProducerService } from './kafka.service';
import { IndexState, INTRADAY_BUFFER, SymbolState } from './market-state';
import { MarketDataProvider } from './providers/provider.interface';
import { mulberry32, seedFromSymbol, SimulatedProvider } from './providers/simulated.provider';
import { YahooProvider } from './providers/yahoo.provider';
import { RedisService } from './redis.service';
import { RealTimeOrchestrator, getOrchestrator, AnalysisTask } from './real-time-orchestrator';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 2700; // ~10 trading years of calendar days
/** Minimum cached candles considered a usable offline history. */
const MIN_CACHED_CANDLES = 40;

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
  private readonly byIsin = new Map<string, string>();
  private readonly byBseCode = new Map<string, string>();
  private readonly indices = new Map<string, IndexState>();
  private readonly rngs = new Map<string, () => number>();
  private tickTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private liveWatchTimer: NodeJS.Timeout | null = null;
  private predictionTimer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private readonly tickIntervalMs = getEnvNumber('TICK_INTERVAL_MS', 1000);
  private readonly refreshIntervalMs = getEnvNumber('QUOTE_REFRESH_INTERVAL_MS', 60_000);
  private readonly liveQuoteMinMs = getEnvNumber('LIVE_QUOTE_MIN_MS', 5_000);
  private readonly liveQuoteWaitMs = getEnvNumber('LIVE_QUOTE_WAIT_MS', 5_000);
  private readonly watched = new Map<string, number>();
  private readonly liveRefreshInflight = new Map<string, Promise<void>>();
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
  }

  async onModuleInit(): Promise<void> {
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
        '[market-data] EOD-only mode: official bhavcopy/index closes, no simulated ticks',
      );
    }

    // Register every listed symbol immediately so the UI can paginate the full universe.
    for (const stock of universe) {
      this.registerListed(stock);
    }
    console.log(`[market-data] listed ${universe.length} symbols (candles load in background)`);

    // Official EOD first (prices on the dashboard), then cache/yahoo history.
    void this.hydrateThenBootstrap(universe);
    void this.predictions.refresh().then((count) => {
      this.advisoryMemo.clear();
      console.log(`[market-data] ML predictions loaded: ${count}`);
    });
    void this.manipulationScores.refresh().then((count) => {
      this.manipulationMemo.clear();
      if (count > 0) console.log(`[market-data] manipulation model scores loaded: ${count}`);
    });
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

    // Load indices first (required for API queries)
    await Promise.all(
      INDEX_CONFIG.map(async (index) => {
        const existing = this.indices.get(index.name);
        if (existing && existing.dataSource !== 'simulated' && existing.daily.length > 0) {
          return;
        }
        let { candles, source } = await this.loadDaily(index.name, index.basePrice);
        if (candles.length === 0) {
          if (getUniverseMode() !== 'quick-start') {
            return;
          }
          candles = await this.simulated.getDailyHistory(index.name, HISTORY_DAYS, index.basePrice);
          source = 'simulated';
        }
        const value = candles[candles.length - 1].close;
        this.indices.set(index.name, {
          name: index.name,
          displayName: index.displayName,
          daily: candles,
          value,
          previousClose: candles[candles.length - 2]?.close ?? value,
          dataSource: source,
        });
      }),
    );
    console.log(`[market-data] indices loaded (${INDEX_CONFIG.length})`);

    // Bootstrap stocks in batches to avoid overwhelming the provider
    // In yahoo mode, use smaller batches + timeout to fail fast on many invalid tickers
    const BATCH_SIZE = this.yahooProvider ? 5 : 10;
    const BATCH_TIMEOUT_MS = this.yahooProvider ? 30_000 : 60_000;
    let loaded = 0;
    let skipped = 0;

    for (let i = 0; i < universe.length; i += BATCH_SIZE) {
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
        console.log(
          `[market-data] progress: ${loaded}/${universe.length} loaded, ${skipped} skipped`,
        );
      }
    }
    console.log(
      `[market-data] bootstrap complete: ${loaded}/${universe.length} loaded, ${skipped} skipped`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.predictionTimer) clearInterval(this.predictionTimer);
    if (this.scannerAlertTimer) clearInterval(this.scannerAlertTimer);
    if (this.liveWatchTimer) clearInterval(this.liveWatchTimer);
    if (this.orchestrator) {
      await this.orchestrator.shutdown();
    }
  }

  // ---------------------------------------------------------------- queries

  getQuotes(): StockQuote[] {
    return [...this.stocks.values()].map((state) => this.toQuote(state));
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
    const includeScanner = sortKey === 'bull' || bestPickMode || suggestionUpper === 'ACTIONABLE';
    let quotes = [...this.stocks.values()].map((state) =>
      this.toQuote(state, horizonKey, includeScanner),
    );
    const counts = {
      NSE: quotes.filter((q) => q.exchange === Exchange.NSE).length,
      BSE: quotes.filter((q) => q.exchange === Exchange.BSE).length,
      all: quotes.length,
    };

    const exchangeUpper = exchange?.trim().toUpperCase();
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
    await Promise.race([
      this.refreshSymbolLive(state),
      new Promise<void>((resolve) => setTimeout(resolve, this.liveQuoteWaitMs)),
    ]);
    return this.toQuote(state, PredictionHorizon.NEXT_WEEK, true);
  }

  async getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const index = this.indices.get(symbol);
    if (index) {
      return timeframe === Timeframe.ONE_DAY ? index.daily.slice(-limit) : [];
    }
    await this.ensureLoaded(symbol);
    const state = this.requireSymbol(symbol);
    if (timeframe === Timeframe.ONE_DAY) {
      return state.daily.slice(-limit);
    }
    return state.intraday.slice(-limit);
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
    return [...this.indices.values()].map((state) => ({
      index: state.name as MarketIndex,
      name: state.displayName,
      value: round2(state.value),
      change: round2(state.value - state.previousClose),
      changePercent: round2(((state.value - state.previousClose) / state.previousClose) * 100),
      updatedAt: Date.now(),
    }));
  }

  getMarketContext(): MarketContext {
    return this.marketContext();
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
   * Real-data chain: live provider -> database cache (bhavcopy / previous
   * Yahoo) -> listed-with-no-candles. Simulated candles are only used in
   * quick-start mode and are NEVER written to the cache.
   */
  private async loadDaily(
    symbol: string,
    basePrice: number,
  ): Promise<{ candles: Candle[]; source: MarketDataSource }> {
    const cached = await this.cache.load(symbol, HISTORY_DAYS);

    if (this.yahooProvider) {
      try {
        const existing = this.stocks.get(symbol);
        const candles = await this.yahooProvider.getDailyHistory(symbol, HISTORY_DAYS, basePrice, {
          exchange: existing?.info.exchange,
          bseCode: existing?.bseCode,
          yahooSymbol: existing?.yahooSymbol,
        });
        void this.cache.saveHistory(candles);
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

  private async bootstrapSymbol(stock: UniverseStock): Promise<void> {
    try {
      const { candles, source } = await this.loadDaily(stock.symbol, stock.basePrice);
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
   * Pull the last listed trade for one symbol while it is on screen.
   * Throttled; concurrent callers share one in-flight Yahoo request.
   */
  private async refreshSymbolLive(state: SymbolState): Promise<void> {
    const now = Date.now();
    const inflight = this.liveRefreshInflight.get(state.info.symbol);
    if (inflight) return inflight;
    if (state.lastLiveRefresh != null && now - state.lastLiveRefresh < this.liveQuoteMinMs) {
      return;
    }

    const job = this.fetchAndApplyLivePrint(state).finally(() => {
      this.liveRefreshInflight.delete(state.info.symbol);
    });
    this.liveRefreshInflight.set(state.info.symbol, job);
    return job;
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
        updatedAt: Date.now(),
      };
    }
    const price = state.lastTick?.price ?? today.close;
    const prev = state.previousClose > 0 ? state.previousClose : today.open;
    const ml = this.predictions.get(state.info.symbol, horizon);
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
      change: round2(price - prev),
      changePercent: prev > 0 ? round2(((price - prev) / prev) * 100) : 0,
      volume: today.volume,
      dayHigh: today.high,
      dayLow: today.low,
      previousClose: prev,
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
        ? (this.scannerFor(state)?.relativeStrengthNifty50 ?? null)
        : (this.niftyRs(state)?.relativeStrength ?? null),
      scanner: includeScanner ? this.scannerFor(state) : null,
      manipulation: this.manipulationFor(state),
      updatedAt: state.lastTick?.time ?? today.time,
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
    if (!nifty || state.daily.length < 5) return null;
    return compareToBenchmark(
      state.info.symbol,
      MarketIndex.NIFTY_50,
      state.daily,
      nifty.daily,
      60,
    );
  }

  private scannerFor(state: SymbolState) {
    if (state.daily.length < 40) return null;
    const context = this.marketContext();
    const last = state.daily[state.daily.length - 1];
    const memoKey = `${state.info.symbol}|${last.time}|${context.regime}|${context.breadth.asOf}`;
    const cached = this.scannerMemo.get(memoKey);
    if (cached !== undefined) return cached;
    const week = this.predictions.get(state.info.symbol, PredictionHorizon.NEXT_WEEK);
    const day = this.predictions.get(state.info.symbol, PredictionHorizon.NEXT_DAY);
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
    console.log(`[market-data] bhavcopy history merged (${extra} row updates)`);
  }

  private requireSymbol(symbol: string): SymbolState {
    const state = this.stocks.get(symbol);
    if (!state) throw new NotFoundException(`Unknown symbol: ${symbol}`);
    return state;
  }

  /**
   * Load full daily history for a listed symbol the moment someone opens it.
   * Background bootstrap can take hours across the full universe; the detail
   * page must not wait for that queue.
   */
  private async ensureLoaded(symbol: string): Promise<void> {
    const state = this.stocks.get(symbol);
    if (!state) throw new NotFoundException(`Unknown symbol: ${symbol}`);
    if (state.daily.length >= 500) return;
    if (this.hydrateTried.has(symbol)) return;
    const inflight = this.hydrateJobs.get(symbol);
    if (inflight) return inflight;
    const job = this.hydrateOnDemand(state).finally(() => this.hydrateJobs.delete(symbol));
    this.hydrateJobs.set(symbol, job);
    await job;
  }

  private async hydrateOnDemand(state: SymbolState): Promise<void> {
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
