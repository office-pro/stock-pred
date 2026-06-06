/** Kafka topics (spec contract). */
export declare const KAFKA_TOPICS: {
    readonly MARKET_TICKS: "market.ticks";
    readonly MARKET_CANDLES: "market.candles";
    readonly SIGNALS_GENERATED: "signals.generated";
    readonly PATTERNS_DETECTED: "patterns.detected";
    readonly PREDICTIONS_GENERATED: "predictions.generated";
    readonly TRADE_EXECUTED: "trade.executed";
    readonly NOTIFICATIONS_SENT: "notifications.sent";
};
export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];
export declare const ALL_TOPICS: KafkaTopic[];
//# sourceMappingURL=topics.d.ts.map