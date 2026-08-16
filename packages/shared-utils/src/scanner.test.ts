import { DEFAULT_SCANNER_ALERT_GATES, MarketIndex, MarketRegime } from '@stockpred/shared-types';
import { analyzeVolume } from './volume';
import { detectBreakouts } from './breakouts';
import { detectMarketStructure } from './structure';
import { computeMarketBreadth } from './breadth';
import { classifyMarketRegime } from './regime';
import { bullBand, scoreBullBear } from './bull-score';
import { estimateHorizonForecast } from './forecast';
import { isBearReversalAlert, isBullRunAlert } from './scanner-alerts';
import { buildBullRunSnapshot } from './scanner';
import { runScannerBacktest } from './scanner-backtest';
import { computeIndicatorSnapshot } from './indicators';
import { candlesFromCloses, uptrendCloses, downtrendCloses } from './test-helpers';

describe('bull-run scanners', () => {
  it('flags unusual volume when last bar is above the multiplier', () => {
    const volumes = Array.from({ length: 25 }, (_, i) => (i === 24 ? 5000 : 1000));
    const candles = candlesFromCloses(
      Array.from({ length: 25 }, () => 100),
      { volumes },
    );
    const stats = analyzeVolume(candles, 1.5);
    expect(stats.volumeRatio).toBeGreaterThan(1.5);
    expect(stats.unusual).toBe(true);
  });

  it('detects a 20-day high breakout with volume confirmation', () => {
    const closes = [...Array.from({ length: 25 }, () => 100), 120];
    const volumes = [...Array.from({ length: 25 }, () => 1000), 4000];
    const candles = candlesFromCloses(closes, { volumes });
    const flags = detectBreakouts(candles, 1.5);
    expect(flags.high20).toBe(true);
    expect(flags.volumeConfirmed).toBe(true);
  });

  it('labels an uptrend as higher-high / higher-low when swings rise', () => {
    const closes: number[] = [];
    for (let wave = 0; wave < 6; wave += 1) {
      const base = 100 + wave * 12;
      for (let i = 0; i < 10; i += 1) closes.push(base + i);
      for (let i = 1; i <= 4; i += 1) closes.push(base + 10 - i);
    }
    const structure = detectMarketStructure(candlesFromCloses(closes));
    expect(structure.trend === 'HH_HL' || structure.higherHighs >= 2 || structure.slope > 0).toBe(
      true,
    );
  });

  it('computes breadth participation from EMA samples', () => {
    const breadth = computeMarketBreadth([
      {
        changePercent: 1,
        close: 110,
        ema20: 100,
        ema50: 100,
        ema200: 90,
        high52w: 109,
        low52w: 80,
      },
      {
        changePercent: 0.8,
        close: 105,
        ema20: 100,
        ema50: 100,
        ema200: 90,
        high52w: 108,
        low52w: 80,
      },
      { changePercent: -1, close: 80, ema20: 90, ema50: 95, ema200: 100, high52w: 120, low52w: 79 },
    ]);
    expect(breadth.advancing).toBe(2);
    expect(breadth.declining).toBe(1);
    expect(breadth.percentAboveEma50).toBeGreaterThan(50);
    expect(breadth.newHighs52w).toBeGreaterThanOrEqual(1);
  });

  it('classifies a strong-bull regime when Nifty and breadth agree', () => {
    const nifty = candlesFromCloses(uptrendCloses(250, 20000));
    const breadth = computeMarketBreadth(
      Array.from({ length: 20 }, () => ({
        changePercent: 1,
        close: 110,
        ema20: 100,
        ema50: 100,
        ema200: 90,
        high52w: 109,
        low52w: 70,
      })),
    );
    expect(classifyMarketRegime(nifty, breadth, 12)).toBe('STRONG_BULL');
  });

  it('maps bull scores into configurable bands', () => {
    expect(bullBand(90)).toBe('BULL_RUN_CANDIDATE');
    expect(bullBand(75)).toBe('STRONG_BULLISH');
    expect(bullBand(60)).toBe('BULLISH');
    expect(bullBand(20)).toBe('BEARISH');
  });

  it('scores an uptrend higher on the bull side than the bear side', () => {
    const candles = candlesFromCloses(uptrendCloses(250));
    const indicators = computeIndicatorSnapshot('TEST', candles);
    const structure = detectMarketStructure(candles);
    const breakouts = detectBreakouts(candles, 1.5);
    const result = scoreBullBear({
      candles,
      indicators,
      structure,
      breakouts,
      volumeRatio: 1.6,
      relativePerformancePercent: 8,
      breadth: computeMarketBreadth([
        {
          changePercent: 1,
          close: 110,
          ema20: 100,
          ema50: 100,
          ema200: 90,
          high52w: 111,
          low52w: 70,
        },
      ]),
      regime: MarketRegime.BULL,
    });
    expect(result.bullScore).toBeGreaterThan(result.bearScore);
    expect(result.contributors.trend).toBeGreaterThan(0);
  });

  it('weights expected 20d return toward historical up moves when UP probability is high', () => {
    const candles = candlesFromCloses(uptrendCloses(80));
    const forecast = estimateHorizonForecast(candles, {
      up: 85,
      down: 7,
      sideways: 8,
      confidence: 80,
    });
    expect(forecast.expectedReturn20d).toBeGreaterThan(0);
    expect(forecast.upProbability).toBe(85);
    expect(forecast.bullCase20d).toBeGreaterThanOrEqual(forecast.bearCase20d);
  });

  it('does not alert when forecast confidence is below the gate', () => {
    const candles = candlesFromCloses(uptrendCloses(250));
    const snapshot = buildBullRunSnapshot({
      symbol: 'TEST',
      candles,
      indicators: computeIndicatorSnapshot('TEST', candles),
      niftyCandles: candlesFromCloses(uptrendCloses(250, 20000), { symbol: MarketIndex.NIFTY_50 }),
      breadth: computeMarketBreadth([
        {
          changePercent: 1,
          close: 110,
          ema20: 100,
          ema50: 100,
          ema200: 90,
          high52w: 111,
          low52w: 70,
        },
      ]),
      regime: MarketRegime.BULL,
      upProbability: 90,
      downProbability: 5,
      sidewaysProbability: 5,
      mlConfidence: 20,
    });
    expect(snapshot).not.toBeNull();
    expect(
      isBullRunAlert(snapshot!, { ...DEFAULT_SCANNER_ALERT_GATES, minForecastConfidence: 55 }),
    ).toBe(false);
  });

  it('scores a downtrend more bearish than bullish', () => {
    const candles = candlesFromCloses(downtrendCloses(250));
    const result = scoreBullBear({
      candles,
      indicators: computeIndicatorSnapshot('TEST', candles),
      structure: detectMarketStructure(candles),
      breakouts: detectBreakouts(candles, 1.5),
      volumeRatio: 1.8,
      relativePerformancePercent: -10,
      breadth: computeMarketBreadth([
        {
          changePercent: -1,
          close: 80,
          ema20: 90,
          ema50: 95,
          ema200: 100,
          high52w: 120,
          low52w: 79,
        },
      ]),
      regime: MarketRegime.BEAR,
    });
    expect(result.bearScore).toBeGreaterThan(result.bullScore);
  });

  it('flags a reversal when the bear score dominates', () => {
    expect(
      isBearReversalAlert({
        bullScore: 30,
        bearScore: 75,
        band: 'BEARISH',
        risk: 'NOT_EXTENDED',
        contributors: {
          trend: 0,
          momentum: 0,
          volume: 0,
          breakout: 0,
          relativeStrength: 0,
          breadth: 0,
          regime: 0,
          structure: 0,
        },
        structure: {
          higherHighs: 0,
          higherLows: 0,
          lowerHighs: 3,
          lowerLows: 3,
          consecutiveHH: 0,
          consecutiveHL: 0,
          consecutiveLH: 3,
          consecutiveLL: 3,
          trend: 'LH_LL',
          slope: -1,
        },
        breakouts: {
          high20: false,
          high50: false,
          high200: false,
          high52w: false,
          volumeConfirmed: false,
          volumeRatio: 1,
        },
        volume: { avgVolume20: 1000, volumeRatio: 1, volumeTrend: 0, unusual: false },
        relativeStrengthNifty50: 0.8,
        niftyOutperformancePercent: -5,
        forecast: null,
        reasons: [],
      }),
    ).toBe(true);
  });

  it('replays bull-score entries over 20 sessions with the live snapshot definition', () => {
    const candles = candlesFromCloses(uptrendCloses(320));
    const nifty = candlesFromCloses(uptrendCloses(320, 20000), { symbol: MarketIndex.NIFTY_50 });
    const result = runScannerBacktest(candles, nifty, 40);
    expect(result.signals).toBeGreaterThan(0);
    expect(result.metrics.totalTrades).toBe(result.signals);
    expect(result.calibrationError).not.toBeNull();
  });
});
