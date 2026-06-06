import type { Candle } from '@stockpred/shared-types';
import { clamp, findSwingPoints, round2, SwingPoint } from '@stockpred/shared-utils';

/**
 * Geometric chart-pattern detectors over swing-point structure.
 * Heuristic by design: each detector reports a confidence in [50, 95]
 * derived from how tightly the geometry fits the textbook definition.
 */

export interface DetectorResult {
  pattern: string;
  direction: 'bullish' | 'bearish';
  signal: 'BUY' | 'SELL';
  confidence: number;
}

type Detector = (candles: Candle[]) => DetectorResult | null;

const SWING_LOOKBACK = 3;

function conf(base: number, fitBonus: number): number {
  return round2(clamp(base + fitBonus, 50, 95));
}

function pct(a: number, b: number): number {
  return Math.abs(a - b) / ((a + b) / 2);
}

/** Least-squares slope of price against bar index, normalized by mean price. */
function normalizedSlope(points: SwingPoint[]): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const meanX = points.reduce((acc, p) => acc + p.index, 0) / n;
  const meanY = points.reduce((acc, p) => acc + p.price, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.index - meanX) * (p.price - meanY);
    den += (p.index - meanX) ** 2;
  }
  if (den === 0 || meanY === 0) return 0;
  return num / den / meanY;
}

// ------------------------------------------------------------------ bullish

export const detectDoubleBottom: Detector = (candles) => {
  const { highs, lows } = findSwingPoints(candles, SWING_LOOKBACK);
  if (lows.length < 2) return null;
  const l2 = lows[lows.length - 1];
  const l1 = lows[lows.length - 2];
  if (l2.index - l1.index < 8) return null;
  const tolerance = pct(l1.price, l2.price);
  if (tolerance > 0.03) return null;
  const between = highs.filter((h) => h.index > l1.index && h.index < l2.index);
  if (between.length === 0) return null;
  const neckline = Math.max(...between.map((h) => h.price));
  if (neckline < l1.price * 1.03) return null;
  const lastClose = candles[candles.length - 1].close;
  if (lastClose <= neckline) return null; // not confirmed
  return {
    pattern: 'DOUBLE_BOTTOM',
    direction: 'bullish',
    signal: 'BUY',
    confidence: conf(68, (0.03 - tolerance) * 600),
  };
};

export const detectInverseHeadAndShoulders: Detector = (candles) => {
  const { highs, lows } = findSwingPoints(candles, SWING_LOOKBACK);
  if (lows.length < 3) return null;
  const [s1, head, s2] = lows.slice(-3);
  if (head.price >= s1.price || head.price >= s2.price) return null;
  if (pct(s1.price, s2.price) > 0.05) return null;
  if (head.price > Math.min(s1.price, s2.price) * 0.97) return null; // head too shallow
  const necklinePoints = highs.filter((h) => h.index > s1.index && h.index < s2.index);
  if (necklinePoints.length === 0) return null;
  const neckline = Math.max(...necklinePoints.map((h) => h.price));
  const lastClose = candles[candles.length - 1].close;
  if (lastClose <= neckline) return null;
  return {
    pattern: 'INVERSE_HEAD_AND_SHOULDERS',
    direction: 'bullish',
    signal: 'BUY',
    confidence: conf(70, (0.05 - pct(s1.price, s2.price)) * 400),
  };
};

export const detectAscendingTriangle: Detector = (candles) => {
  const window = candles.slice(-60);
  const { highs, lows } = findSwingPoints(window, SWING_LOOKBACK);
  if (highs.length < 2 || lows.length < 2) return null;
  const recentHighs = highs.slice(-3);
  const highMean = recentHighs.reduce((a, h) => a + h.price, 0) / recentHighs.length;
  const highSpread =
    (Math.max(...recentHighs.map((h) => h.price)) - Math.min(...recentHighs.map((h) => h.price))) /
    highMean;
  if (highSpread > 0.02) return null; // resistance not flat
  const lowSlope = normalizedSlope(lows.slice(-4));
  if (lowSlope <= 0.0005) return null; // lows not rising
  const lastClose = window[window.length - 1].close;
  if (lastClose < highMean * 0.97) return null; // not coiled near resistance
  return {
    pattern: 'ASCENDING_TRIANGLE',
    direction: 'bullish',
    signal: 'BUY',
    confidence: conf(64, (0.02 - highSpread) * 800 + lowSlope * 2000),
  };
};

