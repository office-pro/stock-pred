/**
 * MI-7.4 — Historical analogues with strict leakage controls.
 * candidateObservation.timestamp < target.asOf
 * outcomeStart > analogueTimestamp
 * Features never include future / outcomes.
 */
import type {
  AdvancedAnalogueMatch,
  AdvancedAnaloguePayload,
  AdvancedIntelligenceSection,
  InstrumentRef,
} from '@stockpred/shared-types';
import { HISTORICAL_ANALOGUE_MIN_SAMPLE } from '@stockpred/shared-types';
import {
  findHistoricalAnalogues,
  type HistoricalSeriesInput,
} from './historical-intelligence-engine';
import { emptySectionProvenance, unavailableSection } from './mi-advanced-contract';

export const MI_7_ANALOGUE_FEATURE_VERSION = 'mi-7-analogue.v1';
export const MI_7_ANALOGUE_METHOD = 'frozen-pit-analogues.v1';

function forwardReturn(closes: number[], startIdx: number, bars: number): number | null {
  const start = closes[startIdx];
  if (!(start > 0) || startIdx + bars >= closes.length) return null;
  // outcomeStart = startIdx + 1 > analogueTimestamp (index)
  const end = closes[startIdx + bars];
  if (!(end > 0)) return null;
  return (end - start) / start;
}

/**
 * Enforce: analogue index strictly before query index (no same-timestamp leakage).
 * findHistoricalAnalogues already uses i < queryIdx - maxHorizon.
 */
export function assertAnalogueLeakageSafe(input: {
  queryIdx: number;
  analogueIdx: number;
  outcomeBars: number;
  closesLength: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!(input.analogueIdx < input.queryIdx)) {
    return { ok: false, reason: 'ANALOGUE_NOT_STRICTLY_BEFORE_TARGET' };
  }
  // outcome window starts after analogue bar
  const outcomeStart = input.analogueIdx + 1;
  if (!(outcomeStart > input.analogueIdx)) {
    return { ok: false, reason: 'OUTCOME_START_NOT_AFTER_ANALOGUE' };
  }
  if (input.analogueIdx + input.outcomeBars >= input.closesLength) {
    return { ok: false, reason: 'INSUFFICIENT_FORWARD_FOR_OUTCOME' };
  }
  return { ok: true };
}

export function assessAdvancedAnalogueSection(input: {
  instrument: InstrumentRef;
  closes: number[];
  volumes?: number[];
  dates?: string[];
  asOf: string;
  calculatedAt?: string;
  sourceSnapshotId?: string;
  /** Historical membership flags aligned to closes indices when available. */
  membershipAtIndex?: boolean[];
}): AdvancedIntelligenceSection<AdvancedAnaloguePayload> {
  const asOf = input.asOf;
  const calculatedAt = input.calculatedAt ?? asOf;
  const sourceId = input.sourceSnapshotId;
  const closes = input.closes;

  if (closes.length < 90) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_ANALOGUE_METHOD,
      reason: 'INSUFFICIENT_HISTORY',
      status: 'DATA_INCOMPLETE',
    }) as AdvancedIntelligenceSection<AdvancedAnaloguePayload>;
  }

  const series: HistoricalSeriesInput = {
    symbol: input.instrument.symbol,
    closes,
    volumes: input.volumes,
    dates: input.dates,
  };
  const set = findHistoricalAnalogues(series);
  if (set.status !== 'AVAILABLE' || set.analogues.length < HISTORICAL_ANALOGUE_MIN_SAMPLE) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_ANALOGUE_METHOD,
      reason: set.reason ?? 'INSUFFICIENT_ANALOGUE_SAMPLE',
      status: 'UNAVAILABLE',
    }) as AdvancedIntelligenceSection<AdvancedAnaloguePayload>;
  }

  const queryIdx = set.queryAsOfIndex;
  const matches: AdvancedAnalogueMatch[] = [];
  for (const a of set.analogues) {
    if (!(a.historicalIndex < queryIdx)) continue;
    // Survivorship: if membership vector provided, require true at analogue index
    if (input.membershipAtIndex && input.membershipAtIndex[a.historicalIndex] === false) {
      continue;
    }
    const leak5 = assertAnalogueLeakageSafe({
      queryIdx,
      analogueIdx: a.historicalIndex,
      outcomeBars: 5,
      closesLength: closes.length,
    });
    const leak20 = assertAnalogueLeakageSafe({
      queryIdx,
      analogueIdx: a.historicalIndex,
      outcomeBars: 20,
      closesLength: closes.length,
    });
    const leak60 = assertAnalogueLeakageSafe({
      queryIdx,
      analogueIdx: a.historicalIndex,
      outcomeBars: 60,
      closesLength: closes.length,
    });
    matches.push({
      date: a.historicalDate ?? null,
      historicalIndex: a.historicalIndex,
      similarity: a.similarity,
      outcome5D: leak5.ok ? forwardReturn(closes, a.historicalIndex, 5) : null,
      outcome20D: leak20.ok ? forwardReturn(closes, a.historicalIndex, 20) : null,
      outcome60D: leak60.ok ? forwardReturn(closes, a.historicalIndex, 60) : null,
      evidenceIds: [`analogue-${a.historicalIndex}`],
    });
  }

  // Deterministic order: similarity desc, index asc
  matches.sort((x, y) => {
    if (y.similarity !== x.similarity) return y.similarity - x.similarity;
    return x.historicalIndex - y.historicalIndex;
  });
  const top = matches.slice(0, 50);

  if (top.length < HISTORICAL_ANALOGUE_MIN_SAMPLE) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_ANALOGUE_METHOD,
      reason: 'INSUFFICIENT_AFTER_LEAKAGE_FILTER',
      status: 'UNAVAILABLE',
    }) as AdvancedIntelligenceSection<AdvancedAnaloguePayload>;
  }

  const mean = (xs: Array<number | null | undefined>) => {
    const v = xs.filter((n): n is number => n != null && Number.isFinite(n));
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  };

  const payload: AdvancedAnaloguePayload = {
    matches: top,
    summary: {
      sampleSize: top.length,
      distribution: {
        mean5D: mean(top.map((m) => m.outcome5D)),
        mean20D: mean(top.map((m) => m.outcome20D)),
        mean60D: mean(top.map((m) => m.outcome60D)),
      },
    },
  };

  return {
    status: 'AVAILABLE',
    provenance: emptySectionProvenance({
      asOf,
      calculatedAt,
      method: MI_7_ANALOGUE_METHOD,
      featureVersion: MI_7_ANALOGUE_FEATURE_VERSION,
      sourceSnapshotId: sourceId,
      status: 'AVAILABLE',
      inputsUsed: [
        'closes',
        'strict_before_asOf',
        'outcomeStart_gt_analogue',
        input.membershipAtIndex ? 'historical_membership' : 'membership_unknown',
      ],
      evidenceIds: top
        .map((m) => m.evidenceIds[0]!)
        .filter(Boolean)
        .sort(),
    }),
    payload,
  };
}
