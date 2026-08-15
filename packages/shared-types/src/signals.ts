/** Signal classification. HOLD is internal: only BUY/SELL are actionable and published. */
export enum SignalType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

/** An actionable trading signal (spec contract). */
export interface TradingSignal {
  symbol: string;
  signal: 'BUY' | 'SELL';
  /** 0-100 weighted rule-satisfaction score. */
  confidence: number;
  target: number;
  stopLoss: number;
}

/** Signal enriched with evaluation context (persisted / published form). */
export interface EvaluatedSignal extends TradingSignal {
  price: number;
  riskReward: number;
  /** Which individual rules passed, for explainability. */
  rules: Record<string, boolean>;
  generatedAt: number;
}

/** Support / resistance levels for a symbol (spec contract). */
export interface SupportResistance {
  support: number[];
  resistance: number[];
}

/** A detected level with provenance and strength, used internally. */
export interface PriceLevel {
  price: number;
  kind: 'support' | 'resistance';
  source: 'swing' | 'fibonacci' | 'pivot' | 'vwap' | 'volume-profile';
  strength: number;
}

/** Chart pattern detection result (spec contract). */
export interface PatternResult {
  pattern: string;
  confidence: number;
  signal: string;
}

/** Pattern enriched with detection context. */
export interface DetectedPattern extends PatternResult {
  symbol: string;
  direction: 'bullish' | 'bearish';
  detectedAt: number;
}

export const BULLISH_PATTERNS = [
  'CUP_AND_HANDLE',
  'BULL_FLAG',
  'ASCENDING_TRIANGLE',
  'DOUBLE_BOTTOM',
  'INVERSE_HEAD_AND_SHOULDERS',
] as const;

export const BEARISH_PATTERNS = [
  'DOUBLE_TOP',
  'HEAD_AND_SHOULDERS',
  'DESCENDING_TRIANGLE',
  'BEAR_FLAG',
] as const;

export type BullishPattern = (typeof BULLISH_PATTERNS)[number];
export type BearishPattern = (typeof BEARISH_PATTERNS)[number];
export type PatternName = BullishPattern | BearishPattern;

/** One historical confirmation of a named pattern, with forward outcomes. */
export interface PatternOccurrenceView {
  symbol: string;
  pattern: string;
  timeframe: string;
  direction: 'bullish' | 'bearish';
  confidence: number;
  price: number;
  confirmedAt: number;
  return5: number | null;
  return10: number | null;
  return20: number | null;
  maxFavorable: number | null;
  maxAdverse: number | null;
}

/** Analog summary used for "how this pattern behaved before". */
export interface PatternAnalog {
  pattern: string;
  symbol: string;
  sampleSize: number;
  medianReturn5: number | null;
  medianReturn10: number | null;
  medianReturn20: number | null;
  winRate10: number | null;
  suggestion: string;
  occurrences: PatternOccurrenceView[];
}
