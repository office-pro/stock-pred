import { Candle, SignalType } from '@stockpred/shared-types';
import { atr, ema, macd, rsi, sma, vwap } from './indicators';
import { lastFinite, round2 } from './math';
import { computeSupportResistance } from './support-resistance';

/**
 * Rule-based signal core. This module is the single source of truth for
 * BUY/SELL rules: the signal-engine uses it for live evaluation and the
 * backtest-service replays history through the exact same logic.
 */

export interface SignalEvaluation {
  type: SignalType;
  /** 0-100 weighted rule-satisfaction score for the winning side. */
  confidence: number;
  rules: Record<string, boolean>;
  price: number;
  target: number | null;
  stopLoss: number | null;
  riskReward: number | null;
}

const BUY_WEIGHTS: Record<string, number> = {
  emaShortAboveMid: 20, // EMA20 > EMA50
  emaMidAboveLong: 15, // EMA50 > EMA200
  rsiInBuyZone: 15, // RSI 45-70
  macdBullish: 20, // MACD line above signal, histogram positive
  volumeAboveAverage: 10, // last volume > 20-bar average
  nearSupport: 10, // close within 3% of nearest support
  breakoutConfirmed: 10, // close above prior 20-bar high
};

const SELL_WEIGHTS: Record<string, number> = {
  emaShortBelowMid: 30, // EMA20 < EMA50
  rsiOverbought: 15, // RSI > 75
  macdBearish: 25, // MACD line below signal, histogram negative
  nearResistance: 15, // close within 3% of nearest resistance
  breakdownConfirmed: 15, // close below prior 20-bar low
};

const CONFIDENCE_THRESHOLD = 70;
const PROXIMITY_PCT = 3;
/** MACD needs slow(26) + signal(9) bars; anything less cannot be evaluated. */
const MIN_BARS = 40;
/**
 * Noise filter: EMAs must separate by at least 0.1% before a trend rule
 * counts. Prevents flat, range-bound markets from emitting signals off
 * floating-point-scale crossovers.
 */
const EMA_SEPARATION = 0.001;

function score(rules: Record<string, boolean>, weights: Record<string, number>): number {
  let total = 0;
  for (const [name, passed] of Object.entries(rules)) {
    if (passed) total += weights[name] ?? 0;
  }
  return total;
}

function holdResult(price: number): SignalEvaluation {
  return {
    type: SignalType.HOLD,
    confidence: 0,
    rules: {},
    price: round2(price),
    target: null,
    stopLoss: null,
    riskReward: null,
  };
}

/** Evaluate the latest bar of a candle history against the spec rule sets. */
export function evaluateSignal(candles: Candle[]): SignalEvaluation {
  const lastClose = candles.length > 0 ? candles[candles.length - 1].close : 0;
  if (candles.length < MIN_BARS) return holdResult(lastClose);

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];

  const ema20 = lastFinite(ema(closes, 20));
  const ema50 = lastFinite(ema(closes, 50));
  const ema200 = lastFinite(ema(closes, 200));
  const rsiValue = lastFinite(rsi(closes));
  const macdSeries = macd(closes);
  const macdValue = lastFinite(macdSeries.macd);
  const macdSignalValue = lastFinite(macdSeries.signal);
  const macdHist = lastFinite(macdSeries.histogram);
  const atrValue = lastFinite(atr(candles));
  const avgVol = lastFinite(sma(volumes, 20));
  // Recent-anchored VWAP: a full-history cumulative VWAP is meaningless.
  const vwapValue = lastFinite(vwap(candles.slice(-20)));

  if (
    ema20 === null ||
    ema50 === null ||
    rsiValue === null ||
    macdValue === null ||
    macdSignalValue === null ||
    macdHist === null ||
    atrValue === null
  ) {
    return holdResult(lastClose);
  }

  const sr = computeSupportResistance(candles, { vwapValue });
  const nearestSupport = sr.support.length > 0 ? sr.support[0] : null;
  const nearestResistance = sr.resistance.length > 0 ? sr.resistance[0] : null;

  // Breakout/breakdown: close beyond the prior 20-bar extreme (excluding current bar).
  const window = candles.slice(-21, -1);
  const priorHigh = Math.max(...window.map((c) => c.high));
  const priorLow = Math.min(...window.map((c) => c.low));

  const macdBullish = macdValue > macdSignalValue && macdHist > 0;
  const macdBearish = macdValue < macdSignalValue && macdHist < 0;

  const buyRules: Record<string, boolean> = {
    emaShortAboveMid: ema20 > ema50 * (1 + EMA_SEPARATION),
    emaMidAboveLong: ema200 !== null && ema50 > ema200,
    rsiInBuyZone: rsiValue >= 45 && rsiValue <= 70,
    macdBullish,
    volumeAboveAverage: avgVol !== null && last.volume > avgVol,
    nearSupport:
      nearestSupport !== null &&
      ((last.close - nearestSupport) / last.close) * 100 <= PROXIMITY_PCT,
    breakoutConfirmed: last.close > priorHigh,
  };

  const sellRules: Record<string, boolean> = {
    emaShortBelowMid: ema20 < ema50 * (1 - EMA_SEPARATION),
    rsiOverbought: rsiValue > 75,
    macdBearish,
    nearResistance:
      nearestResistance !== null &&
      ((nearestResistance - last.close) / last.close) * 100 <= PROXIMITY_PCT,
    breakdownConfirmed: last.close < priorLow,
  };

  const buyScore = score(buyRules, BUY_WEIGHTS);
  const sellScore = score(sellRules, SELL_WEIGHTS);

  // Mandatory cores keep signals "actionable only": trend + momentum must agree.
  const buyEligible = buyRules.emaShortAboveMid && buyRules.macdBullish;
  const sellEligible =
    sellRules.macdBearish && (sellRules.emaShortBelowMid || sellRules.rsiOverbought);

  const buyActive = buyEligible && buyScore >= CONFIDENCE_THRESHOLD;
  const sellActive = sellEligible && sellScore >= CONFIDENCE_THRESHOLD;

  if (buyActive && (!sellActive || buyScore >= sellScore)) {
    let stopLoss = last.close - 1.5 * atrValue;
    // Snap the stop just under a nearby support when it tightens the risk.
    if (nearestSupport !== null && nearestSupport > stopLoss && nearestSupport < last.close) {
      stopLoss = nearestSupport * 0.99;
    }
    const risk = last.close - stopLoss;
    let target = last.close + 2 * risk;
    // Cap the target at a meaningful resistance overhead.
    if (
      nearestResistance !== null &&
      nearestResistance > last.close + risk &&
      nearestResistance < target
    ) {
      target = nearestResistance;
    }
    const riskReward = risk > 0 ? (target - last.close) / risk : 0;
    return {
      type: SignalType.BUY,
      confidence: buyScore,
      rules: buyRules,
      price: round2(last.close),
      target: round2(target),
      stopLoss: round2(stopLoss),
      riskReward: round2(riskReward),
    };
  }

  if (sellActive) {
    const stopLoss = last.close + 1.5 * atrValue;
    const risk = stopLoss - last.close;
    let target = last.close - 2 * risk;
    if (nearestSupport !== null && nearestSupport < last.close - risk && nearestSupport > target) {
      target = nearestSupport;
    }
    const riskReward = risk > 0 ? (last.close - target) / risk : 0;
    return {
      type: SignalType.SELL,
      confidence: sellScore,
      rules: sellRules,
      price: round2(last.close),
      target: round2(target),
      stopLoss: round2(stopLoss),
      riskReward: round2(riskReward),
    };
  }

  return holdResult(last.close);
}
