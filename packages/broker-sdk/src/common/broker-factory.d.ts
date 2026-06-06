/**
 * BrokerFactory
 *
 * Static factory for creating BrokerAdapter instances.
 * Selects appropriate adapter based on BROKER_TYPE environment variable or parameter.
 *
 * Phase 1 includes only PaperTradingAdapter.
 * Real broker adapters (Zerodha, AngelOne, etc.) will be added in Phases 3-5.
 */
import type { BrokerAdapter } from './interfaces/broker-adapter';
export declare class BrokerFactory {
    /**
     * Create a broker adapter instance
     * @param brokerType Broker type: 'PAPER', 'ZERODHA', 'ANGELONE', 'UPSTOX', 'SHOONYA', 'FYERS'
     * @returns BrokerAdapter instance
     * @throws Error if broker type is not supported or not implemented yet
     */
    static create(brokerType?: string): BrokerAdapter;
    /**
     * List supported broker types
     */
    static getSupportedBrokers(): string[];
    /**
     * Check if a broker type is supported
     */
    static isSupported(brokerType: string): boolean;
}
//# sourceMappingURL=broker-factory.d.ts.map