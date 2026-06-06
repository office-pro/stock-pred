'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.ALL_TOPICS = exports.KAFKA_TOPICS = void 0;
/** Kafka topics (spec contract). */
exports.KAFKA_TOPICS = {
  MARKET_TICKS: 'market.ticks',
  MARKET_CANDLES: 'market.candles',
  SIGNALS_GENERATED: 'signals.generated',
  PATTERNS_DETECTED: 'patterns.detected',
  PREDICTIONS_GENERATED: 'predictions.generated',
  TRADE_EXECUTED: 'trade.executed',
  NOTIFICATIONS_SENT: 'notifications.sent',
};
exports.ALL_TOPICS = Object.values(exports.KAFKA_TOPICS);
//# sourceMappingURL=topics.js.map
