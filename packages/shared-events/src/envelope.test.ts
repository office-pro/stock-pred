import { createEnvelope, parseEnvelope, serializeEnvelope } from './envelope';
import { ALL_TOPICS, KAFKA_TOPICS } from './topics';

describe('event envelope', () => {
  it('round-trips through serialization', () => {
    const envelope = createEnvelope(KAFKA_TOPICS.SIGNALS_GENERATED, { symbol: 'TCS' });
    const parsed = parseEnvelope<{ symbol: string }>(serializeEnvelope(envelope));
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(envelope.id);
    expect(parsed?.topic).toBe('signals.generated');
    expect(parsed?.payload.symbol).toBe('TCS');
    expect(parsed?.version).toBe(1);
  });

  it('rejects malformed payloads', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope(JSON.stringify({ nope: true }))).toBeNull();
    expect(parseEnvelope(null)).toBeNull();
  });

  it('declares all seven spec topics', () => {
    expect(ALL_TOPICS).toHaveLength(7);
    expect(ALL_TOPICS).toEqual(
      expect.arrayContaining([
        'market.ticks',
        'market.candles',
        'signals.generated',
        'patterns.detected',
        'predictions.generated',
        'trade.executed',
        'notifications.sent',
      ]),
    );
  });
});
