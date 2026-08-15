import { Candle, PredictionHorizon, TradeAdvisory, TradeSuggestion } from '@stockpred/shared-types';
import { atr } from './indicators';
import { lastFinite, round2 } from './math';
import { positionSize } from './risk';
import { evaluateSignal } from './signal-rules';

export const ADVISORY_MIN_CONFIDENCE = 55;
export const ADVISORY_MIN_BARS = 40;
export const DEFAULT_PAPER_CAPITAL = 1_000_000;

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

/**
 * Compose a paper advisory: ML direction decides Buy/Sell/Hold; ATR (or a
 * fired signal) supplies stop/target; 1% capital risk sizes the quantity.
 * Never infers Buy from today's already-printed move.
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
}): TradeAdvisory {
  const horizon = options.horizon ?? PredictionHorizon.NEXT_DAY;
  const confidence = options.confidence ?? 0;
  const expectedMove = options.expectedMove ?? 0;
  const modelVersion = options.modelVersion ?? null;
  const minConfidence = options.minConfidence ?? ADVISORY_MIN_CONFIDENCE;
  const candles = options.candles ?? [];

  if (candles.length < ADVISORY_MIN_BARS) {
    return emptyAdvisory(horizon, { confidence, expectedMove, modelVersion });
  }

  const entry = candles[candles.length - 1].close;
  const action = directionToAction(options.direction);
  if (action === 'HOLD' || confidence < minConfidence) {
    return emptyAdvisory(horizon, { entry: round2(entry), confidence, expectedMove, modelVersion });
  }

  const evaluation = evaluateSignal(candles);
  const atrValue = lastFinite(atr(candles)) ?? entry * 0.02;
  let stopLoss = action === 'BUY' ? entry - 1.5 * atrValue : entry + 1.5 * atrValue;
  const movePct = Math.max(Math.abs(expectedMove) / 100, 0.01);
  let target = action === 'BUY' ? entry * (1 + movePct) : entry * (1 - movePct);

  if (evaluation.type === action) {
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
    action,
    horizon,
    entry: round2(entry),
    target: round2(target),
    stopLoss: round2(stopLoss),
    quantity,
    confidence,
    expectedMove,
    modelVersion,
  };
}
