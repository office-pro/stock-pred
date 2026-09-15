/**
 * B13 Historical Event Intelligence — comparable path outcomes only.
 */
import type {
  HistoricalEventIntelligence,
  HistoricalHorizonOutcome,
} from '@stockpred/shared-types';
import {
  B9_B17_FEATURE_VERSION,
  closesFromCandles,
  provenance,
  returnsFromCloses,
  round4,
} from './b9-b17-helpers';

const HORIZONS: Array<5 | 10 | 20 | 60 | 120 | 252> = [5, 10, 20, 60, 120, 252];

export interface HistoricalEventTrigger {
  /** Absolute return threshold for a day, e.g. -0.05 for -5%. */
  dayReturnThreshold: number;
  minVolumeRatio?: number | null;
}

function outcomeForHorizon(
  closes: number[],
  eventIdx: number[],
  horizonDays: 5 | 10 | 20 | 60 | 120 | 252,
): HistoricalHorizonOutcome {
  const rets: number[] = [];
  const drawdowns: number[] = [];
  for (const i of eventIdx) {
    const startClose = closes[i];
    const endIdx = i + horizonDays;
    if (!(startClose > 0) || endIdx >= closes.length) continue;
    const endClose = closes[endIdx];
    if (!(endClose > 0)) continue;
    rets.push(endClose / startClose - 1);
    let peak = startClose;
    let maxDd = 0;
    for (let k = i; k <= endIdx; k++) {
      peak = Math.max(peak, closes[k]);
      const dd = closes[k] / peak - 1;
      if (dd < maxDd) maxDd = dd;
    }
    drawdowns.push(maxDd);
  }
  if (rets.length < 3) {
    return {
      horizonDays,
      positiveRate: null,
      medianReturn: null,
      medianDrawdown: null,
      medianRecoveryDays: null,
      sampleSize: rets.length,
    };
  }
  const sorted = [...rets].sort((a, b) => a - b);
  const ddSorted = [...drawdowns].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    horizonDays,
    positiveRate: round4(rets.filter((r) => r > 0).length / rets.length),
    medianReturn: round4(sorted[mid]),
    medianDrawdown: round4(ddSorted[mid]),
    medianRecoveryDays: null,
    sampleSize: rets.length,
  };
}

export function assessHistoricalEvents(
  symbol: string,
  closes: number[],
  volumes: number[] | null,
  trigger: HistoricalEventTrigger,
  now: Date = new Date(),
): HistoricalEventIntelligence {
  const prov = provenance(
    'historical-event-intelligence',
    {
      modelVersion: 'historical-event.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  const rets = returnsFromCloses(closes);
  if (rets.length < 60 || closes.length < 80) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      symbol,
      eventDescription: `dayReturn<=${trigger.dayReturnThreshold}`,
      comparableEvents: 0,
      outcomes: [],
      provenance: prov,
    };
  }

  const volOk = (i: number) => {
    if (trigger.minVolumeRatio == null || !volumes || volumes.length !== closes.length) return true;
    const window = volumes.slice(Math.max(0, i - 20), i);
    if (window.length < 5) return true;
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    return avg > 0 ? volumes[i] / avg >= trigger.minVolumeRatio : true;
  };

  const eventIdx: number[] = [];
  for (let i = 0; i < rets.length; i++) {
    const closeIdx = i + 1;
    if (rets[i] <= trigger.dayReturnThreshold && volOk(closeIdx)) {
      eventIdx.push(closeIdx);
    }
  }

  if (eventIdx.length < 3) {
    return {
      status: 'UNAVAILABLE',
      reason: 'NO_COMPARABLE_EVENTS',
      symbol,
      eventDescription: `dayReturn<=${trigger.dayReturnThreshold}`,
      comparableEvents: eventIdx.length,
      outcomes: [],
      provenance: { ...prov, sampleSize: eventIdx.length },
    };
  }

  const outcomes = HORIZONS.map((h) => outcomeForHorizon(closes, eventIdx, h));
  const usable = outcomes.filter((o) => o.sampleSize >= 3);
  return {
    status: usable.length ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: usable.length ? undefined : 'INSUFFICIENT_HISTORY',
    symbol,
    eventDescription: `dayReturn<=${trigger.dayReturnThreshold}`,
    comparableEvents: eventIdx.length,
    outcomes,
    provenance: { ...prov, sampleSize: eventIdx.length },
  };
}

export function assessHistoricalEventsFromCandles(
  symbol: string,
  candles: Array<{ close?: number; volume?: number }>,
  trigger: HistoricalEventTrigger,
  now?: Date,
): HistoricalEventIntelligence {
  const closes = closesFromCandles(candles);
  const volumes = candles.map((c) => (typeof c.volume === 'number' ? c.volume : 0));
  return assessHistoricalEvents(symbol, closes, volumes, trigger, now);
}
