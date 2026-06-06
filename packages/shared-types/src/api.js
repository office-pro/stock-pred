'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.DISCLAIMER = void 0;
exports.withDisclaimer = withDisclaimer;
/**
 * Compliance: every analytics payload carries this disclaimer.
 * Predictions are probabilistic. No guarantee of profits.
 */
exports.DISCLAIMER = 'This is not investment advice.';
function withDisclaimer(data) {
  return {
    data,
    meta: { disclaimer: exports.DISCLAIMER, timestamp: Date.now() },
  };
}
//# sourceMappingURL=api.js.map
