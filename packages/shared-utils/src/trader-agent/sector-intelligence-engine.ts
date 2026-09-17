/**
 * B9 Sector Intelligence — advisory only.
 * Never sorts opportunities / never authorization.
 *
 * return1d = canonical current-session observed return (session-return-1d).
 * Longer horizons remain bar-count periodReturn on daily closes (unchanged methodology).
 */
import type {
  SectorIntelligenceSnapshot,
  SectorMemberSnapshot,
  SectorSessionCoverage,
  SectorState,
  SessionReturn1dStatus,
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
import { computeCurrentSessionReturn1d } from './session-return-1d';

export interface SectorMemberInput {
  symbol: string;
  sector: string;
  candles: Array<{ close?: number; time?: number }>;
  relativeStrength?: number | null;
  /** Live last price for canonical current-session 1D (optional). */
  lastPrice?: number | null;
  previousClose?: number | null;
  quoteUpdatedAt?: number | null;
}

function memberReturns(m: SectorMemberInput, now: Date): SectorMemberSnapshot | null {
  const closes = closesFromCandles(m.candles);
  if (closes.length < 6) return null;
  const session = computeCurrentSessionReturn1d({
    candles: m.candles,
    lastPrice: m.lastPrice,
    previousClose: m.previousClose,
    quoteUpdatedAt: m.quoteUpdatedAt,
    now: now.getTime(),
    analysisAt: now.toISOString(),
  });
  return {
    symbol: m.symbol,
    return1d: session.return1d,
    return5d: periodReturn(closes, 5),
    return15d: periodReturn(closes, 15),
    return20d: periodReturn(closes, 20),
    return60d: periodReturn(closes, Math.min(60, closes.length - 1)),
    return126d: periodReturn(closes, Math.min(126, closes.length - 1)),
    return252d: periodReturn(closes, Math.min(252, closes.length - 1)),
    relativeStrength: m.relativeStrength ?? null,
    sessionReturnStatus: session.dataStatus,
    sessionDate: session.sessionDate,
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

/** Equal-weighted normalized series from member closes (last ~126 sessions → ≤32 points). */
function buildTrendSeries(members: SectorMemberInput[], points = 32): number[] {
  const series = members.map((m) => closesFromCandles(m.candles)).filter((c) => c.length >= 20);
  if (series.length === 0) return [];
  const maxLen = Math.min(126, ...series.map((c) => c.length));
  if (maxLen < 5) return [];
  const aligned = series.map((c) => c.slice(-maxLen));
  const index: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    let sum = 0;
    let n = 0;
    for (const closes of aligned) {
      const base = closes[0];
      const cur = closes[i];
      if (base > 0 && cur > 0) {
        sum += (cur / base) * 100;
        n += 1;
      }
    }
    if (n > 0) index.push(round4(sum / n));
  }
  if (index.length <= points) return index;
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const idx = Math.round((i * (index.length - 1)) / (points - 1));
    out.push(index[idx]);
  }
  return out;
}

function buildSessionCoverage(snaps: SectorMemberSnapshot[]): {
  coverage: SectorSessionCoverage;
  sessionDate: string | null;
  dataStatus: SessionReturn1dStatus;
  dataAsOf: number | null;
} {
  const coverage: SectorSessionCoverage = {
    live: 0,
    delayed: 0,
    priorSession: 0,
    closedMarket: 0,
    stale: 0,
    unavailable: 0,
    newestDataAt: null,
    oldestDataAt: null,
  };
  const dates = new Map<string, number>();
  for (const s of snaps) {
    const st = s.sessionReturnStatus ?? 'UNAVAILABLE';
    if (st === 'LIVE') coverage.live += 1;
    else if (st === 'DELAYED') coverage.delayed += 1;
    else if (st === 'PRIOR_SESSION') coverage.priorSession += 1;
    else if (st === 'CLOSED_MARKET') coverage.closedMarket += 1;
    else if (st === 'STALE') coverage.stale += 1;
    else coverage.unavailable += 1;
    if (s.sessionDate) dates.set(s.sessionDate, (dates.get(s.sessionDate) ?? 0) + 1);
  }
  let sessionDate: string | null = null;
  let best = 0;
  for (const [d, n] of dates) {
    if (n > best) {
      best = n;
      sessionDate = d;
    }
  }
  let dataStatus: SessionReturn1dStatus = 'UNAVAILABLE';
  if (coverage.live > 0) dataStatus = 'LIVE';
  else if (coverage.delayed > 0) dataStatus = 'DELAYED';
  else if (coverage.closedMarket > 0) dataStatus = 'CLOSED_MARKET';
  else if (coverage.stale > 0) dataStatus = 'STALE';
  else if (coverage.priorSession > 0) dataStatus = 'PRIOR_SESSION';
  return { coverage, sessionDate, dataStatus, dataAsOf: null };
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
      memberCount: 0,
      trendSeries: [],
      provenance: baseProv,
    };
  }

  const snaps = inSector
    .map((m) => memberReturns(m, now))
    .filter((s): s is SectorMemberSnapshot => !!s);
  if (snaps.length < 2) {
    return {
      status: 'UNAVAILABLE',
      reason: 'INSUFFICIENT_HISTORY',
      sector,
      state: 'UNKNOWN',
      leaders: [],
      laggards: [],
      coverageSymbols: snaps.length,
      memberCount: inSector.length,
      trendSeries: [],
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

  const { coverage, sessionDate, dataStatus } = buildSessionCoverage(snaps);
  const tipTimes = inSector
    .map((m) => m.quoteUpdatedAt)
    .filter((t): t is number => t != null && Number.isFinite(t) && t > 0);
  if (tipTimes.length) {
    coverage.newestDataAt = Math.max(...tipTimes);
    coverage.oldestDataAt = Math.min(...tipTimes);
  }

  return {
    status: 'AVAILABLE',
    sector,
    return1d: avg((s) => s.return1d),
    return5d: avg((s) => s.return5d),
    return15d: avg((s) => s.return15d),
    return20d: ret20,
    return60d: avg((s) => s.return60d),
    return126d: avg((s) => s.return126d),
    return252d: avg((s) => s.return252d),
    breadthAdvancing: advancing,
    breadthDeclining: declining,
    breadthUnchanged: unchanged,
    relativeStrength: rs,
    momentum: mom,
    volatility,
    trendSeries: buildTrendSeries(inSector),
    state: stateFromMetrics(ret20, rs, advancing, declining),
    leaders: ranked.slice(0, Math.min(5, ranked.length)),
    laggards: ranked.slice(-Math.min(5, ranked.length)).reverse(),
    coverageSymbols: snaps.length,
    memberCount: inSector.length,
    sessionDate,
    dataStatus,
    sessionCoverage: coverage,
    provenance: {
      ...baseProv,
      sampleSize: snaps.length,
      dataStatus,
      dataAsOf: coverage.newestDataAt ?? sessionDate,
    },
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
