import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  createKafkaClient,
  EventConsumer,
  KAFKA_TOPICS,
  MarketTickEvent,
} from '@stockpred/shared-events';
import { EventsGateway } from './events.gateway';

const RETRY_INITIAL_MS = 5_000;
const RETRY_MAX_MS = 30_000;

/** Bridges Kafka topics onto Socket.IO events for the frontend. */
@Injectable()
export class KafkaBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly consumer = new EventConsumer(
    createKafkaClient('api-gateway'),
    `api-gateway-${process.pid}`,
  );
  private stopping = false;

  constructor(private readonly gateway: EventsGateway) {}

  onModuleInit(): void {
    // Fire-and-forget: the gateway must serve REST even with no broker up.
    // The bridge retries forever - brokers and topics appear asynchronously
    // (topic auto-creation races the first subscribe on a fresh cluster).
    void this.runBridgeWithRetry();
  }

  private async runBridgeWithRetry(): Promise<void> {
    let delay = RETRY_INITIAL_MS;
    while (!this.stopping) {
      try {
        await this.startBridge();
        console.log('[api-gateway] Kafka -> Socket.IO bridge active');
        return;
      } catch (error) {
        console.warn(
          `[api-gateway] Kafka bridge unavailable (${(error as Error).message}); retrying in ${Math.round(delay / 1000)}s`,
        );
        await this.consumer.disconnect().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, RETRY_MAX_MS);
      }
    }
  }

  private async startBridge(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe([
      KAFKA_TOPICS.MARKET_TICKS,
      KAFKA_TOPICS.SIGNALS_GENERATED,
      KAFKA_TOPICS.PATTERNS_DETECTED,
      KAFKA_TOPICS.PREDICTIONS_GENERATED,
      KAFKA_TOPICS.TRADE_EXECUTED,
      KAFKA_TOPICS.NOTIFICATIONS_SENT,
    ]);
    await this.consumer.run(async (topic, envelope) => {
      switch (topic) {
        case KAFKA_TOPICS.MARKET_TICKS: {
          const tick = envelope.payload as MarketTickEvent;
          this.gateway.emit('stock:update', tick);
          break;
        }
        case KAFKA_TOPICS.SIGNALS_GENERATED:
          this.gateway.emit('signal:update', envelope.payload);
          break;
        case KAFKA_TOPICS.PATTERNS_DETECTED:
          this.gateway.emit('pattern:update', envelope.payload);
          break;
        case KAFKA_TOPICS.PREDICTIONS_GENERATED:
          this.gateway.emit('prediction:update', envelope.payload);
          break;
        case KAFKA_TOPICS.TRADE_EXECUTED:
          this.gateway.emit('trade:update', envelope.payload);
          break;
        case KAFKA_TOPICS.NOTIFICATIONS_SENT:
          this.gateway.emit('notification:new', envelope.payload);
          break;
        default:
          break;
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.consumer.disconnect().catch(() => undefined);
  }
}
