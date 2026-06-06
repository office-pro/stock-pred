'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.ENSEMBLE_WEIGHTS = exports.PredictionHorizon = exports.PredictionDirection = void 0;
/** Direction classes predicted by the ML engine. */
var PredictionDirection;
(function (PredictionDirection) {
  PredictionDirection['UP'] = 'UP';
  PredictionDirection['DOWN'] = 'DOWN';
  PredictionDirection['SIDEWAYS'] = 'SIDEWAYS';
})(PredictionDirection || (exports.PredictionDirection = PredictionDirection = {}));
/** Prediction horizons. */
var PredictionHorizon;
(function (PredictionHorizon) {
  PredictionHorizon['NEXT_DAY'] = 'NEXT_DAY';
  PredictionHorizon['NEXT_WEEK'] = 'NEXT_WEEK';
})(PredictionHorizon || (exports.PredictionHorizon = PredictionHorizon = {}));
/** Ensemble weights (spec: 40/25/20/15). */
exports.ENSEMBLE_WEIGHTS = {
  xgboost: 0.4,
  lightgbm: 0.25,
  lstm: 0.2,
  transformer: 0.15,
};
//# sourceMappingURL=ml.js.map
