/**
 * Historical Intelligence Engine — HistoricalState, Analogues, Outcomes, Forward Dist.
 * Point-in-time only. No look-ahead. Min-sample → UNAVAILABLE (never fake 100%/0%).
 * Advisory — never RankingContext / authorization.
 */
import type {
  HistoricalAnalogue,
  HistoricalAnalogueSet,
  HistoricalForwardDistribution,
  HistoricalLookbackWindow,
  HistoricalOutcomeBundle,
  HistoricalOutcomeMetrics,
  HistoricalPredictionHorizon,
  HistoricalState,
  HistoricalStateFeatures,
  PriceReturnBasis,
} from '@stockpred/shared-types';
import {
  HISTORICAL_ANALOGUE_MIN_SAMPLE,
  HISTORICAL_LOOKBACK_BARS,
  HISTORICAL_OUTCOME_MIN_SAMPLE,
  HISTORICAL_PREDICTION_HORIZON_BARS,
} from '@stockpred/shared-types';
import { B9_B17_FEATURE_VERSION, periodReturn, provenance, round4, stdev } from './b9-b17-helpers';

const ENGINE = 'historical-intelligence';
const MODEL = 'historical-analogue.v1';

const DEFAULT_OUTCOME_HORIZONS: HistoricalPredictionHorizon[] = [
  '1D',
  '3D',
  '5D',
  '10D',
  '20D',
  '1M',
  '3M',
  '6M',
  '12M',
];

export interface HistoricalSeriesInput {
  symbol: string;
  closes: number[];
  volumes?: number[] | null;
  /** Optional ISO dates aligned to closes length. */
  dates?: Array<string | null | undefined> | null;
  lookback?: HistoricalLookbackWindow;
  priceReturnBasis?: PriceReturnBasis;
  marketRegime?: string | null;
  sectorState?: string | null;
  now?: Date;
}

function featureAt(
  closes: number[],
  volumes: number[] | null | undefined,
  asOfIndex: number,
): HistoricalStateFeatures | null {
  if (asOfIndex < 60 || asOfIndex >= closes.length) return null;
  const slice = closes.slice(0, asOfIndex + 1);
  const r1 = periodReturn(slice, 1);
  const r5 = periodReturn(slice, 5);
  const r20 = periodReturn(slice, 20);
  const r60 = periodReturn(slice, 60);
  const rets20: number[] = [];
  for (let i = Math.max(1, slice.length - 20); i < slice.length; i++) {
    const a = slice[i - 1];
    const b = slice[i];
    if (a > 0 && b > 0) rets20.push(b / a - 1);
  }
  const vol = stdev(rets20);
  let volumeRatio20: number | null = null;
  if (volumes && volumes.length === closes.length && asOfIndex >= 20) {
    const window = volumes.slice(asOfIndex - 20, asOfIndex);
    const avg = window.reduce((s, v) => s + v, 0) / Math.max(1, window.length);
    const cur = volumes[asOfIndex];
    if (avg > 0 && cur >= 0) volumeRatio20 = round4(cur / avg);
  }
  let peak = slice[Math.max(0, slice.length - 60)] ?? slice[0];
  let maxDd = 0;
  for (let i = Math.max(0, slice.length - 60); i < slice.length; i++) {
    peak = Math.max(peak, slice[i]);
    if (peak > 0) maxDd = Math.min(maxDd, slice[i] / peak - 1);
  }
  return {
    return1d: r1,
    return5d: r5,
    return20d: r20,
    return60d: r60,
    momentum20: r20,
    volatility20: vol != null ? round4(vol) : null,
    volumeRatio20,
    drawdown60: round4(maxDd),
  };
}

function featureDistance(a: HistoricalStateFeatures, b: HistoricalStateFeatures): number {
  const keys: Array<keyof HistoricalStateFeatures> = [
    'return5d',
    'return20d',
    'return60d',
    'volatility20',
    'volumeRatio20',
    'drawdown60',
  ];
  let sum = 0;
  let n = 0;
  const matched: string[] = [];
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (av == null || bv == null || !Number.isFinite(av) || !Number.isFinite(bv)) continue;
    const d = av - bv;
    sum += d * d;
    n += 1;
    matched.push(k);
  }
  if (n < 3) return Number.POSITIVE_INFINITY;
  return Math.sqrt(sum / n);
}

