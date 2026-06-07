import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getPrismaClient, STOCK_UNIVERSE, UniverseStock } from '@stockpred/database';
import { KAFKA_TOPICS, MarketCandleEvent, MarketTickEvent } from '@stockpred/shared-events';
import {
  Candle,
  DepthLevel,
  Exchange,
  IndexQuote,
  MarketDataSource,
  MarketDepth,
  MarketIndex,
  RelativeComparison,
  StockQuote,
  Tick,
  Timeframe,
} from '@stockpred/shared-types';
import {
  compareToBenchmark,
  computeIndicatorSnapshot,
  getEnv,
  getEnvNumber,
  round2,
} from '@stockpred/shared-utils';
import { CandleCache } from './candle-cache';
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
const MIN_CACHED_CANDLES = 60;

const INDEX_CONFIG: { name: MarketIndex; displayName: string; basePrice: number }[] = [
  { name: MarketIndex.NIFTY_50, displayName: 'Nifty 50', basePrice: 24500 },
  { name: MarketIndex.NIFTY_MIDCAP_100, displayName: 'Nifty Midcap 100', basePrice: 57000 },
  {
    name: MarketIndex.NIFTY_SMALLCAP_100,
    displayName: 'Nifty Smallcap 100 (ETF proxy)',
    basePrice: 18500,
  },
  { name: MarketIndex.INDIA_VIX, displayName: 'India VIX', basePrice: 14 },
];

