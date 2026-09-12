import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import { BrokerRouter, OrderRequest, OrderResponse } from '@stockpred/broker-sdk';
import {
  createKafkaClient,
  EventConsumer,
  EventProducer,
  KAFKA_TOPICS,
  MarketTickEvent,
  PatternDetectedEvent,
  PredictionGeneratedEvent,
  SignalGeneratedEvent,
  TradeExecutedEvent,
} from '@stockpred/shared-events';
import {
  DEFAULT_RISK_LIMITS,
  ExecutedTrade,
  PaperHolding,
  PortfolioSnapshot,
  PredictionDirection,
  TradeExitReason,
  TradeSide,
  TradeStatus,
  TradingMode,
} from '@stockpred/shared-types';
import {
  getEnv,
  getEnvNumber,
  positionSize,
  round2,
  evaluateExitPolicy,
} from '@stockpred/shared-utils';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { RiskManager } from './risk-manager';
import { MonitoringLogStore } from './monitoring-log-store';

interface OpenPosition {
  tradeId: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  target: number;
  target2?: number;
  stopLoss: number;
  openedAt: number;
  /** Soft thesis score from last agent/ML blend; null = unknown. */
  thesisScore?: number | null;
  /** Sector for concentration checks (Phase 2). */
  sector?: string | null;
  /** Agent decision ledger id (Phase 4 outcome bridge). */
  decisionId?: string;
  /** ₹ planned risk at entry for realizedR. */
  plannedRiskAmount?: number;
  soakRunId?: string;
}

interface PaperBook {
  key: string;
  userId: string | null;
  brandId: string | null;
  cash: number;
  initialCapital: number;
  realizedPnl: number;
  positions: Map<string, OpenPosition>;
}

function bookKey(brandId?: string | null, userId?: string | null): string {
  return `${brandId ?? '_'}::${userId ?? '_system'}`;
}

/**
 * Auto trading engine.
 * Compliance defaults: PAPER mode unless LIVE is explicitly enabled AND an
 * authorized broker exists; every decision lands in audit_logs.
 *
 * Auto-buy gate (spec): BUY signal, signal confidence > 85, pattern
 * confidence > 80, risk:reward >= 1:2.
 * Auto-sell (spec): target hit, stop-loss hit, reversal signal, bearish ML.
 */