function matchedFeatureNames(a: HistoricalStateFeatures, b: HistoricalStateFeatures): string[] {
  const keys: Array<keyof HistoricalStateFeatures> = [
    'return5d',
    'return20d',
    'return60d',
    'volatility20',
    'volumeRatio20',
    'drawdown60',
  ];
  return keys.filter(
    (k) => a[k] != null && b[k] != null && Number.isFinite(a[k]!) && Number.isFinite(b[k]!),
  );
}

export function buildHistoricalState(
  input: HistoricalSeriesInput,
  asOfIndex?: number,
): HistoricalState {
  const now = input.now ?? new Date();
  const closes = input.closes;
  const idx = asOfIndex ?? closes.length - 1;
  const prov = provenance(
    ENGINE,
    {
      modelVersion: MODEL,
      featureVersion: B9_B17_FEATURE_VERSION,
      sampleSize: closes.length,
      dataStatus: 'OFFLINE',
    },
    now,
  );
  const basis = input.priceReturnBasis ?? 'AS_PROVIDED_CANDLES';
  const corporateActionNote =
    basis === 'AS_PROVIDED_CANDLES'
      ? 'Corporate-action adjustment UNKNOWN — using provider candle closes as provided. Survivorship/membership UNKNOWN unless supplied.'
      : `Price basis ${basis}`;

  if (closes.length < 80 || idx < 60) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      asOfIndex: idx,
      asOfDate: input.dates?.[idx] ?? null,
      analysisTimeframe: '1D',
      features: {},
      priceReturnBasis: basis,
      corporateActionNote,
      universeMembershipStatus: 'UNKNOWN',
      provenance: prov,
    };
  }

  const features = featureAt(closes, input.volumes, idx);
  if (!features) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      asOfIndex: idx,
      asOfDate: input.dates?.[idx] ?? null,
      analysisTimeframe: '1D',
      features: {},
      priceReturnBasis: basis,
      corporateActionNote,
      universeMembershipStatus: 'UNKNOWN',
      provenance: prov,
    };
  }

  return {
    status: 'AVAILABLE',
    symbol: input.symbol,
    asOfIndex: idx,
    asOfDate: input.dates?.[idx] ?? null,
    analysisTimeframe: '1D',
    features,
    priceReturnBasis: basis,
    corporateActionNote,
    universeMembershipStatus: 'UNKNOWN',
    provenance: prov,
  };
}

/**
 * Within-symbol historical analogues: past bars with similar features.
 * Deterministic; candidate-order independent (sorted by similarity then index).
 */
export function findHistoricalAnalogues(input: HistoricalSeriesInput): HistoricalAnalogueSet {
  const now = input.now ?? new Date();
  const lookback = input.lookback ?? '5Y';
  const lookbackBars = HISTORICAL_LOOKBACK_BARS[lookback];
  const closes = input.closes;
  const queryIdx = closes.length - 1;
  const prov = provenance(
    ENGINE,
    { modelVersion: MODEL, featureVersion: B9_B17_FEATURE_VERSION, dataStatus: 'OFFLINE' },
    now,
  );

  const queryState = buildHistoricalState(input, queryIdx);
  if (queryState.status !== 'AVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      reason: queryState.reason ?? 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      lookback,
      queryAsOfIndex: queryIdx,
      analogues: [],
      sampleSize: 0,
      minSampleRequired: HISTORICAL_ANALOGUE_MIN_SAMPLE,
      provenance: prov,
    };
  }

  const start = Math.max(60, queryIdx - lookbackBars);
  const maxHorizon = HISTORICAL_PREDICTION_HORIZON_BARS['12M'];
  const raw: HistoricalAnalogue[] = [];

  for (let i = start; i < queryIdx - maxHorizon; i++) {
    const feat = featureAt(closes, input.volumes, i);
    if (!feat) continue;
    const dist = featureDistance(queryState.features, feat);
    if (!Number.isFinite(dist) || dist > 0.35) continue;
    const similarity = round4(1 / (1 + dist));
    const forwardOk = i + maxHorizon < closes.length;
    raw.push({
      symbol: input.symbol,
      historicalIndex: i,
      historicalDate: input.dates?.[i] ?? null,
      similarity,
      matchedFeatures: matchedFeatureNames(queryState.features, feat),
      marketRegime: input.marketRegime ?? null,
      sectorState: input.sectorState ?? null,
      sampleEligibility: forwardOk ? 'ELIGIBLE' : 'INSUFFICIENT_FORWARD',
    });
  }

  raw.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.historicalIndex - b.historicalIndex;
  });

  // Cap to top 200 eligible for outcome aggregation
  const eligible = raw.filter((a) => a.sampleEligibility === 'ELIGIBLE').slice(0, 200);
  const sampleSize = eligible.length;

  if (sampleSize < HISTORICAL_ANALOGUE_MIN_SAMPLE) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      lookback,
      queryAsOfIndex: queryIdx,
      analogues: eligible,
      sampleSize,
      minSampleRequired: HISTORICAL_ANALOGUE_MIN_SAMPLE,
      provenance: { ...prov, sampleSize },
    };
  }

  return {
    status: 'AVAILABLE',
    symbol: input.symbol,
    lookback,
    queryAsOfIndex: queryIdx,
    analogues: eligible,
    sampleSize,
    minSampleRequired: HISTORICAL_ANALOGUE_MIN_SAMPLE,
    provenance: { ...prov, sampleSize },
  };
}

