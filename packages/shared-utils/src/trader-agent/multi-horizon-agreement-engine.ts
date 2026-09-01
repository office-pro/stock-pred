/**
 * T1.5 Multi-horizon agreement (observe-only).
 *
 * Preserves per-horizon assessments; agreement is relative to intended trade
 * horizon / side. Soft conflicts are information — never Risk / Gate inputs.
 */
import type {
  HorizonBiasAssessment,
  MultiHorizonAgreementAssessment,
  MultiHorizonConflict,
  TiAgreementLevel,
  TiChartHorizon,
  TiHorizonBias,
  TiTradeHorizon,
} from '@stockpred/shared-types';

export const MULTI_HORIZON_ENGINE_VERSION = 'multi-horizon-agreement.v1';
export const MULTI_HORIZON_CALCULATION_VERSION = 'bias-from-closes.v1';

const NEUTRAL_BAND = 0.003;

export function inferTradeHorizon(expectedHoldingPeriod?: string | null): TiTradeHorizon {
  const s = (expectedHoldingPeriod ?? '').toLowerCase().trim();
  if (!s) return 'SWING_TRADE';
  if (/intraday|same[\s-]?day|day[\s-]?trade|scalp|hours?/.test(s)) {
    return 'DAY_TRADE';
  }
  if (/position|weeks?|months?|long[\s-]?term/.test(s)) return 'POSITION';
  if (/1-5d|few[\s-]?days|swing|multi[\s-]?day|overnight|sessions?/.test(s)) {
    return 'SWING_TRADE';
  }
  return 'SWING_TRADE';
}

/** Which chart horizons matter for each trade horizon, and in what role. */
export function horizonPlan(
  tradeHorizon: TiTradeHorizon,
): Array<{ horizon: TiChartHorizon; role: HorizonBiasAssessment['role'] }> {
  switch (tradeHorizon) {
    case 'DAY_TRADE':
      return [
        { horizon: 'M5', role: 'PRIMARY' },
        { horizon: 'M15', role: 'PRIMARY' },
        { horizon: 'H1', role: 'PRIMARY' },
        { horizon: 'D1', role: 'HIGHER_TF' },
        { horizon: 'W1', role: 'CONTEXT' },
      ];
    case 'POSITION':
      return [
        { horizon: 'H1', role: 'CONTEXT' },
        { horizon: 'D1', role: 'PRIMARY' },
        { horizon: 'W1', role: 'PRIMARY' },
      ];
    case 'SWING_TRADE':
    default:
      return [
        { horizon: 'M15', role: 'CONTEXT' },
        { horizon: 'H1', role: 'PRIMARY' },
        { horizon: 'H4', role: 'PRIMARY' },
        { horizon: 'D1', role: 'PRIMARY' },
        { horizon: 'W1', role: 'HIGHER_TF' },
      ];
  }
}

export function biasFromCloses(
  closes: number[] | null | undefined,
  lookback = 10,
  neutralBand = NEUTRAL_BAND,
): { bias: TiHorizonBias; strength?: number } {
  const clean = (closes ?? []).filter((c) => Number.isFinite(c) && c > 0);
  if (clean.length < 3) return { bias: 'UNKNOWN' };
  const lb = Math.min(lookback, clean.length - 1);
  const start = clean[clean.length - 1 - lb]!;
  const end = clean[clean.length - 1]!;
  if (!(start > 0)) return { bias: 'UNKNOWN' };
  const ret = (end - start) / start;
  const strength = Math.min(1, Math.abs(ret) / 0.05);
  if (Math.abs(ret) < neutralBand) return { bias: 'NEUTRAL', strength };
  return { bias: ret > 0 ? 'BULLISH' : 'BEARISH', strength };
}

/** Crude H4 series from 1h closes (every 4th bar). */
export function approximateH4ClosesFromH1(h1Closes: number[]): number[] {
  if (h1Closes.length < 4) return [];
  const out: number[] = [];
  for (let i = 3; i < h1Closes.length; i += 4) out.push(h1Closes[i]!);
  return out;
}

/** Crude weekly closes from daily (every 5th session close). */
export function approximateW1ClosesFromD1(d1Closes: number[]): number[] {
  if (d1Closes.length < 5) return [];
  const out: number[] = [];
  for (let i = 4; i < d1Closes.length; i += 5) out.push(d1Closes[i]!);
  return out;
}

function desiredBias(side: 'LONG' | 'SHORT'): TiHorizonBias {
  return side === 'LONG' ? 'BULLISH' : 'BEARISH';
}

function opposing(desired: TiHorizonBias, actual: TiHorizonBias): boolean {
  if (desired === 'BULLISH') return actual === 'BEARISH';
  if (desired === 'BEARISH') return actual === 'BULLISH';
  return false;
}

function agreementFromScores(aligned: number, total: number): TiAgreementLevel {
  if (total <= 0) return 'UNKNOWN';
  const ratio = aligned / total;
  if (ratio >= 0.8) return 'HIGH';
  if (ratio >= 0.5) return 'MED';
  return 'LOW';
}

