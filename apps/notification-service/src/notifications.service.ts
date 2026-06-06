import { randomUUID } from 'crypto';
import axios from 'axios';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getPrismaClient } from '@stockpred/database';
import {
  createKafkaClient,
  EventConsumer,
  EventProducer,
  KAFKA_TOPICS,
  NotificationSentEvent,
  PatternDetectedEvent,
  PredictionGeneratedEvent,
  SignalGeneratedEvent,
  TradeExecutedEvent,
} from '@stockpred/shared-events';
import { DISCLAIMER } from '@stockpred/shared-types';

/**
 * Notification hub: turns platform events into persisted, deliverable
 * notifications. Delivery adapters: console (always) + webhook (optional).
 * An email/SMS/push adapter plugs in alongside these.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma = getPrismaClient();
  private readonly kafka = createKafkaClient('notification-service');
  private readonly producer = new EventProducer(this.kafka);
  private readonly consumer = new EventConsumer(this.kafka, 'notification-service');
  private readonly webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL ?? '';
  private stopping = false;

  onModuleInit(): void {
    // Fire-and-forget: REST comes up immediately, the consumer attaches async
    // and retries forever (topics auto-create asynchronously on fresh clusters).
    void this.maintainKafka();
  }

  private async maintainKafka(): Promise<void> {
    let delay = 5_000;
    while (!this.stopping) {
      try {
        await this.startKafka();
        console.log('[notification-service] consuming platform events');
        return;
      } catch (error) {
        console.warn(
          `[notification-service] Kafka unavailable (${(error as Error).message}); retrying in ${Math.round(delay / 1000)}s`,
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
      KAFKA_TOPICS.SIGNALS_GENERATED,
      KAFKA_TOPICS.PATTERNS_DETECTED,
      KAFKA_TOPICS.PREDICTIONS_GENERATED,
      KAFKA_TOPICS.TRADE_EXECUTED,
    ]);
    await this.consumer.run(async (topic, envelope) => {
      switch (topic) {
        case KAFKA_TOPICS.SIGNALS_GENERATED: {
          const signal = envelope.payload as SignalGeneratedEvent;
          await this.notify(
            'SIGNAL',
            `${signal.signal} signal: ${signal.symbol}`,
            `${signal.signal} ${signal.symbol} @ ${signal.price} | target ${signal.target}, stop ${signal.stopLoss}, confidence ${signal.confidence}. ${DISCLAIMER}`,
            signal.symbol,
          );
          break;
        }
        case KAFKA_TOPICS.PATTERNS_DETECTED: {
          const pattern = envelope.payload as PatternDetectedEvent;
          await this.notify(
            'PATTERN',
            `${pattern.pattern} on ${pattern.symbol}`,
            `${pattern.direction} pattern ${pattern.pattern} detected (confidence ${pattern.confidence}). ${DISCLAIMER}`,
            pattern.symbol,
          );
          break;
        }
        case KAFKA_TOPICS.PREDICTIONS_GENERATED: {
          const prediction = envelope.payload as PredictionGeneratedEvent;
          await this.notify(
            'PREDICTION',
            `${prediction.horizon} outlook: ${prediction.symbol} ${prediction.direction}`,
            `ML expects ${prediction.direction} (${prediction.expectedMove}% expected move, confidence ${prediction.confidence}). Predictions are probabilistic. ${DISCLAIMER}`,
            prediction.symbol,
          );
          break;
        }
        case KAFKA_TOPICS.TRADE_EXECUTED: {
          const trade = envelope.payload as TradeExecutedEvent;
          await this.notify(
            'TRADE',
            `${trade.side} ${trade.symbol} x${trade.quantity} (${trade.mode})`,
            trade.status === 'CLOSED'
              ? `Closed @ ${trade.exitPrice} | pnl ${trade.pnl} (${trade.exitReason})`
              : `Opened @ ${trade.price} | target ${trade.target}, stop ${trade.stopLoss}`,
            trade.symbol,
          );
          break;
        }
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

  async getNotifications(limit: number): Promise<unknown[]> {
    try {
      return await this.prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.warn(`[notification-service] read failed: ${(error as Error).message}`);
      return [];
    }
  }

  private async notify(
    type: NotificationSentEvent['type'],
    title: string,
    message: string,
    symbol?: string,
  ): Promise<void> {
    const event: NotificationSentEvent = {
      id: randomUUID(),
      type,
      title,
      message,
      symbol,
      createdAt: Date.now(),
    };

    // 1. persist
    try {
      await this.prisma.notification.create({
        data: { id: event.id, type, title, message, symbol },
      });
    } catch (error) {
      console.warn(`[notification-service] persist failed: ${(error as Error).message}`);
    }

    // 2. deliver (console always; webhook when configured)
    console.log(`[notify] ${title}`);
    if (this.webhookUrl) {
      await axios
        .post(this.webhookUrl, event, { timeout: 5000 })
        .catch((error: Error) =>
          console.warn(`[notification-service] webhook failed: ${error.message}`),
        );
    }

    // 3. fan out on the bus
    await this.producer
      .publish<NotificationSentEvent>(KAFKA_TOPICS.NOTIFICATIONS_SENT, event, symbol)
      .catch(() => undefined);
  }
}
