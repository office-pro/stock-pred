'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.round2 = round2;
exports.mean = mean;
exports.std = std;
exports.pctChange = pctChange;
exports.lastFinite = lastFinite;
exports.clamp = clamp;
/** Round to 2 decimals (price precision used across the platform). */
function round2(value) {
  return Math.round(value * 100) / 100;
}
function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}
/** Population standard deviation. */
function std(values) {
  if (values.length === 0) return NaN;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
function pctChange(from, to) {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}
/** Last finite value of a series, or null. */
function lastFinite(values) {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
//# sourceMappingURL=math.js.map
