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
 * const router = new BrokerRouter({ brokerType: 'PAPER' });
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
 * ## Phases
 *
 * - Phase 1 (Complete): Interfaces, types, Paper Trading Adapter
 * - Phase 2: SessionManager implementations, NestJS service wrapper
 * - Phase 3-5: Real broker adapters (Zerodha, AngelOne, Upstox, Shoonya, Fyers)
 * - Phase 6: Kafka event publishing
 * - Phase 7+: Advanced features
 */
export * from './common';
export { PaperTradingAdapter } from './paper';
//# sourceMappingURL=index.d.ts.map