'use strict';
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
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __exportStar =
  (this && this.__exportStar) ||
  function (m, exports) {
    for (var p in m)
      if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p))
        __createBinding(exports, m, p);
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.PaperTradingAdapter = void 0;
// Common
__exportStar(require('./common'), exports);
// Paper Trading Adapter
var paper_1 = require('./paper');
Object.defineProperty(exports, 'PaperTradingAdapter', {
  enumerable: true,
  get: function () {
    return paper_1.PaperTradingAdapter;
  },
});
//# sourceMappingURL=index.js.map
