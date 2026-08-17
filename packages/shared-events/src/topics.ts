/** Kafka topics (spec contract). */
export const KAFKA_TOPICS = {
  MARKET_TICKS: 'market.ticks',
  MARKET_CANDLES: 'market.candles',
  SIGNALS_GENERATED: 'signals.generated',
  PATTERNS_DETECTED: 'patterns.detected',
  PREDICTIONS_GENERATED: 'predictions.generated',
  TRADE_EXECUTED: 'trade.executed',
  NOTIFICATIONS_SENT: 'notifications.sent',
  SCANNER_ALERTS: 'scanner.alerts',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

export const ALL_TOPICS: KafkaTopic[] = Object.values(KAFKA_TOPICS);
