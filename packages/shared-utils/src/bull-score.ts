import type {
  BreakoutFlags,
  BullRunBand,
  Candle,
  IndicatorSnapshot,
  MarketBreadth,
  MarketRegime,
  MarketStructure,
  OverextensionRisk,
  ScoreContributors,
} from '@stockpred/shared-types';
import { clamp, round2 } from './math';
import { getEnvNumber } from './env';

export interface ScoreInputs {
  candles: Candle[];
  indicators: IndicatorSnapshot | null;
  structure: MarketStructure;
  breakouts: BreakoutFlags;
  volumeRatio: number;
  relativePerformancePercent: number | null;
  breadth: MarketBreadth;
  regime: MarketRegime;
}

const REGIME_BULL: Record<MarketRegime, number> = {
  STRONG_BULL: 8,
  BULL: 6,
  NEUTRAL: 3,
  BEAR: 1,
  STRONG_BEAR: 0,
};

const REGIME_BEAR: Record<MarketRegime, number> = {
  STRONG_BULL: 0,
  BULL: 1,
  NEUTRAL: 3,
  BEAR: 6,
  STRONG_BEAR: 8,
};

function last(candles: Candle[]): Candle | undefined {
  return candles[candles.length - 1];
}

export function bullBand(score: number): BullRunBand {
  const candidate = getEnvNumber('BULL_SCORE_CANDIDATE', 85);
  const strong = getEnvNumber('BULL_SCORE_STRONG', 70);
  const bullish = getEnvNumber('BULL_SCORE_BULLISH', 55);
  const neutral = getEnvNumber('BULL_SCORE_NEUTRAL', 45);
  const weak = getEnvNumber('BULL_SCORE_WEAK', 30);
  if (score >= candidate) return 'BULL_RUN_CANDIDATE';
  if (score >= strong) return 'STRONG_BULLISH';
  if (score >= bullish) return 'BULLISH';
  if (score >= neutral) return 'NEUTRAL';
  if (score >= weak) return 'WEAK';
  return 'BEARISH';
}

export function overextensionRisk(
  candles: Candle[],
  indicators: IndicatorSnapshot | null,
): OverextensionRisk {
  const close = last(candles)?.close;
  if (!close || !indicators) return 'NOT_EXTENDED';
  const rsi = indicators.rsi ?? 50;
  const dist20 =
    indicators.ema20 && indicators.ema20 > 0
      ? ((close - indicators.ema20) / indicators.ema20) * 100
      : 0;
  const dist50 =
    indicators.ema50 && indicators.ema50 > 0
      ? ((close - indicators.ema50) / indicators.ema50) * 100
      : 0;
  if (rsi >= 80 && dist20 >= 8) return 'HIGH_RISK_BULLISH';
  if (rsi >= 70 || dist20 >= 5 || dist50 >= 12) return 'EXTENDED';
  return 'NOT_EXTENDED';
}

