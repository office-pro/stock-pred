import { randomUUID } from 'crypto';
import type { KafkaTopic } from './topics';

/** Versioned envelope wrapping every event on the bus. */
export interface EventEnvelope<T> {
  id: string;
  topic: KafkaTopic;
  payload: T;
  producedAt: number;
  version: 1;
}

export function createEnvelope<T>(topic: KafkaTopic, payload: T): EventEnvelope<T> {
  return {
    id: randomUUID(),
    topic,
    payload,
    producedAt: Date.now(),
    version: 1,
  };
}

export function serializeEnvelope<T>(envelope: EventEnvelope<T>): string {
  return JSON.stringify(envelope);
}

export function parseEnvelope<T>(raw: string | Buffer | null): EventEnvelope<T> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'topic' in parsed &&
      'payload' in parsed
    ) {
      return parsed as EventEnvelope<T>;
    }
    return null;
  } catch {
    return null;
  }
}