export const detectBullFlag: Detector = (candles) => {
  const window = candles.slice(-40);
  if (window.length < 15) return null;
  const closes = window.map((c) => c.close);
  // Pole: strong rise from window low to its subsequent high.
  let poleStart = 0;
  let poleEnd = 0;
  let bestGain = 0;
  for (let i = 0; i < closes.length - 5; i += 1) {
    for (let j = i + 3; j < Math.min(i + 16, closes.length); j += 1) {
      const gain = (closes[j] - closes[i]) / closes[i];
      if (gain > bestGain) {
        bestGain = gain;
        poleStart = i;
        poleEnd = j;
      }
    }
  }
  if (bestGain < 0.07) return null; // pole must be >= 7%
  const flag = closes.slice(poleEnd);
  if (flag.length < 3 || flag.length > 16) return null;
  const poleHeight = closes[poleEnd] - closes[poleStart];
  const retrace = closes[poleEnd] - Math.min(...flag);
  if (retrace > poleHeight * 0.5) return null; // flag too deep
  if (retrace < 0) return null;
  const lastClose = closes[closes.length - 1];
  if (lastClose < closes[poleEnd] * 0.97) return null; // not resuming upward
  return {
    pattern: 'BULL_FLAG',
    direction: 'bullish',
    signal: 'BUY',
    confidence: conf(62, bestGain * 150 - (retrace / Math.max(poleHeight, 1e-9)) * 20),
  };
};

export const detectCupAndHandle: Detector = (candles) => {
  const window = candles.slice(-120);
  if (window.length < 40) return null;
  const third = Math.floor(window.length / 3);
  const leftRim = Math.max(...window.slice(0, third).map((c) => c.high));
  const bottom = Math.min(...window.slice(third, 2 * third).map((c) => c.low));
  const rightSection = window.slice(2 * third);
  const rightRim = Math.max(...rightSection.map((c) => c.high));
  if (pct(leftRim, rightRim) > 0.04) return null; // rims must align
  const depth = (leftRim - bottom) / leftRim;
  if (depth < 0.08 || depth > 0.4) return null; // cup proportion
  // Handle: shallow pullback in the final stretch.
  const handle = window.slice(-Math.max(5, Math.floor(window.length / 8)));
  const handleLow = Math.min(...handle.map((c) => c.low));
  const handleDepth = (rightRim - handleLow) / rightRim;
  if (handleDepth > depth / 2.5) return null; // handle too deep
  const lastClose = window[window.length - 1].close;
  if (lastClose < rightRim * 0.97) return null; // breakout not forming
  return {
    pattern: 'CUP_AND_HANDLE',
    direction: 'bullish',
    signal: 'BUY',
    confidence: conf(60, (0.04 - pct(leftRim, rightRim)) * 500 + depth * 40),
  };
};

// ------------------------------------------------------------------ bearish

export const detectDoubleTop: Detector = (candles) => {
  const { highs, lows } = findSwingPoints(candles, SWING_LOOKBACK);
  if (highs.length < 2) return null;
  const h2 = highs[highs.length - 1];
  const h1 = highs[highs.length - 2];
  if (h2.index - h1.index < 8) return null;
  const tolerance = pct(h1.price, h2.price);
  if (tolerance > 0.03) return null;
  const between = lows.filter((l) => l.index > h1.index && l.index < h2.index);
  if (between.length === 0) return null;
  const neckline = Math.min(...between.map((l) => l.price));
  if (neckline > h1.price * 0.97) return null;
  const lastClose = candles[candles.length - 1].close;
  if (lastClose >= neckline) return null;
  return {
    pattern: 'DOUBLE_TOP',
    direction: 'bearish',
    signal: 'SELL',
    confidence: conf(68, (0.03 - tolerance) * 600),
  };
};