function dominantFrom(biases: TiHorizonBias[]): TiHorizonBias {
  const known = biases.filter((b) => b !== 'UNKNOWN');
  if (!known.length) return 'UNKNOWN';
  const counts: Record<string, number> = {};
  for (const b of known) counts[b] = (counts[b] ?? 0) + 1;
  let best: TiHorizonBias = 'NEUTRAL';
  let bestN = -1;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) {
      bestN = n;
      best = k as TiHorizonBias;
    }
  }
  return best;
}

function iso(asOf?: string | number): string | undefined {
  if (asOf == null) return undefined;
  return typeof asOf === 'number' ? new Date(asOf).toISOString() : asOf;
}

export interface AssessMultiHorizonAgreementInput {
  tradeHorizon: TiTradeHorizon;
  intendedSide: 'LONG' | 'SHORT';
  closesByHorizon?: Partial<Record<TiChartHorizon, number[] | null | undefined>>;
  biasOverrides?: Partial<
    Record<TiChartHorizon, TiHorizonBias | { bias: TiHorizonBias; strength?: number }>
  >;
  sourceDataTimestamp?: string;
  asOf?: string | number;
}

export function assessMultiHorizonAgreement(
  input: AssessMultiHorizonAgreementInput,
): MultiHorizonAgreementAssessment {
  const plan = horizonPlan(input.tradeHorizon);
  const want = desiredBias(input.intendedSide);
  const asOf = iso(input.asOf) ?? new Date().toISOString();
  const sourceTs = input.sourceDataTimestamp ?? asOf;

  const horizons: HorizonBiasAssessment[] = plan.map(({ horizon, role }) => {
    const override = input.biasOverrides?.[horizon];
    let bias: TiHorizonBias = 'UNKNOWN';
    let strength: number | undefined;
    if (override != null) {
      if (typeof override === 'string') bias = override;
      else {
        bias = override.bias;
        strength = override.strength;
      }
    } else {
      const derived = biasFromCloses(input.closesByHorizon?.[horizon]);
      bias = derived.bias;
      strength = derived.strength;
    }
    const barCount = input.closesByHorizon?.[horizon]?.length ?? null;
    return {
      horizon,
      bias,
      ...(strength != null ? { strength } : {}),
      role,
      provenance: {
        engineVersion: MULTI_HORIZON_ENGINE_VERSION,
        calculationVersion: MULTI_HORIZON_CALCULATION_VERSION,
        sourceDataTimestamp: sourceTs,
        asOf,
        inputs: {
          horizon,
          role,
          barCount,
          lookback: 10,
          neutralBand: NEUTRAL_BAND,
        },
      },
    };
  });

  const conflicts: MultiHorizonConflict[] = [];
  let primaryAligned = 0;
  let primaryTotal = 0;
  let htfAligned = 0;
  let htfTotal = 0;

  for (const h of horizons) {
    if (h.bias === 'UNKNOWN') continue;
    if (h.role === 'PRIMARY') {
      primaryTotal += 1;
      if (h.bias === want) primaryAligned += 1;
      else if (h.bias === 'NEUTRAL') primaryAligned += 0.5;
      else if (opposing(want, h.bias)) {
        conflicts.push({
          code: 'HORIZON_PRIMARY_DISAGREE',
          message: `${h.horizon} ${h.bias} vs intended ${want} (${input.tradeHorizon})`,
          horizons: [h.horizon],
        });
      }
    } else if (h.role === 'HIGHER_TF') {
      htfTotal += 1;
      if (h.bias === want) htfAligned += 1;
      else if (h.bias === 'NEUTRAL') {
        htfAligned += 0.5;
        conflicts.push({
          code: 'HTF_NOT_CONFIRMED',
          message: `${h.horizon} trend not confirmed (${h.bias})`,
          horizons: [h.horizon],
        });
      } else if (opposing(want, h.bias)) {
        conflicts.push({
          code: 'HTF_OPPOSES',
          message: `Higher timeframe ${h.horizon} is ${h.bias} vs intended ${want}`,
          horizons: [h.horizon],
        });
      }
    }
  }

  return {
    tradeHorizon: input.tradeHorizon,
    intendedSide: input.intendedSide,
    horizons,
    agreement: agreementFromScores(primaryAligned, primaryTotal),
    higherTimeframeAlignment: agreementFromScores(htfAligned, htfTotal),
    dominantBias: dominantFrom(horizons.filter((h) => h.role === 'PRIMARY').map((h) => h.bias)),
    conflicts,
    provenance: {
      engineVersion: MULTI_HORIZON_ENGINE_VERSION,
      calculationVersion: MULTI_HORIZON_CALCULATION_VERSION,
      sourceDataTimestamp: sourceTs,
      asOf,
      inputs: {
        tradeHorizon: input.tradeHorizon,
        intendedSide: input.intendedSide,
        primaryKnown: primaryTotal,
        htfKnown: htfTotal,
      },
    },
  };
}
