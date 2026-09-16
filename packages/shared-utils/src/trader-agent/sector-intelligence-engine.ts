/**
 * B9 Sector Intelligence — advisory only.
 * Never sorts opportunities / never authorization.
 */
import type {
  SectorIntelligenceSnapshot,
  SectorMemberSnapshot,
  SectorState,
} from '@stockpred/shared-types';
import {
  B9_B17_FEATURE_VERSION,
  closesFromCandles,
  periodReturn,
  provenance,
  round4,
  stdev,
  returnsFromCloses,
} from './b9-b17-helpers';

export interface SectorMemberInput {
  symbol: string;
  sector: string;
  candles: Array<{ close?: number }>;
  relativeStrength?: number | null;
}

function memberReturns(m: SectorMemberInput): SectorMemberSnapshot | null {
  const closes = closesFromCandles(m.candles);
  if (closes.length < 6) return null;
  return {
    symbol: m.symbol,
    return1d: periodReturn(closes, 1),
    return5d: periodReturn(closes, 5),
    return20d: periodReturn(closes, 20),
    return60d: periodReturn(closes, Math.min(60, closes.length - 1)),
    relativeStrength: m.relativeStrength ?? null,
  };
}

function stateFromMetrics(
  ret20: number | null,
  rs: number | null,
  breadthUp: number,
  breadthDown: number,
): SectorState {
  if (ret20 == null && rs == null) return 'UNKNOWN';
  const score =
    (ret20 != null ? ret20 : 0) * 100 +
    (rs != null ? (rs - 1) * 50 : 0) +
    (breadthUp - breadthDown) * 0.15;
  const priorProxy = ret20 != null ? ret20 * 80 : 0;
  if (score >= 3 && priorProxy < 1.5) return 'IMPROVING';
  if (score >= 2) return 'LEADING';
  if (score <= -3 && priorProxy > -1.5) return 'WEAKENING';
  if (score <= -2) return 'LAGGING';
  if (score > 0) return 'IMPROVING';
  if (score < 0) return 'WEAKENING';
  return 'UNKNOWN';
}

export function buildSectorIntelligenceSnapshot(
  sector: string,
  members: SectorMemberInput[],
  now: Date = new Date(),
): SectorIntelligenceSnapshot {
  const baseProv = provenance(
    'sector-intelligence',
    {
      modelVersion: 'sector-evidence.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );

  const inSector = members.filter((m) => (m.sector || '').toUpperCase() === sector.toUpperCase());
  if (inSector.length === 0) {
    return {
      status: 'UNAVAILABLE',
      reason: 'MISSING_INPUT',
      sector,
      state: 'UNKNOWN',
      leaders: [],
      laggards: [],
      coverageSymbols: 0,
      provenance: baseProv,
    };
  }

  const snaps = inSector.map(memberReturns).filter((s): s is SectorMemberSnapshot => !!s);
  if (snaps.length < 2) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      sector,
      state: 'UNKNOWN',
      leaders: [],
      laggards: [],
      coverageSymbols: snaps.length,
      provenance: { ...baseProv, sampleSize: snaps.length },
    };
  }

  const avg = (pick: (s: SectorMemberSnapshot) => number | null | undefined) => {
    const vals = snaps.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    return round4(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  for (const s of snaps) {
    const r = s.return5d;
    if (r == null) continue;
    if (r > 0.001) advancing += 1;
    else if (r < -0.001) declining += 1;
    else unchanged += 1;
  }

  const ret20 = avg((s) => s.return20d);
  const rs = avg((s) => s.relativeStrength);
  const mom = avg((s) => s.return5d);
  const volSeries = inSector
    .map((m) => stdev(returnsFromCloses(closesFromCandles(m.candles)).slice(-20)))
    .filter((v): v is number => v != null);
  const volatility = volSeries.length
    ? round4(volSeries.reduce((a, b) => a + b, 0) / volSeries.length)
    : null;

  const ranked = [...snaps].sort(
    (a, b) => (b.return20d ?? b.return5d ?? -999) - (a.return20d ?? a.return5d ?? -999),
  );

  return {
    status: 'AVAILABLE',
    sector,
    return1d: avg((s) => s.return1d),
    return5d: avg((s) => s.return5d),
    return20d: ret20,
    return60d: avg((s) => s.return60d),
    breadthAdvancing: advancing,
    breadthDeclining: declining,
    breadthUnchanged: unchanged,
    relativeStrength: rs,
    momentum: mom,
    volatility,
    state: stateFromMetrics(ret20, rs, advancing, declining),
    leaders: ranked.slice(0, Math.min(5, ranked.length)),
    laggards: ranked.slice(-Math.min(5, ranked.length)).reverse(),
    coverageSymbols: snaps.length,
    provenance: { ...baseProv, sampleSize: snaps.length },
  };
}

/** Aggregate all sectors present in the member list. */
export function assessAllSectors(
  members: SectorMemberInput[],
  now: Date = new Date(),
): SectorIntelligenceSnapshot[] {
  const sectors = [...new Set(members.map((m) => m.sector).filter(Boolean))];
  return sectors
    .map((s) => buildSectorIntelligenceSnapshot(s, members, now))
    .sort((a, b) => a.sector.localeCompare(b.sector));
}
