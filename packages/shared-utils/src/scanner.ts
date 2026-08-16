import type {
  BullRunSnapshot,
  Candle,
  IndicatorSnapshot,
  MarketBreadth,
  MarketRegime,
} from '@stockpred/shared-types';
import { MarketIndex } from '@stockpred/shared-types';
import { detectBreakouts } from './breakouts';
import { scoreBullBear, scoreReasons } from './bull-score';
import { defaultProbsFromMove, estimateHorizonForecast } from './forecast';
import { compareToBenchmark } from './relative';
import { detectMarketStructure } from './structure';
import { analyzeVolume, volumeBreakoutMultiplier } from './volume';

export interface BuildScannerInput {
  symbol: string;
  candles: Candle[];
  indicators: IndicatorSnapshot | null;
  niftyCandles: Candle[];
  breadth: MarketBreadth;
  regime: MarketRegime;
  upProbability?: number;
  downProbability?: number;
  sidewaysProbability?: number;
  mlConfidence?: number;
  mlExpectedMove?: number;
}

/** Single snapshot used by live quotes, scanner list, and scanner backtest. */
export function buildBullRunSnapshot(input: BuildScannerInput): BullRunSnapshot | null {
  if (input.candles.length < 40) return null;
  const multiplier = volumeBreakoutMultiplier();
  const volume = analyzeVolume(input.candles, multiplier);
  const structure = detectMarketStructure(input.candles);
  const breakouts = detectBreakouts(input.candles, multiplier);
  const rs = compareToBenchmark(
    input.symbol,
    MarketIndex.NIFTY_50,
    input.candles,
    input.niftyCandles,
    60,
  );
  const scored = scoreBullBear({
    candles: input.candles,
    indicators: input.indicators,
    structure,
    breakouts,
    volumeRatio: volume.volumeRatio,
    relativePerformancePercent: rs?.relativePerformancePercent ?? null,
    breadth: input.breadth,
    regime: input.regime,
  });
  const hasMl = input.mlConfidence !== undefined || input.upProbability !== undefined;
  const probs = hasMl
    ? {
        up:
          input.upProbability ??
          defaultProbsFromMove(input.mlExpectedMove ?? 0, input.mlConfidence ?? 0).up,
        down:
          input.downProbability ??
          defaultProbsFromMove(input.mlExpectedMove ?? 0, input.mlConfidence ?? 0).down,
        sideways:
          input.sidewaysProbability ??
          defaultProbsFromMove(input.mlExpectedMove ?? 0, input.mlConfidence ?? 0).sideways,
        confidence: input.mlConfidence ?? 0,
      }
    : defaultProbsFromMove(input.mlExpectedMove ?? 0, input.mlConfidence ?? 40);
  const forecast = estimateHorizonForecast(input.candles, probs);
  const reasons = scoreReasons({
    band: scored.band,
    breakouts,
    structure,
    volumeRatio: volume.volumeRatio,
    relativePerformancePercent: rs?.relativePerformancePercent ?? null,
    regime: input.regime,
    risk: scored.risk,
  });
  return {
    bullScore: scored.bullScore,
    bearScore: scored.bearScore,
    band: scored.band,
    risk: scored.risk,
    contributors: scored.contributors,
    structure,
    breakouts,
    volume,
    relativeStrengthNifty50: rs?.relativeStrength ?? null,
    niftyOutperformancePercent: rs?.relativePerformancePercent ?? null,
    forecast,
    reasons,
  };
}
