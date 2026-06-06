'use strict';
/**
 * BrokerFactory
 *
 * Static factory for creating BrokerAdapter instances.
 * Selects appropriate adapter based on BROKER_TYPE environment variable or parameter.
 *
 * Phase 1 includes only PaperTradingAdapter.
 * Real broker adapters (Zerodha, AngelOne, etc.) will be added in Phases 3-5.
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.BrokerFactory = void 0;
const paper_trading_adapter_1 = require('../paper/paper-trading-adapter');
class BrokerFactory {
  /**
   * Create a broker adapter instance
   * @param brokerType Broker type: 'PAPER', 'ZERODHA', 'ANGELONE', 'UPSTOX', 'SHOONYA', 'FYERS'
   * @returns BrokerAdapter instance
   * @throws Error if broker type is not supported or not implemented yet
   */
  static create(brokerType) {
    const type = (brokerType || process.env.BROKER_TYPE || 'PAPER').toUpperCase();
    switch (type) {
      case 'PAPER':
        return new paper_trading_adapter_1.PaperTradingAdapter();
      // Phase 3-5: Real broker adapters
      // case 'ZERODHA':
      //   return new ZerodhaAdapter();
      // case 'ANGELONE':
      //   return new AngelOneAdapter();
      // case 'UPSTOX':
      //   return new UpstoxAdapter();
      // case 'SHOONYA':
      //   return new ShoonyaAdapter();
      // case 'FYERS':
      //   return new FyersAdapter();
      default:
        throw new Error(
          `Broker type '${type}' is not supported or not yet implemented. ` +
            `Available: PAPER (Phase 1). ` +
            `Coming: ZERODHA, ANGELONE, UPSTOX, SHOONYA, FYERS (Phases 3-5).`,
        );
    }
  }
  /**
   * List supported broker types
   */
  static getSupportedBrokers() {
    return ['PAPER'];
    // After Phase 5: ['PAPER', 'ZERODHA', 'ANGELONE', 'UPSTOX', 'SHOONYA', 'FYERS']
  }
  /**
   * Check if a broker type is supported
   */
  static isSupported(brokerType) {
    return this.getSupportedBrokers().includes(brokerType.toUpperCase());
  }
}
exports.BrokerFactory = BrokerFactory;
//# sourceMappingURL=broker-factory.js.map
