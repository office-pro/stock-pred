'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.BEARISH_PATTERNS = exports.BULLISH_PATTERNS = exports.SignalType = void 0;
/** Signal classification. HOLD is internal: only BUY/SELL are actionable and published. */
var SignalType;
(function (SignalType) {
  SignalType['BUY'] = 'BUY';
  SignalType['SELL'] = 'SELL';
  SignalType['HOLD'] = 'HOLD';
})(SignalType || (exports.SignalType = SignalType = {}));
exports.BULLISH_PATTERNS = [
  'CUP_AND_HANDLE',
  'BULL_FLAG',
  'ASCENDING_TRIANGLE',
  'DOUBLE_BOTTOM',
  'INVERSE_HEAD_AND_SHOULDERS',
];
exports.BEARISH_PATTERNS = ['DOUBLE_TOP', 'HEAD_AND_SHOULDERS', 'DESCENDING_TRIANGLE', 'BEAR_FLAG'];
//# sourceMappingURL=signals.js.map
