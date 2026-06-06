import type { KafkaTopic } from './topics';
/** Versioned envelope wrapping every event on the bus. */
export interface EventEnvelope<T> {
    id: string;
    topic: KafkaTopic;
    payload: T;
    producedAt: number;
    version: 1;
}
export declare function createEnvelope<T>(topic: KafkaTopic, payload: T): EventEnvelope<T>;
export declare function serializeEnvelope<T>(envelope: EventEnvelope<T>): string;
export declare function parseEnvelope<T>(raw: string | Buffer | null): EventEnvelope<T> | null;
//# sourceMappingURL=envelope.d.ts.map