export const detectHeadAndShoulders: Detector = (candles) => {
  const { highs, lows } = findSwingPoints(candles, SWING_LOOKBACK);
  if (highs.length < 3) return null;
  const [s1, head, s2] = highs.slice(-3);
  if (head.price <= s1.price || head.price <= s2.price) return null;
  if (pct(s1.price, s2.price) > 0.05) return null;
  if (head.price < Math.max(s1.price, s2.price) * 1.03) return null;
  const necklinePoints = lows.filter((l) => l.index > s1.index && l.index < s2.index);
  if (necklinePoints.length === 0) return null;
  const neckline = Math.min(...necklinePoints.map((l) => l.price));
  const lastClose = candles[candles.length - 1].close;
  if (lastClose >= neckline) return null;
  return {
    pattern: 'HEAD_AND_SHOULDERS',
    direction: 'bearish',
    signal: 'SELL',
    confidence: conf(70, (0.05 - pct(s1.price, s2.price)) * 400),
  };
};

export const detectDescendingTriangle: Detector = (candles) => {
  const window = candles.slice(-60);
  const { highs, lows } = findSwingPoints(window, SWING_LOOKBACK);
  if (highs.length < 2 || lows.length < 2) return null;
  const recentLows = lows.slice(-3);
  const lowMean = recentLows.reduce((a, l) => a + l.price, 0) / recentLows.length;
  const lowSpread =
    (Math.max(...recentLows.map((l) => l.price)) - Math.min(...recentLows.map((l) => l.price))) /
    lowMean;
  if (lowSpread > 0.02) return null; // support not flat
  const highSlope = normalizedSlope(highs.slice(-4));
  if (highSlope >= -0.0005) return null; // highs not falling
  const lastClose = window[window.length - 1].close;
  if (lastClose > lowMean * 1.03) return null;
  return {
    pattern: 'DESCENDING_TRIANGLE',
    direction: 'bearish',
    signal: 'SELL',
    confidence: conf(64, (0.02 - lowSpread) * 800 - highSlope * 2000),
  };
};

export const detectBearFlag: Detector = (candles) => {
  const window = candles.slice(-40);
  if (window.length < 15) return null;
  const closes = window.map((c) => c.close);
  let poleStart = 0;
  let poleEnd = 0;
  let bestDrop = 0;
  for (let i = 0; i < closes.length - 5; i += 1) {
    for (let j = i + 3; j < Math.min(i + 16, closes.length); j += 1) {
      const drop = (closes[i] - closes[j]) / closes[i];
      if (drop > bestDrop) {
        bestDrop = drop;
        poleStart = i;
        poleEnd = j;
      }
    }
  }
  if (bestDrop < 0.07) return null;
  const flag = closes.slice(poleEnd);
  if (flag.length < 3 || flag.length > 16) return null;
  const poleHeight = closes[poleStart] - closes[poleEnd];
  const bounce = Math.max(...flag) - closes[poleEnd];
  if (bounce > poleHeight * 0.5) return null;
  if (bounce < 0) return null;
  const lastClose = closes[closes.length - 1];
  if (lastClose > closes[poleEnd] * 1.03) return null;
  return {
    pattern: 'BEAR_FLAG',
    direction: 'bearish',
    signal: 'SELL',
    confidence: conf(62, bestDrop * 150 - (bounce / Math.max(poleHeight, 1e-9)) * 20),
  };
};

export const ALL_DETECTORS: Detector[] = [
  detectCupAndHandle,
  detectBullFlag,
  detectAscendingTriangle,
  detectDoubleBottom,
  detectInverseHeadAndShoulders,
  detectDoubleTop,
  detectHeadAndShoulders,
  detectDescendingTriangle,
  detectBearFlag,
];

/** Run every detector; returns all confirmed patterns, strongest first. */
export function detectPatterns(candles: Candle[]): DetectorResult[] {
  if (candles.length < 30) return [];
  const results: DetectorResult[] = [];
  for (const detector of ALL_DETECTORS) {
    const result = detector(candles);
    if (result) results.push(result);
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}
