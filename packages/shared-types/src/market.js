'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.Timeframe = exports.MarketIndex = exports.Exchange = void 0;
/** Exchanges supported by the platform. */
var Exchange;
(function (Exchange) {
  Exchange['NSE'] = 'NSE';
  Exchange['BSE'] = 'BSE';
})(Exchange || (exports.Exchange = Exchange = {}));
/** Index universes tracked on the dashboard. */
var MarketIndex;
(function (MarketIndex) {
  MarketIndex['NIFTY_50'] = 'NIFTY_50';
  MarketIndex['NIFTY_MIDCAP_100'] = 'NIFTY_MIDCAP_100';
  MarketIndex['NIFTY_SMALLCAP_100'] = 'NIFTY_SMALLCAP_100';
  MarketIndex['INDIA_VIX'] = 'INDIA_VIX';
})(MarketIndex || (exports.MarketIndex = MarketIndex = {}));
var Timeframe;
(function (Timeframe) {
  Timeframe['ONE_MINUTE'] = '1m';
  Timeframe['FIVE_MINUTES'] = '5m';
  Timeframe['FIFTEEN_MINUTES'] = '15m';
  Timeframe['ONE_HOUR'] = '1h';
  Timeframe['ONE_DAY'] = '1d';
})(Timeframe || (exports.Timeframe = Timeframe = {}));
//# sourceMappingURL=market.js.map
