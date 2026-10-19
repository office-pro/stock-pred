/**
 * MI-7.3 — Observed regime / bull-run classification into AdvancedIntelligenceSection.bullRun.
 * confidence = classification confidence — NOT P(price rises).
 * Reuses candle evidence; does not duplicate B10 probability pipelines as prediction.
 */
import type {
  AdvancedIntelligenceSection,
  AdvancedRegimePayload,
  AdvancedRegimeState,
  BatchDataSnapshot,
  BatchInstrumentData,
  InstrumentRef,
} from '@stockpred/shared-types';
import { closesFromCandles, periodReturn, stdev, returnsFromCloses } from './b9-b17-helpers';
import { emptySectionProvenance, unavailableSection } from './mi-advanced-contract';

export const MI_7_REGIME_FEATURE_VERSION = 'mi-7-regime.v1';
export const MI_7_REGIME_METHOD = 'frozen-candles-regime-classification.v1';

function classifyRegime(closes: number[]): {
  state: AdvancedRegimeState;
  confidence: number | null;
  persistence: AdvancedRegimePayload['persistence'];
  evidence: string[];
} {
  const evidence: string[] = [];
  if (closes.length < 30) {
    return {
      state: 'UNKNOWN',
      confidence: null,
      persistence: 'UNKNOWN',
      evidence: ['INSUFFICIENT_HISTORY'],
    };
  }
  const r20 = periodReturn(closes, Math.min(20, closes.length - 1));
  const r60 = periodReturn(closes, Math.min(60, closes.length - 1));
  const rets = returnsFromCloses(closes.slice(-60));
  const vol = stdev(rets);

  let state: AdvancedRegimeState = 'SIDEWAYS';
  let confidence: number | null = 0.45;
  let persistence: AdvancedRegimePayload['persistence'] = 'MED';

  if (r20 != null && r60 != null) {
    if (r60 > 0.08 && r20 > 0) {
      state = 'BULL';
      confidence = Math.min(0.9, 0.5 + r60);
      evidence.push('Positive medium-term trend');
      if (r20 > 0.03) {
        persistence = 'HIGH';
        evidence.push('Short-term confirms trend');
      }
    } else if (r60 < -0.08 && r20 < 0) {
      state = 'BEAR';
      confidence = Math.min(0.9, 0.5 + Math.abs(r60));
      evidence.push('Negative medium-term trend');
    } else if ((r60 > 0.03 && r20 < -0.02) || (r60 < -0.03 && r20 > 0.02)) {
      state = 'TRANSITION';
      confidence = 0.55;
      persistence = 'LOW';
      evidence.push('Short/medium trend divergence');
    } else {
      state = 'SIDEWAYS';
      confidence = 0.5;
      evidence.push('No strong directional trend');
    }
  } else {
    state = 'UNKNOWN';
    confidence = 0;
    persistence = 'UNKNOWN';
    evidence.push('Unable to compute returns');
  }

  if (vol != null && vol > 0.04 && state !== 'UNKNOWN') {
    evidence.push('Elevated realized volatility');
    if (state === 'BULL' || state === 'BEAR')
      persistence = persistence === 'HIGH' ? 'MED' : persistence;
  }

  return { state, confidence, persistence, evidence };
}

export function assessAdvancedRegimeSection(input: {
  instrument: InstrumentRef;
  row?: BatchInstrumentData;
  dataSnapshot?: BatchDataSnapshot;
  asOf: string;
  calculatedAt?: string;
  sourceSnapshotId?: string;
}): AdvancedIntelligenceSection<AdvancedRegimePayload> {
  const asOf = input.asOf;
  const calculatedAt = input.calculatedAt ?? asOf;
  const sourceId = input.sourceSnapshotId ?? input.dataSnapshot?.dataSnapshotVersion;
  const candles = input.row?.candles ?? [];
  const closes = closesFromCandles(candles);

  if (closes.length < 30) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_REGIME_METHOD,
      reason: closes.length === 0 ? 'NO_CANDLES' : 'INSUFFICIENT_HISTORY',
      status: closes.length === 0 ? 'UNAVAILABLE' : 'DATA_INCOMPLETE',
    }) as AdvancedIntelligenceSection<AdvancedRegimePayload>;
  }

  const classified = classifyRegime(closes);
  const payload: AdvancedRegimePayload = {
    state: classified.state,
    confidence: classified.confidence,
    persistence: classified.persistence,
    evidence: classified.evidence,
    asOf,
    semantics: 'OBSERVED_REGIME_CLASSIFICATION',
  };

  const status = classified.state === 'UNKNOWN' ? 'PARTIAL' : 'AVAILABLE';
  return {
    status,
    provenance: emptySectionProvenance({
      asOf,
      calculatedAt,
      method: MI_7_REGIME_METHOD,
      featureVersion: MI_7_REGIME_FEATURE_VERSION,
      sourceSnapshotId: sourceId,
      sourceSnapshotIds: sourceId ? [sourceId] : [],
      status,
      inputsUsed: ['batch.candles.close', `n=${closes.length}`],
      evidenceIds: classified.evidence.map((_, i) => `regime-ev-${i}`),
    }),
    evidence: classified.evidence.map((note, i) => ({
      evidenceId: `regime-ev-${i}`,
      kind: 'regime',
      note,
      sourceSnapshotId: sourceId,
    })),
    payload,
  };
}
