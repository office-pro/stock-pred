import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import {
  createKafkaClient,
  EventConsumer,
  EventProducer,
  KAFKA_TOPICS,
  MarketCandleEvent,
  SignalGeneratedEvent,
} from '@stockpred/shared-events';
import { EvaluatedSignal, SignalType, SupportResistance, Timeframe } from '@stockpred/shared-types';
import {
  computeSupportResistance,
  evaluateSignal,
  SignalEvaluation,
  vwap,
  lastFinite,
} from '@stockpred/shared-utils';
import { CandleStore } from './candle-store';

/** Minimum gap between two published signals for the same symbol. */
const SIGNAL_COOLDOWN_MS = 5 * 60 * 1000;
/** Minimum gap between rule evaluations per symbol (CPU bound). */
const EVALUATION_INTERVAL_MS = 30 * 1000;
/** REST polling cadence when Kafka is unavailable. */
const POLL_INTERVAL_MS = 60 * 1000;
/** Kafka reconnect backoff (topics may not exist yet on a fresh cluster). */
const KAFKA_RETRY_INITIAL_MS = 5_000;
const KAFKA_RETRY_MAX_MS = 30_000;

@Injectable()
export class SignalsService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = getPrismaClient();
  private readonly kafka = createKafkaClient('signal-engine');
  private readonly producer = new EventProducer(this.kafka);
  private readonly consumer = new EventConsumer(this.kafka, 'signal-engine');
  private readonly lastEvaluatedAt = new Map<string, number>();
  private readonly lastEmitted = new Map<string, { type: SignalType; at: number }>();
  private pollTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(private readonly store: CandleStore) {}

  onModuleInit(): void {
    // Fire-and-forget: REST endpoints come up immediately; data pipelines
    // (warmup, Kafka, initial evaluation) attach in the background.
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.store.warmup().catch((error: Error) => {
      console.warn(`[signal-engine] warmup incomplete: ${error.message}`);
    });
    void this.maintainKafka();
    // Evaluate the warmed-up universe once at boot.
    for (const symbol of this.store.symbols()) {
      await this.evaluateSymbol(symbol, true);
    }
  }

  /**
   * Keep trying Kafka forever (topics auto-create asynchronously on fresh
   * clusters); REST polling covers the gap and stops once consuming starts.
   */
  private async maintainKafka(): Promise<void> {
    let delay = KAFKA_RETRY_INITIAL_MS;
    while (!this.stopping) {
      try {
        await this.startKafka();
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        console.log('[signal-engine] consuming market.candles');
        return;
      } catch (error) {
        if (!this.pollTimer) {
          console.warn(
            `[signal-engine] Kafka unavailable (${(error as Error).message}); polling REST while retrying`,
          );
          this.pollTimer = setInterval(() => void this.pollAndEvaluate(), POLL_INTERVAL_MS);
        }
        await this.consumer.disconnect().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, KAFKA_RETRY_MAX_MS);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.consumer.disconnect().catch(() => undefined);
    await this.producer.disconnect().catch(() => undefined);
  }

  // ---------------------------------------------------------------- queries

  async getRecentSignals(limit: number): Promise<unknown[]> {
    try {
      return await this.prisma.signal.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      // Degrade: signal history requires the database, live evaluation does not.
      console.warn(`[signal-engine] history read failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getAllSignals(limit: number): Promise<unknown[]> {
    try {
      // Get current signal evaluation for all symbols
      const signals = [];
      for (const symbol of this.store.symbols()) {
        const candles = this.store.get(symbol);
        if (candles.length === 0) continue;

        const evaluation = evaluateSignal(candles);
        signals.push({
          symbol,
          signal: evaluation.type,
          confidence: evaluation.confidence,
          price: evaluation.price,
          target: evaluation.target ?? 0,
          stopLoss: evaluation.stopLoss ?? 0,
          riskReward: evaluation.riskReward ?? 0,
          rules: evaluation.rules,
          createdAt: new Date(),
        });
      }
      // Sort by confidence descending and limit
      return signals.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, limit);
    } catch (error) {
      console.warn(`[signal-engine] getAllSignals failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getSignalsForSymbol(
    symbol: string,
    limit: number,
  ): Promise<{ history: unknown[]; current: SignalEvaluation }> {
    const candles = this.store.get(symbol);
    if (candles.length === 0) {
      throw new NotFoundException(`No data for symbol: ${symbol}`);
    }
    let history: unknown[] = [];
    try {
      history = await this.prisma.signal.findMany({
        where: { symbol },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.warn(`[signal-engine] history read failed: ${(error as Error).message}`);
    }
    return { history, current: evaluateSignal(candles) };
  }

  getSupportResistance(symbol: string): SupportResistance {
    const candles = this.store.get(symbol);
    if (candles.length === 0) {
      throw new NotFoundException(`No data for symbol: ${symbol}`);
    }
    const vwapValue = lastFinite(vwap(candles.slice(-30)));
    const detail = computeSupportResistance(candles, { vwapValue });
    return { support: detail.support, resistance: detail.resistance };
  }

  async getSignalsPaginated(
    page: number,
    limit: number,
    search?: string,
    signalFilter?: string,
    allSignals?: boolean,
  ): Promise<{
    data: Array<{
      symbol: string;
      signal: string;
      confidence: number;
      price: number;
      target: number;
      stopLoss: number;
      riskReward: number;
      rules: Record<string, unknown>;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    try {
      interface SignalData {
        symbol: string;
        signal: string;
        confidence: number;
        price: number;
        target: number;
        stopLoss: number;
        riskReward: number;
        rules: Record<string, unknown>;
        createdAt: Date;
      }

      let signals: SignalData[] = [];

      if (allSignals) {
        // Get current signal evaluation for all symbols
        for (const symbol of this.store.symbols()) {
          const candles = this.store.get(symbol);
          if (candles.length === 0) continue;

          const evaluation = evaluateSignal(candles);
          signals.push({
            symbol,
            signal: evaluation.type,
            confidence: evaluation.confidence,
            price: evaluation.price,
            target: evaluation.target ?? 0,
            stopLoss: evaluation.stopLoss ?? 0,
            riskReward: evaluation.riskReward ?? 0,
            rules: evaluation.rules,
            createdAt: new Date(),
          });
        }
      } else {
        // Get recent signals from database
        const dbSignals = await this.prisma.signal.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10000, // Fetch more for filtering
        });
        signals = dbSignals.map((s) => ({
          symbol: s.symbol,
          signal: s.signal,
          confidence: typeof s.confidence === 'number' ? s.confidence : 0,
          price: typeof s.price === 'number' ? s.price : 0,
          target: typeof s.target === 'number' ? s.target : 0,
          stopLoss: typeof s.stopLoss === 'number' ? s.stopLoss : 0,
          riskReward: typeof s.riskReward === 'number' ? s.riskReward : 0,
          rules: s.rules as Record<string, unknown>,
          createdAt: s.createdAt,
        }));
      }

      // Filter by search term (symbol or name)
      if (search) {
        const searchUpper = search.toUpperCase();
        signals = signals.filter((s) => s.symbol.includes(searchUpper));
      }

      // Filter by signal type (BUY, SELL, HOLD)
      if (signalFilter) {
        signals = signals.filter((s) => s.signal === signalFilter);
      }

      // Sort by confidence descending
      signals.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

      const total = signals.length;
      const start = (page - 1) * limit;
      const data = signals.slice(start, start + limit);
      const hasMore = start + limit < total;

      return { data, total, page, limit, hasMore };
    } catch (error) {
      console.warn(`[signal-engine] getSignalsPaginated failed: ${(error as Error).message}`);
      return { data: [], total: 0, page, limit, hasMore: false };
    }
  }

  // ------------------------------------------------------------- internals

  /** Single connection attempt; throws so the retry loop can back off. */
  private async startKafka(): Promise<void> {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe([KAFKA_TOPICS.MARKET_CANDLES]);
    await this.consumer.run(async (_topic, envelope) => {
      const event = envelope.payload as MarketCandleEvent;
      if (event.candle.timeframe !== Timeframe.ONE_DAY) return;
      this.store.apply(event.candle);
      await this.evaluateSymbol(event.candle.symbol, false);
    });
  }

  private async pollAndEvaluate(): Promise<void> {
    for (const symbol of this.store.symbols()) {
      try {
        await this.store.refreshFromRest(symbol);
        await this.evaluateSymbol(symbol, false);
      } catch {
        /* polling is best-effort */
      }
    }
  }

  private async evaluateSymbol(symbol: string, force: boolean): Promise<void> {
    const now = Date.now();
    const lastRun = this.lastEvaluatedAt.get(symbol) ?? 0;
    if (!force && now - lastRun < EVALUATION_INTERVAL_MS) return;
    this.lastEvaluatedAt.set(symbol, now);

    const evaluation = evaluateSignal(this.store.get(symbol));
    if (evaluation.type === SignalType.HOLD) return; // only actionable signals

    const previous = this.lastEmitted.get(symbol);
    if (previous && previous.type === evaluation.type && now - previous.at < SIGNAL_COOLDOWN_MS) {
      return;
    }
    this.lastEmitted.set(symbol, { type: evaluation.type, at: now });

    const signal: EvaluatedSignal = {
      symbol,
      signal: evaluation.type === SignalType.BUY ? 'BUY' : 'SELL',
      confidence: evaluation.confidence,
      target: evaluation.target ?? 0,
      stopLoss: evaluation.stopLoss ?? 0,
      price: evaluation.price,
      riskReward: evaluation.riskReward ?? 0,
      rules: evaluation.rules,
      generatedAt: now,
    };

    await this.persist(signal);
    await this.producer
      .publish<SignalGeneratedEvent>(KAFKA_TOPICS.SIGNALS_GENERATED, signal, symbol)
      .catch(() => undefined);
    console.log(
      `[signal-engine] ${signal.signal} ${symbol} @ ${signal.price} (confidence ${signal.confidence}, target ${signal.target}, stop ${signal.stopLoss})`,
    );
  }

  private async persist(signal: EvaluatedSignal): Promise<void> {
    try {
      await this.prisma.stock.upsert({
        where: { symbol: signal.symbol },
        update: {},
        create: {
          symbol: signal.symbol,
          name: signal.symbol,
          exchange: 'NSE',
          sector: 'Unknown',
          indices: [],
        },
      });
      await this.prisma.signal.create({
        data: {
          symbol: signal.symbol,
          signal: signal.signal,
          confidence: signal.confidence,
          price: signal.price,
          target: signal.target,
          stopLoss: signal.stopLoss,
          riskReward: signal.riskReward,
          rules: signal.rules,
        },
      });
    } catch (error) {
      console.warn(`[signal-engine] persist failed: ${(error as Error).message}`);
    }
  }
}
