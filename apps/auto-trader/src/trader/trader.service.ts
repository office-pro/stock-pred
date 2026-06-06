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
  PortfolioSnapshot,
  PredictionDirection,
  TradeExitReason,
  TradeSide,
  TradeStatus,
  TradingMode,
} from '@stockpred/shared-types';
import { getEnvNumber, positionSize, round2 } from '@stockpred/shared-utils';
import { RiskManager } from './risk-manager';

interface OpenPosition {
  tradeId: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  target: number;
  stopLoss: number;
  openedAt: number;
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

  private cash = getEnvNumber('PAPER_TRADING_CAPITAL', 1_000_000);
  private readonly initialCapital = this.cash;
  private realizedPnl = 0;
  private readonly positions = new Map<string, OpenPosition>();
  private readonly lastPrices = new Map<string, number>();
  private readonly latestPatternConfidence = new Map<string, { confidence: number; at: number }>();

  private stopping = false;

  onModuleInit(): void {
    if (this.mode === TradingMode.LIVE) {
      console.warn(
        '[auto-trader] LIVE mode requested - live orders still require an authorized broker per trade',
      );
    } else {
      console.log('[auto-trader] PAPER trading mode (default)');
    }
    // Fire-and-forget: REST comes up immediately, the event loop attaches async
    // and retries forever (topics auto-create asynchronously on fresh clusters).
    void this.maintainKafka();
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

  // ---------------------------------------------------------------- queries

  getPortfolio(): PortfolioSnapshot {
    let unrealized = 0;
    let marketValue = 0;
    for (const position of this.positions.values()) {
      const price = this.lastPrices.get(position.symbol) ?? position.entryPrice;
      unrealized += (price - position.entryPrice) * position.quantity;
      marketValue += price * position.quantity;
    }
    return {
      mode: this.mode,
      capital: this.initialCapital,
      equity: round2(this.cash + marketValue),
      cash: round2(this.cash),
      openPositions: this.positions.size,
      realizedPnl: round2(this.realizedPnl),
      unrealizedPnl: round2(unrealized),
      circuitBreakerTripped: this.riskManager.isTripped,
    };
  }

  async getTrades(limit: number): Promise<unknown[]> {
    try {
      return await this.prisma.trade.findMany({ orderBy: { executedAt: 'desc' }, take: limit });
    } catch (error) {
      console.warn(`[auto-trader] trade history read failed: ${(error as Error).message}`);
      return [];
    }
  }

  // -------------------------------------------------------- manual trading

  async executeManualTrade(input: {
    symbol: string;
    side: TradeSide;
    quantity: number;
    userId?: string;
  }): Promise<ExecutedTrade> {
    const symbol = input.symbol.toUpperCase();
    const price = this.lastPrices.get(symbol);
    if (!price) {
      throw new BadRequestException(`No market price available yet for ${symbol}`);
    }
    if (input.side === TradeSide.BUY) {
      if (this.riskManager.isTripped) {
        throw new ForbiddenException(`Circuit breaker active: ${this.riskManager.reason}`);
      }
      const cost = price * input.quantity;
      if (cost > this.cash) {
        throw new BadRequestException('Insufficient paper-trading cash for this order');
      }
      return this.openPosition(
        symbol,
        input.quantity,
        price,
        price * 1.05,
        price * 0.97,
        input.userId,
      );
    }
    const position = this.positions.get(symbol);
    if (!position) {
      throw new BadRequestException(`No open position in ${symbol} to sell`);
    }
    return this.closePosition(position, price, TradeExitReason.MANUAL);
  }

  resetCircuitBreaker(actor: string): void {
    this.riskManager.reset();
    void this.audit('CIRCUIT_BREAKER_RESET', actor, {});
  }

  // ---------------------------------------------------------- event logic

  private async onTick(tick: MarketTickEvent): Promise<void> {
    this.lastPrices.set(tick.symbol, tick.price);
    const position = this.positions.get(tick.symbol);
    if (position) {
      if (tick.price <= position.stopLoss) {
        await this.closePosition(position, position.stopLoss, TradeExitReason.STOP_LOSS_HIT);
      } else if (tick.price >= position.target) {
        await this.closePosition(position, position.target, TradeExitReason.TARGET_HIT);
      }
    }
    // Re-evaluate the breaker on the equity mark.
    const snapshot = this.getPortfolio();
    const before = this.riskManager.isTripped;
    const check = this.riskManager.evaluate(snapshot.equity, new Date());
    if (check.tripped && !before) {
      console.warn(`[auto-trader] CIRCUIT BREAKER TRIPPED: ${check.reason}`);
      await this.audit('CIRCUIT_BREAKER_TRIPPED', 'auto-trader', { reason: check.reason });
    }
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
    // Auto-sell: bearish ML prediction against an open position.
    if (prediction.direction !== PredictionDirection.DOWN || prediction.confidence < 70) return;
    const position = this.positions.get(prediction.symbol);
    if (!position) return;
    const price = this.lastPrices.get(prediction.symbol) ?? position.entryPrice;
    await this.closePosition(position, price, TradeExitReason.BEARISH_ML_PREDICTION);
  }

  // ------------------------------------------------------------ execution

  private async openPosition(
    symbol: string,
    quantity: number,
    price: number,
    target: number,
    stopLoss: number,
    userId?: string,
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
    try {
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
      stopLoss,
      openedAt: Date.now(),
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

    await this.audit('TRADE_OPENED', 'auto-trader', { ...executed }, userId);
    await this.producer
      .publish<TradeExecutedEvent>(KAFKA_TOPICS.TRADE_EXECUTED, executed, symbol)
      .catch(() => undefined);

    console.log(`[auto-trader] OPEN ${symbol} x${quantity} @ ${round2(price)}`);
    return executed;
  }

  private async closePosition(
    position: OpenPosition,
    exitPrice: number,
    reason: TradeExitReason,
  ): Promise<ExecutedTrade> {
    this.positions.delete(position.symbol);
    const proceeds = position.quantity * exitPrice;
    this.cash += proceeds;
    const pnl = round2((exitPrice - position.entryPrice) * position.quantity);
    this.realizedPnl += pnl;
    try {
      await this.prisma.trade.update({
        where: { id: position.tradeId },
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
    await this.audit('TRADE_CLOSED', 'auto-trader', { ...executed });
    await this.producer
      .publish<TradeExecutedEvent>(KAFKA_TOPICS.TRADE_EXECUTED, executed, position.symbol)
      .catch(() => undefined);
    console.log(
      `[auto-trader] CLOSE ${position.symbol} x${position.quantity} @ ${round2(exitPrice)} pnl ${pnl} (${reason})`,
    );
    return executed;
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
