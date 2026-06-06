'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.DEFAULT_RISK_LIMITS =
  exports.TradeExitReason =
  exports.TradeStatus =
  exports.TradeSide =
  exports.TradingMode =
    void 0;
var TradingMode;
(function (TradingMode) {
  TradingMode['PAPER'] = 'PAPER';
  TradingMode['LIVE'] = 'LIVE';
})(TradingMode || (exports.TradingMode = TradingMode = {}));
var TradeSide;
(function (TradeSide) {
  TradeSide['BUY'] = 'BUY';
  TradeSide['SELL'] = 'SELL';
})(TradeSide || (exports.TradeSide = TradeSide = {}));
var TradeStatus;
(function (TradeStatus) {
  TradeStatus['OPEN'] = 'OPEN';
  TradeStatus['CLOSED'] = 'CLOSED';
  TradeStatus['CANCELLED'] = 'CANCELLED';
})(TradeStatus || (exports.TradeStatus = TradeStatus = {}));
var TradeExitReason;
(function (TradeExitReason) {
  TradeExitReason['TARGET_HIT'] = 'TARGET_HIT';
  TradeExitReason['STOP_LOSS_HIT'] = 'STOP_LOSS_HIT';
  TradeExitReason['REVERSAL_SIGNAL'] = 'REVERSAL_SIGNAL';
  TradeExitReason['BEARISH_ML_PREDICTION'] = 'BEARISH_ML_PREDICTION';
  TradeExitReason['MANUAL'] = 'MANUAL';
})(TradeExitReason || (exports.TradeExitReason = TradeExitReason = {}));
exports.DEFAULT_RISK_LIMITS = {
  perTradeRiskPercent: 1,
  dailyDrawdownPercent: 3,
  weeklyDrawdownPercent: 8,
};
//# sourceMappingURL=trading.js.map