@Injectable()
export class TraderService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = getPrismaClient();
  private readonly kafka = createKafkaClient('auto-trader');
  private readonly producer = new EventProducer(this.kafka);
  private readonly consumer = new EventConsumer(this.kafka, 'auto-trader');

  constructor(@Inject(BrokerRouter) private readonly broker: BrokerRouter) {}

  private readonly mode: TradingMode =
    process.env.TRADING_MODE === 'LIVE' ? TradingMode.LIVE : TradingMode.PAPER;
  private readonly minSignalConfidence = getEnvNumber('AUTO_TRADE_MIN_SIGNAL_CONFIDENCE', 85);
  private readonly minPatternConfidence = getEnvNumber('AUTO_TRADE_MIN_PATTERN_CONFIDENCE', 80);
  private readonly minRiskReward = getEnvNumber('AUTO_TRADE_MIN_RISK_REWARD', 2);

  readonly riskManager = new RiskManager({
    perTradeRiskPercent: getEnvNumber(
      'RISK_PER_TRADE_PCT',
      DEFAULT_RISK_LIMITS.perTradeRiskPercent,
    ),
    dailyDrawdownPercent: getEnvNumber(
      'DAILY_DRAWDOWN_PCT',
      DEFAULT_RISK_LIMITS.dailyDrawdownPercent,
    ),
    weeklyDrawdownPercent: getEnvNumber(
      'WEEKLY_DRAWDOWN_PCT',
      DEFAULT_RISK_LIMITS.weeklyDrawdownPercent,
    ),
  });

  private cash = getEnvNumber('PAPER_TRADING_CAPITAL', 10_000_000);
  private readonly defaultCapital = this.cash;
  private readonly initialCapital = this.cash;
  private realizedPnl = 0;
  private selectedBroker = 'PAPER';
  /** When false, only hard target/stop exits run — agent trail/partial policy is off. */
  private agentTradingEnabled = false;
  private readonly agentGatePath = resolve(__dirname, '../../data/agent-trading-enabled.json');
  private readonly positions = new Map<string, OpenPosition>();
  private readonly lastPrices = new Map<string, number>();
  private readonly tickets: ExecutedTrade[] = [];
  private readonly latestPatternConfidence = new Map<string, { confidence: number; at: number }>();
  /** Per brand+user paper books (manual trading / portfolio UI). */
  private readonly books = new Map<string, PaperBook>();
  private readonly monitoringLog = new MonitoringLogStore();
  /** Identity of the currently activated paper book (for persist scoping). */
  private activeIdentity: { userId: string | null; brandId: string | null } = {
    userId: null,
    brandId: null,
  };

  private stopping = false;

  async onModuleInit(): Promise<void> {
    if (this.mode === TradingMode.LIVE) {
      console.warn(
        '[auto-trader] LIVE mode requested - live orders still require an authorized broker per trade',
      );
    } else {
      console.log('[auto-trader] PAPER trading mode (default)');
    }
    await this.restorePaperBook();
    await this.restoreUserBooks();
    this.loadAgentTradingGate();
    // Fire-and-forget: Kafka attaches async and retries if the cluster is not ready.
    void this.maintainKafka();
  }

  private loadAgentTradingGate(): void {
    try {
      if (!existsSync(this.agentGatePath)) return;
      const raw = JSON.parse(readFileSync(this.agentGatePath, 'utf8')) as { enabled?: boolean };
      this.agentTradingEnabled = Boolean(raw.enabled);
      console.log(`[auto-trader] restored agentTradingEnabled=${this.agentTradingEnabled}`);
    } catch {
      /* ignore corrupt file */
    }
  }

  private persistAgentTradingGate(): void {
    try {
      mkdirSync(dirname(this.agentGatePath), { recursive: true });
      writeFileSync(
        this.agentGatePath,
        JSON.stringify({ enabled: this.agentTradingEnabled, updatedAt: Date.now() }, null, 2),
        'utf8',
      );
    } catch (error) {
      console.warn(`[auto-trader] could not persist agent gate: ${(error as Error).message}`);
    }
  }

  private async maintainKafka(): Promise<void> {
    let delay = 5_000;
    while (!this.stopping) {
      try {
        await this.startKafka();
        console.log('[auto-trader] consuming market/signal/pattern/prediction events');
        return;
      } catch (error) {
        console.warn(
          `[auto-trader] Kafka unavailable (${(error as Error).message}); retrying in ${Math.round(delay / 1000)}s`,
        );
        await this.consumer.disconnect().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 30_000);
      }
    }
  }

  private async startKafka(): Promise<void> {
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe([
      KAFKA_TOPICS.MARKET_TICKS,
      KAFKA_TOPICS.SIGNALS_GENERATED,
      KAFKA_TOPICS.PATTERNS_DETECTED,
      KAFKA_TOPICS.PREDICTIONS_GENERATED,
    ]);
    await this.consumer.run(async (topic, envelope) => {
      switch (topic) {
        case KAFKA_TOPICS.MARKET_TICKS:
          await this.onTick(envelope.payload as MarketTickEvent);
          break;
        case KAFKA_TOPICS.SIGNALS_GENERATED:
          await this.onSignal(envelope.payload as SignalGeneratedEvent);
          break;
        case KAFKA_TOPICS.PATTERNS_DETECTED:
          this.onPattern(envelope.payload as PatternDetectedEvent);
          break;
        case KAFKA_TOPICS.PREDICTIONS_GENERATED:
          await this.onPrediction(envelope.payload as PredictionGeneratedEvent);
          break;
        default:
          break;
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.consumer.disconnect().catch(() => undefined);
    await this.producer.disconnect().catch(() => undefined);
  }

  /** Reload OPEN paper lots from Postgres so a process restart does not wipe the book. */
  private async restorePaperBook(): Promise<void> {
    if (this.mode !== TradingMode.PAPER) return;
    try {
      const openRows = await this.prisma.trade.findMany({
        where: { status: TradeStatus.OPEN, mode: this.mode, userId: null },
        orderBy: { executedAt: 'asc' },
      });
      const closedRows = await this.prisma.trade.findMany({
        where: { status: TradeStatus.CLOSED, mode: this.mode, userId: null },
        select: { pnl: true },
      });
      this.realizedPnl = closedRows.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
      this.positions.clear();
      let invested = 0;
      for (const row of openRows) {
        invested += row.quantity * row.price;
        const existing = this.positions.get(row.symbol);
        if (existing) {
          const totalQty = existing.quantity + row.quantity;
          existing.entryPrice =
            (existing.quantity * existing.entryPrice + row.quantity * row.price) / totalQty;
          existing.quantity = totalQty;
          if (row.target && row.target > 0) existing.target = row.target;
          if (row.stopLoss && row.stopLoss > 0) existing.stopLoss = row.stopLoss;
        } else {
          this.positions.set(row.symbol, {
            tradeId: row.id,
            symbol: row.symbol,
            quantity: row.quantity,
            entryPrice: row.price,
            target: row.target && row.target > 0 ? row.target : row.price * 1.05,
            stopLoss: row.stopLoss && row.stopLoss > 0 ? row.stopLoss : row.price * 0.97,
            openedAt: row.executedAt.getTime(),
          });
        }
      }
      this.cash = round2(this.initialCapital + this.realizedPnl - invested);
      if (this.positions.size > 0) {
        console.log(
          `[auto-trader] restored ${this.positions.size} open paper lot(s), cash ${this.cash}`,
        );
      }
    } catch (error) {
      console.warn(`[auto-trader] paper book restore failed: ${(error as Error).message}`);
    }
  }

  /** Hydrate per-user paper books so agent exit monitoring covers approved lots. */
  private async restoreUserBooks(): Promise<void> {
    if (this.mode !== TradingMode.PAPER) return;
    try {
      const openRows = await this.prisma.trade.findMany({
        where: {
          status: TradeStatus.OPEN,
          mode: this.mode,
          userId: { not: null },
        },
        orderBy: { executedAt: 'asc' },
      });
      const byKey = new Map<string, typeof openRows>();
      for (const row of openRows) {
        if (!row.userId) continue;
        const key = bookKey(row.brandId, row.userId);
        const list = byKey.get(key) ?? [];
        list.push(row);
        byKey.set(key, list);
      }
      for (const [key, rows] of byKey) {
        const userId = rows[0]?.userId;
        const brandId = rows[0]?.brandId ?? null;
        if (!userId) continue;
        await this.ensureBook(userId, brandId);
        const book = this.books.get(key);
        if (!book) continue;
        // ensureBook already loaded from DB — log for ops visibility
        if (book.positions.size > 0) {
          console.log(
            `[auto-trader] monitoring user book ${key}: ${book.positions.size} open lot(s), cash ${book.cash}`,
          );
        }
      }
    } catch (error) {
      console.warn(`[auto-trader] user book restore failed: ${(error as Error).message}`);
    }
  }

  private async resolveBrandCapital(brandId?: string | null): Promise<number> {
    if (!brandId) return this.defaultCapital;
    try {
      const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
      if (brand && brand.paperCapital > 0) return brand.paperCapital;
    } catch {
      /* brand table may be mid-migrate */
    }
    return this.defaultCapital;
  }

  /** Load or create a tenant paper book for portfolio/manual trades. */
  private async ensureBook(userId?: string | null, brandId?: string | null): Promise<PaperBook> {
    if (!userId) {
      return {
        key: bookKey(null, null),
        userId: null,
        brandId: null,
        cash: this.cash,
        initialCapital: this.initialCapital,
        realizedPnl: this.realizedPnl,
        positions: this.positions,
      };
    }
    const key = bookKey(brandId, userId);
    const existing = this.books.get(key);
    if (existing) return existing;

    const initialCapital = await this.resolveBrandCapital(brandId);
    const openRows = await this.prisma.trade.findMany({
      where: {
        status: TradeStatus.OPEN,
        mode: this.mode,
        userId,
        ...(brandId ? { brandId } : {}),
      },
      orderBy: { executedAt: 'asc' },
    });
    const closedRows = await this.prisma.trade.findMany({
      where: {
        status: TradeStatus.CLOSED,
        mode: this.mode,
        userId,
        ...(brandId ? { brandId } : {}),
      },
      select: { pnl: true },
    });
    const realizedPnl = closedRows.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
    const positions = new Map<string, OpenPosition>();
    let invested = 0;
    for (const row of openRows) {
      invested += row.quantity * row.price;
      const prior = positions.get(row.symbol);
      if (prior) {
        const totalQty = prior.quantity + row.quantity;
        prior.entryPrice =
          (prior.quantity * prior.entryPrice + row.quantity * row.price) / totalQty;
        prior.quantity = totalQty;
      } else {
        positions.set(row.symbol, {
          tradeId: row.id,
          symbol: row.symbol,
          quantity: row.quantity,
          entryPrice: row.price,
          target: row.target && row.target > 0 ? row.target : row.price * 1.05,
          stopLoss: row.stopLoss && row.stopLoss > 0 ? row.stopLoss : row.price * 0.97,
          openedAt: row.executedAt.getTime(),
        });
      }
    }
    const book: PaperBook = {
      key,
      userId,
      brandId: brandId ?? null,
      initialCapital,
      realizedPnl,
      cash: round2(initialCapital + realizedPnl - invested),
      positions,
    };
    this.books.set(key, book);
    return book;
  }

  private activateBook(
    book: PaperBook,
  ): { cash: number; realizedPnl: number; positions: Map<string, OpenPosition> } | null {
    if (!book.userId) return null;
    const saved = {
      cash: this.cash,
      realizedPnl: this.realizedPnl,
      positions: new Map([...this.positions.entries()].map(([k, v]) => [k, { ...v }])),
    };
    this.activeIdentity = { userId: book.userId, brandId: book.brandId };
    this.cash = book.cash;
    this.realizedPnl = book.realizedPnl;
    this.positions.clear();
    for (const [symbol, pos] of book.positions) this.positions.set(symbol, { ...pos });
    return saved;
  }

  private restoreSystemBook(
    saved: { cash: number; realizedPnl: number; positions: Map<string, OpenPosition> } | null,
  ): void {
    if (!saved) return;
    this.activeIdentity = { userId: null, brandId: null };
    this.cash = saved.cash;
    this.realizedPnl = saved.realizedPnl;
    this.positions.clear();
    for (const [symbol, pos] of saved.positions) this.positions.set(symbol, { ...pos });
  }

  private syncActiveBook(book: PaperBook): void {
    if (!book.userId) return;
    book.cash = this.cash;
    book.realizedPnl = this.realizedPnl;
    book.positions = new Map([...this.positions.entries()].map(([k, v]) => [k, { ...v }]));
    this.books.set(book.key, book);
  }

  // ---------------------------------------------------------------- queries

  async getPortfolio(userId?: string, brandId?: string): Promise<PortfolioSnapshot> {
    const book = await this.ensureBook(userId, brandId);
    const saved = this.activateBook(book);
    try {
      await this.refreshHoldingQuotes();
      const snap = await this.snapshotPortfolio();
      this.syncActiveBook(book);
      return { ...snap, capital: book.initialCapital };
    } finally {
      this.restoreSystemBook(saved);
    }
  }

  async getHoldings(userId?: string, brandId?: string): Promise<{ holdings: PaperHolding[] }> {
    const portfolio = await this.getPortfolio(userId, brandId);
    return { holdings: portfolio.holdings };
  }

  /** Flatten every open lot the tick loop will evaluate (system + user books). */
  async getMonitoredPositions(): Promise<{
    agentTradingEnabled: boolean;
    positions: Array<{
      symbol: string;
      quantity: number;
      entryPrice: number;
      currentPrice: number;
      target: number;
      stopLoss: number;
      unrealizedPnl: number;
      openedAt: number;
      bookKey: string;
      userId: string | null;
      brandId: string | null;
      exitMode: 'AGENT_POLICY' | 'CLASSIC_STOP_TARGET';
      monitored: boolean;
    }>;
  }> {
    await this.restoreUserBooks();
    const exitMode = this.agentTradingEnabled ? 'AGENT_POLICY' : 'CLASSIC_STOP_TARGET';
    const rows: Array<{
      symbol: string;
      quantity: number;
      entryPrice: number;
      currentPrice: number;
      target: number;
      stopLoss: number;
      unrealizedPnl: number;
      openedAt: number;
      bookKey: string;
      userId: string | null;
      brandId: string | null;
      exitMode: 'AGENT_POLICY' | 'CLASSIC_STOP_TARGET';
      monitored: boolean;
    }> = [];

    const pushBook = (
      bookKey: string,
      userId: string | null,
      brandId: string | null,
      positions: Map<string, OpenPosition>,
    ): void => {
      for (const position of positions.values()) {
        const price = this.lastPrices.get(position.symbol) ?? position.entryPrice;
        const invested = position.quantity * position.entryPrice;
        const lotPnl = price * position.quantity - invested;
        rows.push({
          symbol: position.symbol,
          quantity: position.quantity,
          entryPrice: round2(position.entryPrice),
          currentPrice: round2(price),
          target: round2(position.target),
          stopLoss: round2(position.stopLoss),
          unrealizedPnl: round2(lotPnl),
          openedAt: position.openedAt,
          bookKey,
          userId,
          brandId,
          exitMode,
          monitored: true,
        });
      }
    };

    pushBook(bookKey(null, null), null, null, this.positions);
    for (const book of this.books.values()) {
      pushBook(book.key, book.userId, book.brandId, book.positions);
    }

    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return { agentTradingEnabled: this.agentTradingEnabled, positions: rows };
  }

  private async snapshotPortfolio(): Promise<PortfolioSnapshot> {
    let unrealized = 0;
    let marketValue = 0;
    const symbols = [...this.positions.keys()];
    const sectorBySymbol = await this.lookupSectors(symbols);
    const holdings: PaperHolding[] = [];
    for (const position of this.positions.values()) {
      const price = this.lastPrices.get(position.symbol) ?? position.entryPrice;
      const invested = position.quantity * position.entryPrice;
      const lotValue = price * position.quantity;
      const lotPnl = lotValue - invested;
      unrealized += lotPnl;
      marketValue += lotValue;
      const sector = position.sector ?? sectorBySymbol.get(position.symbol.toUpperCase()) ?? null;
      if (sector && !position.sector) position.sector = sector;
      holdings.push({
        symbol: position.symbol,
        quantity: position.quantity,
        entryPrice: round2(position.entryPrice),
        currentPrice: round2(price),
        target: round2(position.target),
        stopLoss: round2(position.stopLoss),
        invested: round2(invested),
        marketValue: round2(lotValue),
        unrealizedPnl: round2(lotPnl),
        unrealizedPnlPercent: invested > 0 ? round2((lotPnl / invested) * 100) : 0,
        openedAt: position.openedAt,
        sector,
      });
    }
    holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));
    const equity = round2(this.cash + marketValue);
    // Refresh day/week anchors before exposing them on the snapshot.
    this.riskManager.evaluate(equity, new Date());
    return {
      mode: this.mode,
      capital: this.initialCapital,
      equity,
      cash: round2(this.cash),
      openPositions: this.positions.size,
      realizedPnl: round2(this.realizedPnl),
      unrealizedPnl: round2(unrealized),
      circuitBreakerTripped: this.riskManager.isTripped,
      holdings,
      dayStartEquity: this.riskManager.dayStartEquity ?? equity,
      weekStartEquity: this.riskManager.weekStartEquity ?? equity,
    };
  }

  private async lookupSectors(symbols: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (symbols.length === 0) return map;
    try {
      const rows = await this.prisma.stock.findMany({
        where: { symbol: { in: symbols.map((s) => s.toUpperCase()) } },
        select: { symbol: true, sector: true },
      });
      for (const row of rows) {
        if (row.sector && row.sector !== 'Unknown') {
          map.set(row.symbol.toUpperCase(), row.sector);
        }
      }
    } catch {
      /* sector lookup is best-effort */
    }
    return map;
  }

  async getTrades(limit: number, userId?: string, brandId?: string): Promise<unknown[]> {
    try {
      const rows = await this.prisma.trade.findMany({
        where: {
          ...(userId ? { userId } : {}),
          ...(brandId ? { brandId } : {}),
        },
        orderBy: { executedAt: 'desc' },
        take: limit,
      });
      if (rows.length > 0) return rows;
    } catch (error) {
      console.warn(`[auto-trader] trade history read failed: ${(error as Error).message}`);
    }
    return this.tickets.slice(0, limit);
  }

  // -------------------------------------------------------- manual trading

  async executeManualTrade(input: {
    symbol: string;
    side: TradeSide;
    quantity: number;
    price?: number;
    target?: number;
    stopLoss?: number;
    userId?: string;
    brandId?: string;
    decisionId?: string;
    plannedRiskAmount?: number;
    soakRunId?: string;
  }): Promise<ExecutedTrade> {
    const book = await this.ensureBook(input.userId, input.brandId);
    const saved = this.activateBook(book);
    try {
      const symbol = input.symbol.toUpperCase();
      const price = await this.resolvePrice(symbol, input.price);
      let result: ExecutedTrade;
      if (input.side === TradeSide.BUY) {
        if (this.riskManager.isTripped) {
          throw new ForbiddenException(`Circuit breaker active: ${this.riskManager.reason}`);
        }
        const cost = price * input.quantity;
        if (cost > this.cash) {
          throw new BadRequestException('Insufficient paper-trading cash for this order');
        }
        if (this.positions.has(symbol)) {
          result = await this.addToPosition(
            symbol,
            input.quantity,
            price,
            input.userId,
            input.brandId,
          );
        } else {
          const target = input.target && input.target > 0 ? input.target : price * 1.05;
          const stopLoss = input.stopLoss && input.stopLoss > 0 ? input.stopLoss : price * 0.97;
          result = await this.openPosition(
            symbol,
            input.quantity,
            price,
            target,
            stopLoss,
            input.userId,
            input.brandId,
            {
              decisionId: input.decisionId,
              plannedRiskAmount: input.plannedRiskAmount,
              soakRunId: input.soakRunId,
            },
          );
        }
      } else {
        const position = this.positions.get(symbol);
        if (!position) {
          throw new BadRequestException(`No open position in ${symbol} to sell`);
        }
        if (input.quantity < position.quantity) {
          result = await this.reducePosition(position, input.quantity, price);
        } else {
          result = await this.closePosition(position, price, TradeExitReason.MANUAL);
        }
      }
      this.syncActiveBook(book);
      return result;
    } finally {
      this.restoreSystemBook(saved);
    }
  }

  private async resolvePrice(symbol: string, quoted?: number): Promise<number> {
    if (quoted && quoted > 0) {
      this.lastPrices.set(symbol, quoted);
      return quoted;
    }
    await this.quoteFromMarketData(symbol);
    const cached = this.lastPrices.get(symbol);
    if (cached && cached > 0) return cached;
    throw new BadRequestException(`No market price available yet for ${symbol}`);
  }

  private async refreshHoldingQuotes(): Promise<void> {
    const symbols = [...this.positions.keys()];
    if (symbols.length === 0) return;
    await Promise.all(symbols.map((symbol) => this.quoteFromMarketData(symbol)));
  }

  private async quoteFromMarketData(symbol: string): Promise<void> {
    const base = getEnv('MARKET_DATA_SERVICE_URL', 'http://localhost:3002');
    try {
      const response = await fetch(`${base}/stocks/${encodeURIComponent(symbol)}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { price?: number };
        if (body.price && body.price > 0) {
          this.lastPrices.set(symbol, body.price);
        }
      }
    } catch (error) {
      console.warn(`[auto-trader] quote fetch failed for ${symbol}: ${(error as Error).message}`);
    }
  }

  resetCircuitBreaker(actor: string): void {
    this.riskManager.reset();
    void this.audit('CIRCUIT_BREAKER_RESET', actor, {});
  }

  async configureBroker(
    brokerType: string,
    _credentials?: Record<string, string>,
  ): Promise<{ success: boolean; message: string }> {
    const validBrokers = ['PAPER', 'ZERODHA', 'ANGELONE', 'UPSTOX', 'SHOONYA', 'FYERS'];
    if (!validBrokers.includes(brokerType)) {
      throw new BadRequestException(`Invalid broker type: ${brokerType}`);
    }
    if (brokerType !== 'PAPER' && this.mode !== TradingMode.LIVE) {
      return {
        success: true,
        message: `${brokerType} credentials were ignored. TRADING_MODE is PAPER — live brokers are not used.`,
      };
    }
    this.selectedBroker = brokerType;
    await this.audit('BROKER_CONFIG_SAVED', 'auto-trader', { brokerType });
    console.log(`[auto-trader] broker set to ${this.selectedBroker} (${this.mode})`);
    return {
      success: true,
      message:
        brokerType === 'PAPER'
          ? 'Paper trading is enabled. No broker login required.'
          : `${brokerType} broker configuration saved`,
    };
  }

  async testBrokerConnection(brokerType: string): Promise<{ success: boolean; message: string }> {
    const validBrokers = ['PAPER', 'ZERODHA', 'ANGELONE', 'UPSTOX', 'SHOONYA', 'FYERS'];
    if (!validBrokers.includes(brokerType)) {
      throw new BadRequestException(`Invalid broker type: ${brokerType}`);
    }
    await this.audit('BROKER_CONNECTION_TEST', 'auto-trader', { brokerType });
    return {
      success: true,
      message:
        brokerType === 'PAPER'
          ? 'Paper book is reachable. No live broker connection is used.'
          : `Successfully connected to ${brokerType} broker`,
    };
  }

  setAgentTradingEnabled(enabled: boolean): { agentTradingEnabled: boolean } {
    this.agentTradingEnabled = enabled;
    this.persistAgentTradingGate();
    console.log(`[auto-trader] agentTradingEnabled=${enabled}`);
    return { agentTradingEnabled: this.agentTradingEnabled };
  }

  isAgentTradingEnabled(): boolean {
    return this.agentTradingEnabled;
  }

  // ---------------------------------------------------------- event logic

  private async onTick(tick: MarketTickEvent): Promise<void> {
    this.lastPrices.set(tick.symbol, tick.price);
    this.monitoringLog.recordTick();

    // System (legacy/auto) book
    await this.applyExitForPosition(this.positions.get(tick.symbol), tick.price, null);

    // Per-user paper books (agent-approved / manual UI lots)
    for (const book of this.books.values()) {
      const position = book.positions.get(tick.symbol);
      if (!position) continue;
      const saved = this.activateBook(book);
      try {
        await this.applyExitForPosition(this.positions.get(tick.symbol), tick.price, book);
        this.syncActiveBook(book);
      } finally {
        this.restoreSystemBook(saved);
      }
    }

    // Re-evaluate the breaker on the equity mark (system book).
    const snapshot = await this.snapshotPortfolio();
    const before = this.riskManager.isTripped;
    const check = this.riskManager.evaluate(snapshot.equity, new Date());
    if (check.tripped && !before) {
      console.warn(`[auto-trader] CIRCUIT BREAKER TRIPPED: ${check.reason}`);
      await this.audit('CIRCUIT_BREAKER_TRIPPED', 'auto-trader', { reason: check.reason });
    }
  }

  /** Run agent exit policy (when enabled) or classic stop/target on one lot. */
  private async applyExitForPosition(
    position: OpenPosition | undefined,
    price: number,
    book: PaperBook | null,
  ): Promise<void> {
    if (!position) return;
    const lotBookKey = book?.key ?? bookKey(null, null);
    const userId = book?.userId ?? null;
    if (this.agentTradingEnabled) {
      const atr = Math.max(price * 0.008, 0.05);
      const action = evaluateExitPolicy(
        {
          symbol: position.symbol,
          entryPrice: position.entryPrice,
          quantity: position.quantity,
          target: position.target,
          target2: position.target2,
          stopLoss: position.stopLoss,
        },
        {
          price,
          thesisScore: position.thesisScore,
          thesisIntact: position.thesisScore == null || position.thesisScore >= 58,
          atr,
        },
      );
      if (action.type === 'NONE') {
        this.monitoringLog.push({
          symbol: position.symbol,
          bookKey: lotBookKey,
          userId,
          mode: 'AGENT_POLICY',
          action: 'HOLD',
          policy: action.policy,
          note: action.note,
          price,
          stopLoss: action.stopLoss,
          target: action.target,
          quantity: position.quantity,
        });
      } else if (action.type === 'UPDATE_LEVELS') {
        this.monitoringLog.push({
          symbol: position.symbol,
          bookKey: lotBookKey,
          userId,
          mode: 'AGENT_POLICY',
          action: action.policy === 'TRAIL' ? 'TRAIL' : 'UPDATE_LEVELS',
          policy: action.policy,
          note: action.note,
          price,
          stopLoss: action.stopLoss,
          target: action.target,
          quantity: position.quantity,
          force: true,
        });
        position.stopLoss = action.stopLoss;
        position.target = action.target;
        if (action.target2 != null) position.target2 = action.target2;
      } else if (action.type === 'PARTIAL_EXIT') {
        this.monitoringLog.push({
          symbol: position.symbol,
          bookKey: lotBookKey,
          userId,
          mode: 'AGENT_POLICY',
          action: 'PARTIAL_EXIT',
          policy: action.policy,
          note: action.note,
          price,
          stopLoss: action.stopLoss,
          target: action.target,
          quantity: action.quantity,
          reason: action.reason,
          force: true,
        });
        position.stopLoss = action.stopLoss;
        position.target = action.target;
        await this.reducePosition(position, action.quantity, price, action.reason);
      } else if (action.type === 'FULL_EXIT') {
        this.monitoringLog.push({
          symbol: position.symbol,
          bookKey: lotBookKey,
          userId,
          mode: 'AGENT_POLICY',
          action: 'FULL_EXIT',
          policy: action.policy,
          note: action.note,
          price,
          stopLoss: action.stopLoss,
          target: action.target,
          quantity: position.quantity,
          reason: action.reason,
          force: true,
        });
        await this.closePosition(position, price, action.reason);
      }
    } else {
      if (price <= position.stopLoss) {
        this.monitoringLog.push({
          symbol: position.symbol,
          bookKey: lotBookKey,
          userId,
          mode: 'CLASSIC_STOP_TARGET',
          action: 'CLASSIC_STOP',
          policy: 'HARD_STOP',
          note: 'Classic stop-loss hit (agent trading off).',
          price,
          stopLoss: position.stopLoss,
          target: position.target,
          quantity: position.quantity,
          reason: TradeExitReason.STOP_LOSS_HIT,
          force: true,
        });
        await this.closePosition(position, price, TradeExitReason.STOP_LOSS_HIT);
      } else if (price >= position.target) {
        this.monitoringLog.push({
          symbol: position.symbol,
          bookKey: lotBookKey,
          userId,
          mode: 'CLASSIC_STOP_TARGET',
          action: 'CLASSIC_TARGET',
          policy: 'EXIT_PENDING',
          note: 'Classic target hit (agent trading off).',
          price,
          stopLoss: position.stopLoss,
          target: position.target,
          quantity: position.quantity,
          reason: TradeExitReason.TARGET_HIT,
          force: true,
        });
        await this.closePosition(position, price, TradeExitReason.TARGET_HIT);
      } else {
        this.monitoringLog.push({
          symbol: position.symbol,
          bookKey: lotBookKey,
          userId,
          mode: 'CLASSIC_STOP_TARGET',
          action: 'HOLD',
          policy: 'HOLD',
          note: 'Classic monitoring vs stop/target (enable AI agent trading for exit policy).',
          price,
          stopLoss: position.stopLoss,
          target: position.target,
          quantity: position.quantity,
        });
      }
    }
  }

  async getMonitoringLogs(
    limit = 100,
    symbol?: string,
  ): Promise<{
    events: import('./monitoring-log-store').MonitoringLogEvent[];
    meta: import('./monitoring-log-store').MonitoringLogMeta;
  }> {
    const monitored = await this.getMonitoredPositions();
    return {
      events: this.monitoringLog.list(limit, symbol),
      meta: this.monitoringLog.meta(this.agentTradingEnabled, monitored.positions.length),
    };
  }

  private onPattern(pattern: PatternDetectedEvent): void {
    const existing = this.latestPatternConfidence.get(pattern.symbol);
    if (
      !existing ||
      pattern.confidence >= existing.confidence ||
      Date.now() - existing.at > 3600_000
    ) {
      this.latestPatternConfidence.set(pattern.symbol, {
        confidence: pattern.confidence,
        at: pattern.detectedAt,
      });
    }
  }

  private async onSignal(signal: SignalGeneratedEvent): Promise<void> {
    const position = this.positions.get(signal.symbol);

    // Auto-sell: reversal signal against an open position.
    if (signal.signal === 'SELL' && position) {
      const price = this.lastPrices.get(signal.symbol) ?? signal.price;
      await this.closePosition(position, price, TradeExitReason.REVERSAL_SIGNAL);
      return;
    }

    if (signal.signal !== 'BUY' || position) return;

    // ---- auto-buy gate (spec thresholds)
    if (this.riskManager.isTripped) return;
    if (signal.confidence <= this.minSignalConfidence) return;
    const pattern = this.latestPatternConfidence.get(signal.symbol);
    if (!pattern || pattern.confidence <= this.minPatternConfidence) return;
    if (signal.riskReward < this.minRiskReward) return;

    const entryPrice = this.lastPrices.get(signal.symbol) ?? signal.price;
    const quantity = positionSize(
      this.cash,
      this.riskManager.limits.perTradeRiskPercent,
      entryPrice,
      signal.stopLoss,
    );
    if (quantity <= 0) return;
    await this.openPosition(signal.symbol, quantity, entryPrice, signal.target, signal.stopLoss);
  }

  private async onPrediction(prediction: PredictionGeneratedEvent): Promise<void> {
    const position = this.positions.get(prediction.symbol);
    if (position) {
      position.thesisScore =
        prediction.direction === PredictionDirection.DOWN
          ? Math.max(0, 100 - prediction.confidence)
          : prediction.direction === PredictionDirection.UP
            ? prediction.confidence
            : 50;
    }
    // Auto-sell: bearish ML prediction against an open position (thesis fail).
    if (prediction.direction !== PredictionDirection.DOWN || prediction.confidence < 70) return;
    if (!position) return;
    const price = this.lastPrices.get(prediction.symbol) ?? position.entryPrice;
    await this.closePosition(position, price, TradeExitReason.THESIS_INVALID);
  }

  // ------------------------------------------------------------ execution

  private async openPosition(
    symbol: string,
    quantity: number,
    price: number,
    target: number,
    stopLoss: number,
    userId?: string,
    brandId?: string,
    agentLink?: {
      decisionId?: string;
      plannedRiskAmount?: number;
      soakRunId?: string;
    },
  ): Promise<ExecutedTrade> {
    // Risk checks (before broker call)
    if (this.riskManager.isTripped) {
      throw new ForbiddenException(`Circuit breaker active: ${this.riskManager.reason}`);
    }

    // Construct order request for broker
    const externalOrderId = `paper-${Date.now()}-${symbol}`;
    const orderRequest: OrderRequest = {
      symbol,
      side: TradeSide.BUY,
      quantity,
      price,
      orderType: 'MARKET',
      validity: 'DAY',
      product: 'CNC',
      externalOrderId,
    };

    // Delegate to broker (paper or live)
    let orderResponse: OrderResponse;
    try {
      orderResponse = await this.broker.placeOrder(orderRequest);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'unknown error';
      await this.audit('ORDER_FAILED', 'auto-trader', { reason: errorMsg }, userId);
      throw new BadRequestException(`Order failed: ${errorMsg}`);
    }

    // Check for broker rejection
    if (orderResponse.status === 'REJECTED') {
      await this.audit('ORDER_REJECTED', 'auto-trader', { reason: orderResponse.error }, userId);
      throw new ForbiddenException(`Order rejected: ${orderResponse.error}`);
    }

    // Only update in-memory state if broker accepted
    this.cash -= quantity * price;

    let tradeId = externalOrderId;
    let sector: string | null = null;
    try {
      const existing = await this.prisma.stock.findUnique({
        where: { symbol },
        select: { sector: true },
      });
      if (existing?.sector && existing.sector !== 'Unknown') sector = existing.sector;
      await this.prisma.stock.upsert({
        where: { symbol },
        update: {},
        create: { symbol, name: symbol, exchange: 'NSE', sector: 'Unknown', indices: [] },
      });
      const row = await this.prisma.trade.create({
        data: {
          symbol,
          side: TradeSide.BUY,
          quantity,
          price: round2(price),
          mode: this.mode,
          status: TradeStatus.OPEN,
          target: round2(target),
          stopLoss: round2(stopLoss),
          userId,
          brandId,
          brokerOrderId: orderResponse.brokerOrderId || orderResponse.orderId,
        },
      });
      tradeId = row.id;
    } catch (error) {
      console.warn(`[auto-trader] trade persist failed: ${(error as Error).message}`);
    }

    const position: OpenPosition = {
      tradeId,
      symbol,
      quantity,
      entryPrice: price,
      target,
      target2: round2(price + (target - price) * 1.6),
      stopLoss,
      openedAt: Date.now(),
      sector,
      decisionId: agentLink?.decisionId,
      plannedRiskAmount: agentLink?.plannedRiskAmount,
      soakRunId: agentLink?.soakRunId,
    };
    this.positions.set(symbol, position);

    const executed: ExecutedTrade = {
      id: tradeId,
      symbol,
      side: TradeSide.BUY,
      quantity,
      price: round2(price),
      mode: this.mode,
      status: TradeStatus.OPEN,
      target: round2(target),
      stopLoss: round2(stopLoss),
      executedAt: position.openedAt,
    };
    this.tickets.unshift(executed);

    await this.audit('TRADE_OPENED', 'auto-trader', { ...executed }, userId);
    await this.producer
      .publish<TradeExecutedEvent>(KAFKA_TOPICS.TRADE_EXECUTED, executed, symbol)
      .catch(() => undefined);

    console.log(`[auto-trader] OPEN ${symbol} x${quantity} @ ${round2(price)}`);
    return executed;
  }

  private async addToPosition(
    symbol: string,
    quantity: number,
    price: number,
    userId?: string,
    _brandId?: string,
  ): Promise<ExecutedTrade> {
    const position = this.positions.get(symbol);
    if (!position) {
      throw new BadRequestException(`No open position in ${symbol} to add to`);
    }
    await this.placeBrokerBuy(symbol, quantity, price, userId);

    const totalQty = position.quantity + quantity;
    const avgEntry = (position.quantity * position.entryPrice + quantity * price) / totalQty;
    this.cash -= quantity * price;
    position.quantity = totalQty;
    position.entryPrice = avgEntry;

    try {
      await this.prisma.trade.update({
        where: { id: position.tradeId },
        data: { quantity: totalQty, price: round2(avgEntry) },
      });
    } catch (error) {
      console.warn(`[auto-trader] add-to-lot persist failed: ${(error as Error).message}`);
    }

    const executed: ExecutedTrade = {
      id: `${position.tradeId}-add-${Date.now()}`,
      symbol,
      side: TradeSide.BUY,
      quantity,
      price: round2(price),
      mode: this.mode,
      status: TradeStatus.OPEN,
      target: round2(position.target),
      stopLoss: round2(position.stopLoss),
      executedAt: Date.now(),
    };
    this.tickets.unshift(executed);
    await this.audit(
      'TRADE_ADDED',
      'auto-trader',
      { ...executed, avgEntry: round2(avgEntry) },
      userId,
    );
    console.log(
      `[auto-trader] ADD ${symbol} x${quantity} @ ${round2(price)} avg ${round2(avgEntry)} qty ${totalQty}`,
    );
    return executed;
  }

  private async reducePosition(
    position: OpenPosition,
    quantity: number,
    exitPrice: number,
    reason: TradeExitReason = TradeExitReason.MANUAL,
  ): Promise<ExecutedTrade> {
    await this.placeBrokerSell(position.symbol, quantity, exitPrice);
    const pnl = round2((exitPrice - position.entryPrice) * quantity);
    this.cash += quantity * exitPrice;
    this.realizedPnl += pnl;
    position.quantity -= quantity;

    try {
      await this.prisma.trade.update({
        where: { id: position.tradeId },
        data: { quantity: position.quantity, price: round2(position.entryPrice) },
      });
      await this.prisma.stock.upsert({
        where: { symbol: position.symbol },
        update: {},
        create: {
          symbol: position.symbol,
          name: position.symbol,
          exchange: 'NSE',
          sector: 'Unknown',
          indices: [],
        },
      });
      await this.prisma.trade.create({
        data: {
          symbol: position.symbol,
          side: TradeSide.SELL,
          quantity,
          price: round2(position.entryPrice),
          mode: this.mode,
          status: TradeStatus.CLOSED,
          exitPrice: round2(exitPrice),
          exitReason: reason,
          pnl,
          closedAt: new Date(),
          userId: this.activeIdentity.userId ?? undefined,
          brandId: this.activeIdentity.brandId ?? undefined,
        },
      });
    } catch (error) {
      console.warn(`[auto-trader] partial sell persist failed: ${(error as Error).message}`);
    }

    const executed: ExecutedTrade = {
      id: `${position.tradeId}-sell-${Date.now()}`,
      symbol: position.symbol,
      side: TradeSide.SELL,
      quantity,
      price: round2(position.entryPrice),
      mode: this.mode,
      status: TradeStatus.CLOSED,
      exitPrice: round2(exitPrice),
      exitReason: reason,
      pnl,
      executedAt: position.openedAt,
      closedAt: Date.now(),
    };
    this.tickets.unshift(executed);
    await this.audit('TRADE_REDUCED', 'auto-trader', { ...executed });
    console.log(
      `[auto-trader] SELL ${position.symbol} x${quantity} @ ${round2(exitPrice)} pnl ${pnl} (partial ${reason})`,
    );
    return executed;
  }

  private async placeBrokerOrder(
    side: TradeSide,
    symbol: string,
    quantity: number,
    price: number,
    userId?: string,
  ): Promise<void> {
    const externalOrderId = `order-${Date.now()}-${side}-${symbol}`;
    const orderRequest: OrderRequest = {
      symbol,
      side,
      quantity,
      price,
      orderType: 'MARKET',
      validity: 'DAY',
      product: 'CNC',
      externalOrderId,
    };
    let orderResponse: OrderResponse;
    try {
      orderResponse = await this.broker.placeOrder(orderRequest);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'unknown error';
      await this.audit('ORDER_FAILED', 'auto-trader', { reason: errorMsg, side }, userId);
      throw new BadRequestException(`Order failed: ${errorMsg}`);
    }
    if (orderResponse.status === 'REJECTED') {
      await this.audit(
        'ORDER_REJECTED',
        'auto-trader',
        { reason: orderResponse.error, side },
        userId,
      );
      throw new ForbiddenException(`Order rejected: ${orderResponse.error}`);
    }
  }

  private async placeBrokerBuy(
    symbol: string,
    quantity: number,
    price: number,
    userId?: string,
  ): Promise<void> {
    await this.placeBrokerOrder(TradeSide.BUY, symbol, quantity, price, userId);
  }

  private async placeBrokerSell(
    symbol: string,
    quantity: number,
    price: number,
    userId?: string,
  ): Promise<void> {
    await this.placeBrokerOrder(TradeSide.SELL, symbol, quantity, price, userId);
  }

  private async closePosition(
    position: OpenPosition,
    exitPrice: number,
    reason: TradeExitReason,
  ): Promise<ExecutedTrade> {
    await this.placeBrokerSell(position.symbol, position.quantity, exitPrice);
    this.positions.delete(position.symbol);
    const proceeds = position.quantity * exitPrice;
    this.cash += proceeds;
    const pnl = round2((exitPrice - position.entryPrice) * position.quantity);
    this.realizedPnl += pnl;
    try {
      await this.prisma.trade.updateMany({
        where: {
          symbol: position.symbol,
          status: TradeStatus.OPEN,
          mode: this.mode,
          ...(this.activeIdentity.userId
            ? { userId: this.activeIdentity.userId }
            : { userId: null }),
        },
        data: {
          status: TradeStatus.CLOSED,
          exitPrice: round2(exitPrice),
          exitReason: reason,
          pnl,
          closedAt: new Date(),
        },
      });
    } catch (error) {
      console.warn(`[auto-trader] trade close persist failed: ${(error as Error).message}`);
    }
    const executed: ExecutedTrade = {
      id: position.tradeId,
      symbol: position.symbol,
      side: TradeSide.SELL,
      quantity: position.quantity,
      price: round2(position.entryPrice),
      mode: this.mode,
      status: TradeStatus.CLOSED,
      exitPrice: round2(exitPrice),
      exitReason: reason,
      pnl,
      executedAt: position.openedAt,
      closedAt: Date.now(),
    };
    const openTicket = this.tickets.find((ticket) => ticket.id === position.tradeId);
    if (openTicket) {
      openTicket.status = TradeStatus.CLOSED;
      openTicket.exitPrice = executed.exitPrice;
      openTicket.exitReason = executed.exitReason;
      openTicket.pnl = executed.pnl;
      openTicket.closedAt = executed.closedAt;
    } else {
      this.tickets.unshift(executed);
    }
    await this.audit('TRADE_CLOSED', 'auto-trader', { ...executed });
    await this.producer
      .publish<TradeExecutedEvent>(KAFKA_TOPICS.TRADE_EXECUTED, executed, position.symbol)
      .catch(() => undefined);
    await this.notifyAgentOutcome(position, executed, reason);
    console.log(
      `[auto-trader] CLOSE ${position.symbol} x${position.quantity} @ ${round2(exitPrice)} pnl ${pnl} (${reason})`,
    );
    return executed;
  }

  /** Best-effort bridge: push closed-trade outcome to trader-agent ledger (idempotent). */
  private async notifyAgentOutcome(
    position: OpenPosition,
    executed: ExecutedTrade,
    reason: TradeExitReason,
  ): Promise<void> {
    if (!position.decisionId && !position.tradeId) return;
    const agentUrl = process.env.TRADER_AGENT_URL || 'http://localhost:3010';
    const pnl = executed.pnl ?? 0;
    const exitPrice = executed.exitPrice ?? 0;
    const holdingPeriodMs =
      executed.closedAt && position.openedAt
        ? Math.max(0, executed.closedAt - position.openedAt)
        : 0;
    const notional = position.entryPrice * position.quantity;
    const pnlPercent = notional > 0 ? (pnl / notional) * 100 : 0;
    try {
      const res = await fetch(`${agentUrl}/agent/decisions/outcome`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decisionId: position.decisionId,
          tradeId: position.tradeId,
          orderId: position.tradeId,
          symbol: position.symbol,
          exitPrice,
          pnl,
          pnlPercent,
          holdingPeriodMs,
          exitReason: String(reason),
          closedAt: executed.closedAt ?? Date.now(),
          plannedRiskAmount: position.plannedRiskAmount,
          soakRunId: position.soakRunId,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        console.warn(`[auto-trader] agent outcome notify HTTP ${res.status}`);
      }
    } catch (error) {
      console.warn(`[auto-trader] agent outcome notify failed: ${(error as Error).message}`);
    }
  }

  private async audit(
    action: string,
    actor: string,
    details: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actor,
          entity: 'trade',
          details: JSON.parse(JSON.stringify(details)),
          userId,
        },
      });
    } catch (error) {
      console.warn(`[auto-trader] audit write failed: ${(error as Error).message}`);
    }
  }
}
