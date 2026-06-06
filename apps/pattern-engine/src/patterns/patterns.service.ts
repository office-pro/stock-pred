import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import {
  createKafkaClient,
  EventConsumer,
  EventProducer,
  KAFKA_TOPICS,
  MarketCandleEvent,
  PatternDetectedEvent,
} from '@stockpred/shared-events';
import { DetectedPattern, Timeframe } from '@stockpred/shared-types';
import { CandleStore } from './candle-store';
import { detectPatterns } from './detectors';

const DETECTION_INTERVAL_MS = 60 * 1000;
const PATTERN_COOLDOWN_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 120 * 1000;
const KAFKA_RETRY_INITIAL_MS = 5_000;
const KAFKA_RETRY_MAX_MS = 30_000;

@Injectable()
export class PatternsService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = getPrismaClient();
  private readonly kafka = createKafkaClient('pattern-engine');
  private readonly producer = new EventProducer(this.kafka);
  private readonly consumer = new EventConsumer(this.kafka, 'pattern-engine');
  private readonly lastDetectionAt = new Map<string, number>();
  private readonly lastEmitted = new Map<string, number>();
  private pollTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(private readonly store: CandleStore) {}

  onModuleInit(): void {
    // Fire-and-forget: REST comes up immediately, pipelines attach async.
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.store.warmup().catch((error: Error) => {
      console.warn(`[pattern-engine] warmup incomplete: ${error.message}`);
    });
    void this.maintainKafka();
    for (const symbol of this.store.symbols()) {
      await this.detectForSymbol(symbol, true);
    }
  }

  /** Retry Kafka forever; poll REST while disconnected (see signal-engine). */
  private async maintainKafka(): Promise<void> {
    let delay = KAFKA_RETRY_INITIAL_MS;
    while (!this.stopping) {
      try {
        await this.startKafka();
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        console.log('[pattern-engine] consuming market.candles');
        return;
      } catch (error) {
        if (!this.pollTimer) {
          console.warn(
            `[pattern-engine] Kafka unavailable (${(error as Error).message}); polling REST while retrying`,
          );
          this.pollTimer = setInterval(() => void this.pollAndDetect(), POLL_INTERVAL_MS);
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

  async getRecentPatterns(limit: number): Promise<unknown[]> {
    try {
      return await this.prisma.pattern.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    } catch (error) {
      console.warn(`[pattern-engine] history read failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getPatternsForSymbol(symbol: string, limit: number): Promise<unknown> {
    const candles = this.store.get(symbol);
    if (candles.length === 0) throw new NotFoundException(`No data for symbol: ${symbol}`);
    let history: unknown[] = [];
    try {
      history = await this.prisma.pattern.findMany({
        where: { symbol },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.warn(`[pattern-engine] history read failed: ${(error as Error).message}`);
    }
    return { history, current: detectPatterns(candles) };
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
      await this.detectForSymbol(event.candle.symbol, false);
    });
  }

  private async pollAndDetect(): Promise<void> {
    for (const symbol of this.store.symbols()) {
      try {
        await this.store.refreshFromRest(symbol);
        await this.detectForSymbol(symbol, false);
      } catch {
        /* best-effort */
      }
    }
  }

  private async detectForSymbol(symbol: string, force: boolean): Promise<void> {
    const now = Date.now();
    const lastRun = this.lastDetectionAt.get(symbol) ?? 0;
    if (!force && now - lastRun < DETECTION_INTERVAL_MS) return;
    this.lastDetectionAt.set(symbol, now);

    const results = detectPatterns(this.store.get(symbol));
    for (const result of results) {
      const key = `${symbol}:${result.pattern}`;
      const lastAt = this.lastEmitted.get(key) ?? 0;
      if (now - lastAt < PATTERN_COOLDOWN_MS) continue;
      this.lastEmitted.set(key, now);

      const detected: DetectedPattern = {
        symbol,
        pattern: result.pattern,
        confidence: result.confidence,
        signal: result.signal,
        direction: result.direction,
        detectedAt: now,
      };
      await this.persist(detected);
      await this.producer
        .publish<PatternDetectedEvent>(KAFKA_TOPICS.PATTERNS_DETECTED, detected, symbol)
        .catch(() => undefined);
      console.log(
        `[pattern-engine] ${detected.pattern} on ${symbol} (${detected.direction}, confidence ${detected.confidence})`,
      );
    }
  }

  private async persist(pattern: DetectedPattern): Promise<void> {
    try {
      await this.prisma.stock.upsert({
        where: { symbol: pattern.symbol },
        update: {},
        create: {
          symbol: pattern.symbol,
          name: pattern.symbol,
          exchange: 'NSE',
          sector: 'Unknown',
          indices: [],
        },
      });
      await this.prisma.pattern.create({
        data: {
          symbol: pattern.symbol,
          pattern: pattern.pattern,
          direction: pattern.direction,
          confidence: pattern.confidence,
          signal: pattern.signal,
        },
      });
    } catch (error) {
      console.warn(`[pattern-engine] persist failed: ${(error as Error).message}`);
    }
  }
}
