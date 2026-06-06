import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createKafkaClient, EventProducer, KafkaTopic } from '@stockpred/shared-events';

/** Kafka producer with graceful degradation for broker outages. */
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly producer = new EventProducer(createKafkaClient('market-data-service'));
  private available = false;
  private lastErrorLog = 0;

  onModuleInit(): void {
    // Fire-and-forget: the HTTP listener must never wait on broker retries.
    void this.producer
      .connect()
      .then(() => {
        this.available = true;
        console.log('[market-data] Kafka producer connected');
      })
      .catch((error: Error) => {
        console.warn(`[market-data] Kafka unavailable at startup: ${error.message}`);
      });
  }

  async publish<T>(topic: KafkaTopic, payload: T, key?: string): Promise<void> {
    if (!this.available) {
      // Periodic reconnect attempt.
      try {
        await this.producer.connect();
        this.available = true;
      } catch {
        return;
      }
    }
    try {
      await this.producer.publish(topic, payload, key);
    } catch (error) {
      this.available = false;
      const now = Date.now();
      if (now - this.lastErrorLog > 30_000) {
        this.lastErrorLog = now;
        console.warn(`[market-data] Kafka publish failed: ${(error as Error).message}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect().catch(() => undefined);
  }
}
