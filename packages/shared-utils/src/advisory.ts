import { Candle, PredictionHorizon, TradeAdvisory, TradeSuggestion } from '@stockpred/shared-types';
import { atr, ema, macd } from './indicators';
import { lastFinite, round2 } from './math';
import { positionSize } from './risk';
import { evaluateSignal } from './signal-rules';

export const ADVISORY_MIN_CONFIDENCE = 55;
export const ADVISORY_MIN_BARS = 40;
export const DEFAULT_PAPER_CAPITAL = 10_000_000;
/** After blending ML + trend, the chip only fires at or above this score. */
export const ADVISORY_BLEND_THRESHOLD = 62;
export const STOCK_TREND_BONUS = 10;
export const MARKET_TREND_BONUS = 8;
export const SIDEWAYS_PENALTY = 12;

/** Same 0.1% EMA gap the signal core uses so flat tape is not a trend. */
const EMA_SEPARATION = 0.001;
const MARKET_LOOKBACK_BARS = 5;
const MARKET_SIDEWAYS_PCT = 0.5;

export type PriceTrend = 'UP' | 'DOWN' | 'SIDEWAYS';

const emptyAdvisory = (
  horizon: PredictionHorizon,
  extras: Partial<TradeAdvisory> = {},
): TradeAdvisory => ({
  action: 'HOLD',
  horizon,
  entry: extras.entry ?? null,
  target: null,
  stopLoss: null,
  quantity: 0,
  confidence: extras.confidence ?? 0,
  expectedMove: extras.expectedMove ?? 0,
  modelVersion: extras.modelVersion ?? null,
});

function directionToAction(direction: string | null | undefined): TradeSuggestion {
  if (direction === 'UP') return 'BUY';
  if (direction === 'DOWN') return 'SELL';
  return 'HOLD';
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, round2(value)));
}

/**
 * Stock trend from EMA20 vs EMA50 plus MACD. Matches the signal-engine
 * mandatory core, without the 70-point score gate.
 */
export function classifyPriceTrend(candles: Candle[]): PriceTrend {
  if (candles.length < ADVISORY_MIN_BARS) return 'SIDEWAYS';
  const closes = candles.map((bar) => bar.close);
  const ema20 = lastFinite(ema(closes, 20));
  const ema50 = lastFinite(ema(closes, 50));
  const macdSeries = macd(closes);
  const macdValue = lastFinite(macdSeries.macd);
  const macdSignal = lastFinite(macdSeries.signal);
  const macdHist = lastFinite(macdSeries.histogram);
  if (
    ema20 === null ||
    ema50 === null ||
    macdValue === null ||
    macdSignal === null ||
    macdHist === null
  ) {
    return 'SIDEWAYS';
  }
  const macdBullish = macdValue > macdSignal && macdHist > 0;
  const macdBearish = macdValue < macdSignal && macdHist < 0;
  if (ema20 > ema50 * (1 + EMA_SEPARATION) && macdBullish) return 'UP';
  if (ema20 < ema50 * (1 - EMA_SEPARATION) && macdBearish) return 'DOWN';
  return 'SIDEWAYS';
}

/**
 * Index tape over ~5 sessions (same window as the ML nifty_trend feature).
 * Returns null when there is not enough history so the stock gate still runs.
 */
export function classifyMarketTrend(candles: Candle[] | undefined): PriceTrend | null {
  if (!candles || candles.length < MARKET_LOOKBACK_BARS + 1) return null;
  const last = candles[candles.length - 1].close;
  const prior = candles[candles.length - 1 - MARKET_LOOKBACK_BARS].close;
  if (prior <= 0) return null;
  const pct = ((last - prior) / prior) * 100;
  if (pct > MARKET_SIDEWAYS_PCT) return 'UP';
  if (pct < -MARKET_SIDEWAYS_PCT) return 'DOWN';
  return 'SIDEWAYS';
}

function stockAgrees(action: TradeSuggestion, stockTrend: PriceTrend): boolean {
  return (action === 'BUY' && stockTrend === 'UP') || (action === 'SELL' && stockTrend === 'DOWN');
}

function stockFights(action: TradeSuggestion, stockTrend: PriceTrend): boolean {
  return (action === 'BUY' && stockTrend === 'DOWN') || (action === 'SELL' && stockTrend === 'UP');
}

function marketFights(action: TradeSuggestion, marketTrend: PriceTrend | null): boolean {
  return (
    (action === 'BUY' && marketTrend === 'DOWN') || (action === 'SELL' && marketTrend === 'UP')
  );
}

function marketAgrees(action: TradeSuggestion, marketTrend: PriceTrend | null): boolean {
  return (
    (action === 'BUY' && marketTrend === 'UP') || (action === 'SELL' && marketTrend === 'DOWN')
  );
}

/**
 * Blend ML confidence with trend confirmation.
 * Agreeing tape raises the score; a flat stock requires a stronger model.
 */
export function blendMlWithTrend(options: {
  mlConfidence: number;
  action: TradeSuggestion;
  stockTrend: PriceTrend;
  marketTrend: PriceTrend | null;
}): number {
  let score = options.mlConfidence;
  if (stockAgrees(options.action, options.stockTrend)) score += STOCK_TREND_BONUS;
  if (options.stockTrend === 'SIDEWAYS') score -= SIDEWAYS_PENALTY;
  if (marketAgrees(options.action, options.marketTrend)) score += MARKET_TREND_BONUS;
  return clampConfidence(score);
}

