/**
 * @stockpred/broker-sdk
 *
 * Multi-broker adapter pattern SDK for StockPred trading platform.
 *
 * ## Usage
 *
 * ```typescript
 * import { BrokerRouter } from '@stockpred/broker-sdk';
 *
 * // Create router (defaults to PAPER adapter)
 * const router = new BrokerRouter({ brokerType: 'ZERODHA' });
 *
 * // Login
 * await router.login();
 *
 * // Place order
 * const response = await router.placeOrder({
 *   symbol: 'RELIANCE',
 *   side: 'BUY',
 *   quantity: 10,
 *   price: 2500,
 *   orderType: 'LIMIT',
 *   validity: 'DAY',
 *   product: 'CNC',
 * });
 *
 * // Get positions
 * const positions = await router.getPositions();
 * ```
 *
 * ## Supported Brokers
 *
 * - PAPER: Paper Trading (default, fully implemented) ✅
 * - ZERODHA: Zerodha (implemented, OAuth ready) ✅
 * - ANGELONE: AngelOne (implemented, API key ready) ✅
 * - UPSTOX: Upstox (implemented, OAuth ready) ✅
 * - SHOONYA: Shoonya (stub, Phase 5)
 * - FYERS: Fyers (stub, Phase 5)
 */

// Common
export * from './common';

// Paper Trading Adapter
export { PaperTradingAdapter } from './paper';

// Broker Adapters
export { ZerodhaAdapter, ZerodhaSessionManager } from './zerodha';
export { AngelOneAdapter } from './angelone';
export { UpstoxAdapter } from './upstox';