function maxForwardReturn(closes: number[], startIdx: number, bars: number): number | null {
  const start = closes[startIdx];
  if (!(start > 0) || startIdx + bars >= closes.length) return null;
  let maxRet = -Infinity;
  for (let j = 1; j <= bars; j++) {
    const c = closes[startIdx + j];
    if (!(c > 0)) continue;
    maxRet = Math.max(maxRet, c / start - 1);
  }
  return Number.isFinite(maxRet) ? maxRet : null;
}

function pathMetrics(closes: number[], startIdx: number, bars: number) {
  const start = closes[startIdx];
  const endIdx = startIdx + bars;
  if (!(start > 0) || endIdx >= closes.length) return null;
  const end = closes[endIdx];
  if (!(end > 0)) return null;
  const forwardReturn = end / start - 1;
  let peak = start;
  let trough = start;
  let mfe = 0;
  let mae = 0;
  let maxDd = 0;
  for (let k = startIdx; k <= endIdx; k++) {
    const c = closes[k];
    if (!(c > 0)) continue;
    peak = Math.max(peak, c);
    trough = Math.min(trough, c);
    mfe = Math.max(mfe, c / start - 1);
    mae = Math.min(mae, c / start - 1);
    maxDd = Math.min(maxDd, c / peak - 1);
  }
  return { forwardReturn, mfe, mae, maxDd };
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : round4((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx] ?? null;
}

export function computeHistoricalOutcomes(
  input: HistoricalSeriesInput,
  analogueSet?: HistoricalAnalogueSet,
): HistoricalOutcomeBundle {
  const now = input.now ?? new Date();
  const set = analogueSet ?? findHistoricalAnalogues(input);
  const prov = provenance(
    ENGINE,
    { modelVersion: MODEL, featureVersion: B9_B17_FEATURE_VERSION, dataStatus: 'OFFLINE' },
    now,
  );
  const basis = input.priceReturnBasis ?? 'AS_PROVIDED_CANDLES';

  if (set.status !== 'AVAILABLE' || set.sampleSize < HISTORICAL_OUTCOME_MIN_SAMPLE) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      outcomes: [],
      sampleSize: set.sampleSize,
      minSampleRequired: HISTORICAL_OUTCOME_MIN_SAMPLE,
      priceReturnBasis: basis,
      provenance: { ...prov, sampleSize: set.sampleSize },
    };
  }

  const outcomes: HistoricalOutcomeMetrics[] = [];
  for (const h of DEFAULT_OUTCOME_HORIZONS) {
    const bars = HISTORICAL_PREDICTION_HORIZON_BARS[h];
    const rets: number[] = [];
    const mfes: number[] = [];
    const maes: number[] = [];
    const dds: number[] = [];
    for (const a of set.analogues) {
      const m = pathMetrics(input.closes, a.historicalIndex, bars);
      if (!m) continue;
      rets.push(m.forwardReturn);
      mfes.push(m.mfe);
      maes.push(m.mae);
      dds.push(m.maxDd);
    }
    const sampleSize = rets.length;
    if (sampleSize < HISTORICAL_OUTCOME_MIN_SAMPLE) {
      outcomes.push({
        horizon: h,
        horizonBars: bars,
        status: 'UNAVAILABLE',
        reason: 'INSUFFICIENT_HISTORY',
        sampleSize,
      });
      continue;
    }
    const sorted = [...rets].sort((a, b) => a - b);
    const mfeS = [...mfes].sort((a, b) => a - b);
    const maeS = [...maes].sort((a, b) => a - b);
    const ddS = [...dds].sort((a, b) => a - b);
    outcomes.push({
      horizon: h,
      horizonBars: bars,
      status: 'AVAILABLE',
      sampleSize,
      forwardReturnMean: round4(rets.reduce((s, x) => s + x, 0) / rets.length),
      forwardReturnMedian: median(sorted),
      positiveRate: round4(rets.filter((r) => r > 0).length / rets.length),
      mfeMedian: median(mfeS),
      maeMedian: median(maeS),
      maxDrawdownMedian: median(ddS),
      quantiles: {
        p25: quantile(sorted, 0.25),
        p50: quantile(sorted, 0.5),
        p75: quantile(sorted, 0.75),
      },
    });
  }

  const available = outcomes.filter((o) => o.status === 'AVAILABLE');
  return {
    status: available.length ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: available.length ? undefined : 'INSUFFICIENT_HISTORY',
    symbol: input.symbol,
    outcomes,
    sampleSize: set.sampleSize,
    minSampleRequired: HISTORICAL_OUTCOME_MIN_SAMPLE,
    priceReturnBasis: basis,
    provenance: { ...prov, sampleSize: set.sampleSize },
  };
}