export function scoreBullBear(input: ScoreInputs): {
  bullScore: number;
  bearScore: number;
  contributors: ScoreContributors;
  band: BullRunBand;
  risk: OverextensionRisk;
} {
  const close = last(input.candles)?.close ?? 0;
  const ind = input.indicators;
  const ema20 = ind?.ema20;
  const ema50 = ind?.ema50;
  const ema200 = ind?.ema200;
  const rsi = ind?.rsi;
  const hist = ind?.macdHistogram;

  let trend = 0;
  if (ema20 && close > ema20) trend += 6;
  if (ema50 && close > ema50) trend += 6;
  if (ema200 && close > ema200) trend += 6;
  trend = Math.min(18, trend);

  let momentum = 0;
  if (hist !== null && hist !== undefined && hist > 0) momentum += 7;
  if (rsi !== null && rsi !== undefined && rsi >= 45 && rsi <= 70) momentum += 6;
  else if (rsi !== null && rsi !== undefined && rsi > 40 && rsi < 75) momentum += 3;
  momentum = Math.min(13, momentum);

  const volume = Math.min(14, clamp((input.volumeRatio - 0.8) * 10, 0, 14));

  let breakout = 0;
  if (input.breakouts.high20) breakout += 5;
  if (input.breakouts.high50) breakout += 5;
  if (input.breakouts.high200) breakout += 3;
  if (input.breakouts.volumeConfirmed) breakout += 2;
  breakout = Math.min(15, breakout);

  const rsPct = input.relativePerformancePercent;
  const relativeStrength = rsPct === null ? 4 : Math.min(10, Math.max(0, 5 + rsPct / 4));

  const breadth =
    input.breadth.participation === 'BROAD'
      ? Math.min(8, 4 + input.breadth.percentAboveEma50 / 25)
      : Math.min(4, input.breadth.percentAboveEma50 / 30);

  const regime = REGIME_BULL[input.regime];

  let structure = 0;
  if (input.structure.trend === 'HH_HL') structure += 10;
  structure += Math.min(4, input.structure.consecutiveHH + input.structure.consecutiveHL);
  structure = Math.min(14, structure);

  const contributors: ScoreContributors = {
    trend: round2(trend),
    momentum: round2(momentum),
    volume: round2(volume),
    breakout: round2(breakout),
    relativeStrength: round2(relativeStrength),
    breadth: round2(breadth),
    regime: round2(regime),
    structure: round2(structure),
  };
  const bullScore = round2(
    clamp(
      contributors.trend +
        contributors.momentum +
        contributors.volume +
        contributors.breakout +
        contributors.relativeStrength +
        contributors.breadth +
        contributors.regime +
        contributors.structure,
      0,
      100,
    ),
  );

  let bearTrend = 0;
  if (ema20 && close < ema20) bearTrend += 6;
  if (ema50 && close < ema50) bearTrend += 6;
  if (ema200 && close < ema200) bearTrend += 6;
  let bearMomentum = 0;
  if (hist !== null && hist !== undefined && hist < 0) bearMomentum += 7;
  if (rsi !== null && rsi !== undefined && rsi >= 70) bearMomentum += 6;
  else if (rsi !== null && rsi !== undefined && rsi < 45) bearMomentum += 4;
  const bearVolume = Math.min(14, input.volumeRatio >= 1.2 && (hist ?? 0) < 0 ? 10 : 4);
  let bearBreak = 0;
  if (!input.breakouts.high20 && ema50 && close < ema50) bearBreak += 8;
  if (ema200 && close < ema200) bearBreak += 5;
  const bearRs = rsPct === null ? 4 : Math.min(10, Math.max(0, 5 - rsPct / 4));
  const bearBreadth =
    input.breadth.participation === 'NARROW'
      ? Math.min(8, 8 - input.breadth.percentAboveEma50 / 20)
      : 2;
  let bearStructure = 0;
  if (input.structure.trend === 'LH_LL') bearStructure += 10;
  bearStructure += Math.min(4, input.structure.consecutiveLH + input.structure.consecutiveLL);

  const bearScore = round2(
    clamp(
      Math.min(18, bearTrend) +
        Math.min(13, bearMomentum) +
        bearVolume +
        Math.min(15, bearBreak) +
        bearRs +
        bearBreadth +
        REGIME_BEAR[input.regime] +
        Math.min(14, bearStructure),
      0,
      100,
    ),
  );

  return {
    bullScore,
    bearScore,
    contributors,
    band: bullBand(bullScore),
    risk: overextensionRisk(input.candles, input.indicators),
  };
}

export function scoreReasons(input: {
  band: BullRunBand;
  breakouts: BreakoutFlags;
  structure: MarketStructure;
  volumeRatio: number;
  relativePerformancePercent: number | null;
  regime: MarketRegime;
  risk: OverextensionRisk;
}): string[] {
  const reasons: string[] = [];
  if (input.breakouts.high50) reasons.push('50-day high breakout');
  else if (input.breakouts.high20) reasons.push('20-day high breakout');
  if (input.breakouts.high200) reasons.push('200-day high breakout');
  if (input.breakouts.volumeConfirmed) reasons.push('Breakout with volume confirmation');
  if (input.structure.trend === 'HH_HL') reasons.push('Higher highs and higher lows');
  if (input.structure.trend === 'LH_LL') reasons.push('Lower highs and lower lows');
  if (input.volumeRatio >= 1.5) reasons.push('Strong volume');
  if ((input.relativePerformancePercent ?? 0) > 0)
    reasons.push('Relative strength vs NIFTY 50 positive');
  if (input.regime === 'BULL' || input.regime === 'STRONG_BULL')
    reasons.push('Market regime bullish');
  if (input.risk === 'EXTENDED') reasons.push('Bullish but extended');
  if (input.risk === 'HIGH_RISK_BULLISH') reasons.push('High-risk bullish (overextended)');
  if (input.band === 'BULL_RUN_CANDIDATE') reasons.push('Bull score in candidate band');
  return reasons;
}