@Injectable()
export class MarketService implements OnModuleInit, OnModuleDestroy {
  private readonly provider: MarketDataProvider;
  /** Set in yahoo mode: enables the real intraday refresh sweep. */
  private readonly yahooProvider: YahooProvider | null;
  private readonly simulated = new SimulatedProvider();
  private readonly stocks = new Map<string, SymbolState>();
  private readonly indices = new Map<string, IndexState>();
  private readonly rngs = new Map<string, () => number>();
  private tickTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private readonly tickIntervalMs = getEnvNumber('TICK_INTERVAL_MS', 1000);
  private readonly refreshIntervalMs = getEnvNumber('QUOTE_REFRESH_INTERVAL_MS', 60_000);
  private orchestrator: RealTimeOrchestrator | null = null;

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
    console.log(
      `[market-data] bootstrapping ${universe.length} symbols via "${this.provider.name}" provider...`,
    );
    await Promise.all(universe.map((stock) => this.bootstrapSymbol(stock)));
    await Promise.all(
      INDEX_CONFIG.map(async (index) => {
        const { candles, source } = await this.loadDaily(index.name, index.basePrice);
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

    // Initialize orchestrator for parallel analysis
    this.orchestrator = getOrchestrator();
    this.setupOrchestratorListeners();

    if (this.yahooProvider) {
      // Real data mode: prices move only on real quote refreshes - no
      // synthetic jitter. The sweep is serialized by the provider's queue.
      this.refreshTimer = setInterval(() => void this.refreshRealQuotes(), this.refreshIntervalMs);
      console.log(
        `[market-data] real intraday refresh active (every ${this.refreshIntervalMs / 1000}s)`,
      );
      void this.refreshRealQuotes();
    } else {
      this.tickTimer = setInterval(() => void this.emitTicks(), this.tickIntervalMs);
      console.log(
        `[market-data] simulated live feed started (every ${this.tickIntervalMs}ms) - set MARKET_DATA_PROVIDER=yahoo for real data`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.orchestrator) {
      await this.orchestrator.shutdown();
    }
  }

  // ---------------------------------------------------------------- queries

  getQuotes(): StockQuote[] {
    return [...this.stocks.values()].map((state) => this.toQuote(state));
  }

  getQuote(symbol: string): StockQuote {
    const state = this.requireSymbol(symbol);
    return this.toQuote(state);
  }

  getCandles(symbol: string, timeframe: Timeframe, limit: number): Candle[] {
    const state = this.stocks.get(symbol);
    const index = this.indices.get(symbol);
    const daily = state?.daily ?? index?.daily;
    if (!daily) throw new NotFoundException(`Unknown symbol: ${symbol}`);
    if (timeframe === Timeframe.ONE_DAY) {
      return daily.slice(-limit);
    }
    if (!state) throw new NotFoundException(`Intraday data not available for ${symbol}`);
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
   * Real-data chain: live provider -> database cache (real, possibly stale)
   * -> simulation as a clearly-flagged last resort. Simulated candles are
   * NEVER written to the cache.
   */
  private async loadDaily(
    symbol: string,
    basePrice: number,
  ): Promise<{ candles: Candle[]; source: MarketDataSource }> {
    if (this.yahooProvider) {
      try {
        const candles = await this.yahooProvider.getDailyHistory(symbol, HISTORY_DAYS, basePrice);
        void this.cache.saveHistory(candles);
        return { candles, source: 'live' };
      } catch (error) {
        console.warn(
          `[market-data] live history failed for ${symbol} (${(error as Error).message}); trying cache`,
        );
      }
      const cached = await this.cache.load(symbol, HISTORY_DAYS);
      if (cached.length >= MIN_CACHED_CANDLES) {
        console.log(
          `[market-data] ${symbol}: serving ${cached.length} cached REAL candles (offline mode)`,
        );
        return { candles: cached, source: 'cached' };
      }
      console.warn(
        `[market-data] ${symbol}: no usable cache - simulated last resort (flagged on the quote)`,
      );
    }
    const candles = await this.simulated.getDailyHistory(symbol, HISTORY_DAYS, basePrice);
    return { candles, source: 'simulated' };
  }

  private async loadUniverse(): Promise<UniverseStock[]> {
    try {
      const prisma = getPrismaClient();
      const rows = await prisma.stock.findMany();
      if (rows.length > 0) {
        return rows.map((row) => {
          const base = STOCK_UNIVERSE.find((s) => s.symbol === row.symbol);
          return {
            symbol: row.symbol,
            name: row.name,
            exchange: row.exchange as Exchange,
            sector: row.sector,
            indices: row.indices as MarketIndex[],
            basePrice: base?.basePrice ?? 1000,
          };
        });
      }
    } catch (error) {
      console.warn(
        `[market-data] database unavailable (${(error as Error).message}); using built-in universe`,
      );
    }
    return STOCK_UNIVERSE;
  }

  private async bootstrapSymbol(stock: UniverseStock): Promise<void> {
    const { candles, source } = await this.loadDaily(stock.symbol, stock.basePrice);
    const last = candles[candles.length - 1];
    const state: SymbolState = {
      info: {
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        indices: stock.indices,
      },
      daily: candles,
      intraday: [],
      currentMinute: null,
      lastTick: null,
      previousClose: candles[candles.length - 2]?.close ?? last.close,
      dayVolume: last.volume,
      indicators: computeIndicatorSnapshot(stock.symbol, candles),
      dataSource: source,
    };
    this.stocks.set(stock.symbol, state);
  }

  // ------------------------------------------------- real intraday refresh

  /** Sweep the universe for real intraday updates (yahoo mode only). */
  private async refreshRealQuotes(): Promise<void> {
    if (!this.yahooProvider || this.refreshing) return;
    this.refreshing = true;
    try {
      for (const state of this.stocks.values()) {
        try {
          const today = await this.yahooProvider.getTodayCandle(state.info.symbol);
          if (today) this.applyRealToday(state, today);
        } catch {
          /* per-symbol best effort; cache/last state continues to serve */
        }
      }
      for (const index of this.indices.values()) {
        try {
          const today = await this.yahooProvider.getTodayCandle(index.name);
          if (!today) continue;
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
            time: Date.now(),
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

  /** Apply a real evolving daily candle: state, indicators, events, cache. */
  private applyRealToday(state: SymbolState, today: Candle): void {
    const daily = state.daily;
    const last = daily[daily.length - 1];
    if (last && last.time === today.time) {
      daily[daily.length - 1] = today;
    } else if (!last || today.time > last.time) {
      state.previousClose = last?.close ?? today.close;
      daily.push(today);
    } else {
      return; // stale row
    }
    state.dayVolume = today.volume;
    state.dataSource = 'live';
    state.indicators = computeIndicatorSnapshot(state.info.symbol, daily);
    const tick: Tick = {
      symbol: state.info.symbol,
      exchange: state.info.exchange,
      price: today.close,
      volume: today.volume,
      time: Date.now(),
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

  private toQuote(state: SymbolState): StockQuote {
    const today = state.daily[state.daily.length - 1];
    const price = state.lastTick?.price ?? today.close;
    return {
      ...state.info,
      price: round2(price),
      change: round2(price - state.previousClose),
      changePercent: round2(((price - state.previousClose) / state.previousClose) * 100),
      volume: today.volume,
      dayHigh: today.high,
      dayLow: today.low,
      previousClose: state.previousClose,
      indicators: state.indicators,
      dataSource: state.dataSource,
      updatedAt: state.lastTick?.time ?? today.time,
    };
  }

  private requireSymbol(symbol: string): SymbolState {
    const state = this.stocks.get(symbol);
    if (!state) throw new NotFoundException(`Unknown symbol: ${symbol}`);
    return state;
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