export function buildHistoricalForwardDistribution(
  input: HistoricalSeriesInput,
  horizon: HistoricalPredictionHorizon,
  analogueSet?: HistoricalAnalogueSet,
): HistoricalForwardDistribution {
  const now = input.now ?? new Date();
  const set = analogueSet ?? findHistoricalAnalogues(input);
  const bars = HISTORICAL_PREDICTION_HORIZON_BARS[horizon];
  const prov = provenance(
    ENGINE,
    { modelVersion: MODEL, featureVersion: B9_B17_FEATURE_VERSION, dataStatus: 'OFFLINE' },
    now,
  );

  if (set.status !== 'AVAILABLE' || set.sampleSize < HISTORICAL_ANALOGUE_MIN_SAMPLE) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      horizon,
      horizonBars: bars,
      sampleSize: set.sampleSize,
      calibrationStatus: 'UNAVAILABLE',
      provenance: { ...prov, sampleSize: set.sampleSize },
    };
  }

  const maxFwd: number[] = [];
  const endRets: number[] = [];
  const dds: number[] = [];
  for (const a of set.analogues) {
    const mx = maxForwardReturn(input.closes, a.historicalIndex, bars);
    const m = pathMetrics(input.closes, a.historicalIndex, bars);
    if (mx != null) maxFwd.push(mx);
    if (m) {
      endRets.push(m.forwardReturn);
      dds.push(m.maxDd);
    }
  }

  if (maxFwd.length < HISTORICAL_ANALOGUE_MIN_SAMPLE) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol: input.symbol,
      horizon,
      horizonBars: bars,
      sampleSize: maxFwd.length,
      calibrationStatus: 'UNAVAILABLE',
      provenance: { ...prov, sampleSize: maxFwd.length },
    };
  }

  const sorted = [...endRets].sort((a, b) => a - b);
  const ddSorted = [...dds].sort((a, b) => a - b);
  const p10 = quantile(sorted, 0.1);
  const p90 = quantile(sorted, 0.9);

  return {
    status: 'AVAILABLE',
    symbol: input.symbol,
    horizon,
    horizonBars: bars,
    sampleSize: maxFwd.length,
    meanReturn: round4(endRets.reduce((s, x) => s + x, 0) / endRets.length),
    medianReturn: median(sorted),
    quantiles: {
      p10,
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      p90,
    },
    upsideRange:
      p10 != null && p90 != null ? { low: round4(Math.max(0, p10)), high: round4(p90) } : null,
    downsideRange:
      p10 != null && p10 < 0
        ? { low: round4(p10), high: round4(Math.min(0, median(sorted) ?? 0)) }
        : null,
    drawdownRange:
      ddSorted.length >= 2
        ? { low: round4(ddSorted[0]!), high: round4(ddSorted[ddSorted.length - 1]!) }
        : null,
    maxForwardReturns: [...maxFwd].sort((a, b) => a - b),
    calibrationStatus: 'NOT_MEASURED',
    provenance: { ...prov, sampleSize: maxFwd.length },
  };
}

/** Full assessment for one symbol series — consume-only building block for Bull-Run / Evidence. */
export function assessHistoricalIntelligence(input: HistoricalSeriesInput) {
  const state = buildHistoricalState(input);
  const analogues = findHistoricalAnalogues(input);
  const outcomes = computeHistoricalOutcomes(input, analogues);
  const dist3m = buildHistoricalForwardDistribution(input, '3M', analogues);
  return { state, analogues, outcomes, forwardDistribution3M: dist3m };
}
