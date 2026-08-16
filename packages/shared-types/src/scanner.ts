/** Overall market regime inferred from index trend, breadth, and volatility. */
export enum MarketRegime {
  STRONG_BULL = 'STRONG_BULL',
  BULL = 'BULL',
  NEUTRAL = 'NEUTRAL',
  BEAR = 'BEAR',
  STRONG_BEAR = 'STRONG_BEAR',
}

export type TrendStructure = 'HH_HL' | 'LH_LL' | 'MIXED' | 'INSUFFICIENT';

export type BullRunBand =
  | 'BEARISH'
  | 'WEAK'
  | 'NEUTRAL'
  | 'BULLISH'
  | 'STRONG_BULLISH'
  | 'BULL_RUN_CANDIDATE';

/** Overextension label so bullish names are not treated equally. */
export type OverextensionRisk = 'NOT_EXTENDED' | 'EXTENDED' | 'HIGH_RISK_BULLISH';

export type MarketParticipation = 'BROAD' | 'NARROW';

export interface MarketBreadth {
  advancing: number;
  declining: number;
  unchanged: number;
  advanceDeclineRatio: number;
  percentAboveEma20: number;
  percentAboveEma50: number;
  percentAboveEma200: number;
  newHighs52w: number;
  newLows52w: number;
  participation: MarketParticipation;
  sampleSize: number;
  asOf: number;
}

export interface MarketContext {
  regime: MarketRegime;
  breadth: MarketBreadth;
  niftyChangePercent: number;
  vixLevel: number | null;
}

export interface MarketStructure {
  higherHighs: number;
  higherLows: number;
  lowerHighs: number;
  lowerLows: number;
  consecutiveHH: number;
  consecutiveHL: number;
  consecutiveLH: number;
  consecutiveLL: number;
  trend: TrendStructure;
  slope: number;
}

export interface BreakoutFlags {
  high20: boolean;
  high50: boolean;
  high200: boolean;
  high52w: boolean;
  volumeConfirmed: boolean;
  volumeRatio: number;
}

export interface VolumeAnalysis {
  avgVolume20: number | null;
  volumeRatio: number;
  volumeTrend: number;
  unusual: boolean;
}

export interface ScoreContributors {
  trend: number;
  momentum: number;
  volume: number;
  breakout: number;
  relativeStrength: number;
  breadth: number;
  regime: number;
  structure: number;
}

export interface HorizonForecast {
  upProbability: number;
  downProbability: number;
  sidewaysProbability: number;
  expectedReturn5d: number;
  expectedReturn10d: number;
  expectedReturn20d: number;
  bearCase20d: number;
  baseCase20d: number;
  bullCase20d: number;
  confidence: number;
}

/** Combined bull-run snapshot attached to a quote. */
export interface BullRunSnapshot {
  bullScore: number;
  bearScore: number;
  band: BullRunBand;
  risk: OverextensionRisk;
  contributors: ScoreContributors;
  structure: MarketStructure;
  breakouts: BreakoutFlags;
  volume: VolumeAnalysis;
  relativeStrengthNifty50: number | null;
  niftyOutperformancePercent: number | null;
  forecast: HorizonForecast | null;
  reasons: string[];
}

export interface ScannerAlertGates {
  minBullScore: number;
  minUpProbability: number;
  minExpected20d: number;
  minVolumeRatio: number;
  minForecastConfidence: number;
}

export const DEFAULT_SCANNER_ALERT_GATES: ScannerAlertGates = {
  minBullScore: 80,
  minUpProbability: 75,
  minExpected20d: 8,
  minVolumeRatio: 1.5,
  minForecastConfidence: 55,
};