function finalizeAdvisory(options: {
  action: TradeSuggestion;
  candles: Candle[];
  horizon: PredictionHorizon;
  baseConfidence: number;
  expectedMove: number;
  modelVersion: string | null;
  capital?: number;
  riskPercent?: number;
  marketCandles?: Candle[];
}): TradeAdvisory {
  const entry = options.candles[options.candles.length - 1].close;
  const stockTrend = classifyPriceTrend(options.candles);
  const marketTrend = classifyMarketTrend(options.marketCandles);
  if (stockFights(options.action, stockTrend) || marketFights(options.action, marketTrend)) {
    return emptyAdvisory(options.horizon, {
      entry: round2(entry),
      confidence: options.baseConfidence,
      expectedMove: options.expectedMove,
      modelVersion: options.modelVersion,
    });
  }

  const confidence = blendMlWithTrend({
    mlConfidence: options.baseConfidence,
    action: options.action,
    stockTrend,
    marketTrend,
  });
  if (confidence < ADVISORY_BLEND_THRESHOLD) {
    return emptyAdvisory(options.horizon, {
      entry: round2(entry),
      confidence,
      expectedMove: options.expectedMove,
      modelVersion: options.modelVersion,
    });
  }

  const evaluation = evaluateSignal(options.candles);
  const atrValue = lastFinite(atr(options.candles)) ?? entry * 0.02;
  let stopLoss = options.action === 'BUY' ? entry - 1.5 * atrValue : entry + 1.5 * atrValue;
  const movePct = Math.max(Math.abs(options.expectedMove) / 100, 0.01);
  let target = options.action === 'BUY' ? entry * (1 + movePct) : entry * (1 - movePct);

  if (evaluation.type === options.action) {
    if (evaluation.target != null) target = evaluation.target;
    if (evaluation.stopLoss != null) stopLoss = evaluation.stopLoss;
  }

  const quantity = positionSize(
    options.capital ?? DEFAULT_PAPER_CAPITAL,
    options.riskPercent ?? 1,
    entry,
    stopLoss,
  );

  return {
    action: options.action,
    horizon: options.horizon,
    entry: round2(entry),
    target: round2(target),
    stopLoss: round2(stopLoss),
    quantity,
    confidence,
    expectedMove: options.expectedMove,
    modelVersion: options.modelVersion,
  };
}

/**
 * Compose a paper advisory. ML Buy/Sell is preferred when the model is
 * trained. If there is no forecast yet, the EMA/MACD trend (and the 70-point
 * rule signal when it fires) still fills the Alerts focus list.
 * Opposite trend always Hold. ATR (or a fired signal) sets stop/target.
 */
export function composeTradeAdvisory(options: {
  candles: Candle[];
  direction?: string | null;
  confidence?: number;
  expectedMove?: number;
  modelVersion?: string | null;
  horizon?: PredictionHorizon;
  capital?: number;
  riskPercent?: number;
  minConfidence?: number;
  marketCandles?: Candle[];
}): TradeAdvisory {
  const horizon = options.horizon ?? PredictionHorizon.NEXT_DAY;
  const mlConfidence = options.confidence ?? 0;
  const expectedMove = options.expectedMove ?? 0;
  const modelVersion = options.modelVersion ?? null;
  const minConfidence = options.minConfidence ?? ADVISORY_MIN_CONFIDENCE;
  const candles = options.candles ?? [];

  if (candles.length < ADVISORY_MIN_BARS) {
    return emptyAdvisory(horizon, { confidence: mlConfidence, expectedMove, modelVersion });
  }

  const entry = candles[candles.length - 1].close;
  const mlAction = directionToAction(options.direction);
  if (mlAction !== 'HOLD' && mlConfidence >= minConfidence) {
    return finalizeAdvisory({
      action: mlAction,
      candles,
      horizon,
      baseConfidence: mlConfidence,
      expectedMove,
      modelVersion,
      capital: options.capital,
      riskPercent: options.riskPercent,
      marketCandles: options.marketCandles,
    });
  }
  if (mlAction !== 'HOLD') {
    return emptyAdvisory(horizon, {
      entry: round2(entry),
      confidence: mlConfidence,
      expectedMove,
      modelVersion,
    });
  }

  const rules = evaluateSignal(candles);
  if (rules.type === 'BUY' || rules.type === 'SELL') {
    return finalizeAdvisory({
      action: rules.type,
      candles,
      horizon,
      baseConfidence: Math.max(rules.confidence, ADVISORY_BLEND_THRESHOLD),
      expectedMove: expectedMove || (rules.type === 'BUY' ? 1.5 : -1.5),
      modelVersion: modelVersion ?? 'rules-v1',
      capital: options.capital,
      riskPercent: options.riskPercent,
      marketCandles: options.marketCandles,
    });
  }

  const stockTrend = classifyPriceTrend(candles);
  const marketTrend = classifyMarketTrend(options.marketCandles);
  const trendAction: TradeSuggestion =
    stockTrend === 'UP' ? 'BUY' : stockTrend === 'DOWN' ? 'SELL' : 'HOLD';
  if (trendAction === 'HOLD' || marketFights(trendAction, marketTrend)) {
    return emptyAdvisory(horizon, {
      entry: round2(entry),
      confidence: mlConfidence,
      expectedMove,
      modelVersion,
    });
  }

  return finalizeAdvisory({
    action: trendAction,
    candles,
    horizon,
    baseConfidence: ADVISORY_BLEND_THRESHOLD,
    expectedMove: expectedMove || (trendAction === 'BUY' ? 1 : -1),
    modelVersion: modelVersion ?? 'trend-v1',
    capital: options.capital,
    riskPercent: options.riskPercent,
    marketCandles: options.marketCandles,
  });
}
