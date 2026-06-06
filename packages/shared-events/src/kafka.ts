import { Consumer, Kafka, Producer, logLevel } from 'kafkajs';
import { createEnvelope, parseEnvelope, serializeEnvelope, EventEnvelope } from './envelope';
import type { KafkaTopic } from './topics';

export function createKafkaClient(clientId: string, brokers?: string[]): Kafka {
  const brokerList = brokers ?? (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
  return new Kafka({
    clientId,
    brokers: brokerList,
    // Services log their own connection status; kafkajs retry noise would
    // flood the logs whenever the platform runs in degraded (no-Kafka) mode.
    logLevel: logLevel.NOTHING,
    retry: { initialRetryTime: 300, retries: 5 },
  });
}

/** Thin producer with JSON envelope serialization and key-by-symbol support. */
export class EventProducer {
  private readonly producer: Producer;
  private connected = false;

  constructor(kafka: Kafka) {
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
  }

  async publish<T>(topic: KafkaTopic, payload: T, key?: string): Promise<EventEnvelope<T>> {
    const envelope = createEnvelope(topic, payload);
    await this.producer.send({
      topic,
      messages: [{ key: key ?? null, value: serializeEnvelope(envelope) }],
    });
    return envelope;
  }
}

export type EnvelopeHandler = (
  topic: KafkaTopic,
  envelope: EventEnvelope<unknown>,
) => Promise<void>;

/** Thin consumer that decodes envelopes and dispatches them to a handler. */
export class EventConsumer {
  private readonly consumer: Consumer;
  private connected = false;

  constructor(kafka: Kafka, groupId: string) {
    this.consumer = kafka.consumer({ groupId });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.consumer.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.consumer.disconnect();
    this.connected = false;
  }

  async subscribe(topics: KafkaTopic[]): Promise<void> {
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }
  }

  async run(handler: EnvelopeHandler): Promise<void> {
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const envelope = parseEnvelope(message.value);
        if (envelope === null) return;
        try {
          await handler(topic as KafkaTopic, envelope);
        } catch (error) {
          // Never crash the consumer loop on a single bad event.
          console.error(`[kafka] handler error on ${topic}:`, error);
        }
      },
    });
  }
}
