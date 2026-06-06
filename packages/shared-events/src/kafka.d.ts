import { Kafka } from 'kafkajs';
import { EventEnvelope } from './envelope';
import type { KafkaTopic } from './topics';
export declare function createKafkaClient(clientId: string, brokers?: string[]): Kafka;
/** Thin producer with JSON envelope serialization and key-by-symbol support. */
export declare class EventProducer {
    private readonly producer;
    private connected;
    constructor(kafka: Kafka);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    publish<T>(topic: KafkaTopic, payload: T, key?: string): Promise<EventEnvelope<T>>;
}
export type EnvelopeHandler = (topic: KafkaTopic, envelope: EventEnvelope<unknown>) => Promise<void>;
/** Thin consumer that decodes envelopes and dispatches them to a handler. */
export declare class EventConsumer {
    private readonly consumer;
    private connected;
    constructor(kafka: Kafka, groupId: string);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(topics: KafkaTopic[]): Promise<void>;
    run(handler: EnvelopeHandler): Promise<void>;
}
//# sourceMappingURL=kafka.d.ts.map