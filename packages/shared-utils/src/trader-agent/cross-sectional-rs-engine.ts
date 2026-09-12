/**
 * T1.4 Cross-sectional relative strength + sector intelligence (observe-only).
 *
 * Advisory context for Trade Intelligence — never Risk / Portfolio / Policy / Gate input.
 */
import type {
  CrossSectionalRsAssessment,
  SectorIntelligenceAssessment,
  TiRsBucket,
  TiSectorFit,
  TiSectorTrend,
  TiValuationVsPeers,
} from '@stockpred/shared-types';

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function percentileRank(value: number, peers: number[]): number | null {
  const clean = peers.filter((p) => Number.isFinite(p));
  if (!clean.length) return null;
  const below = clean.filter((p) => p < value).length;
  const equal = clean.filter((p) => p === value).length;
  return round4(((below + 0.5 * equal) / clean.length) * 100);
}

export function rsBucketFromRatio(rs: number | null | undefined): TiRsBucket {
  if (rs == null || !Number.isFinite(rs)) return 'UNKNOWN';
  if (rs >= 1.05) return 'LEADERS';
  if (rs >= 0.95) return 'MIDDLE';
  return 'LAGGARDS';
}

export function rsBucketFromPercentile(pct: number | null | undefined): TiRsBucket {
  if (pct == null || !Number.isFinite(pct)) return 'UNKNOWN';
  if (pct >= 70) return 'LEADERS';
  if (pct >= 40) return 'MIDDLE';
  return 'LAGGARDS';
}

export function valuationVsPeersFromPct(
  peVsMedianPct: number | null | undefined,
  pbVsMedianPct?: number | null,
): TiValuationVsPeers {
  const pe = peVsMedianPct != null && Number.isFinite(peVsMedianPct) ? peVsMedianPct : null;
  const pb = pbVsMedianPct != null && Number.isFinite(pbVsMedianPct) ? pbVsMedianPct : null;
  const basis = pe ?? pb;
  if (basis == null) return 'UNKNOWN';
  if (basis <= -10) return 'CHEAP';
  if (basis >= 15) return 'RICH';
  return 'FAIR';
}

export function sectorTrendFromMedianRs(sectorMedianRs: number | null | undefined): TiSectorTrend {
  if (sectorMedianRs == null || !Number.isFinite(sectorMedianRs)) return 'UNKNOWN';
  if (sectorMedianRs >= 1.03) return 'LEADING';
  if (sectorMedianRs >= 0.97) return 'INLINE';
  return 'LAGGING';
}

export function sectorFitFrom(
  rsBucket: TiRsBucket,
  valuation: TiValuationVsPeers,
  sectorTrend: TiSectorTrend,
): TiSectorFit {
  if (rsBucket === 'UNKNOWN' && valuation === 'UNKNOWN' && sectorTrend === 'UNKNOWN') {
    return 'UNKNOWN';
  }
  if (rsBucket === 'LAGGARDS' || valuation === 'RICH' || sectorTrend === 'LAGGING') {
    return 'LOW';
  }
  if (rsBucket === 'LEADERS') return 'HIGH';
  return 'MED';
}

export interface AssessCrossSectionalRsInput {
  rsVsNifty50?: number | null;
  peerRsValues?: number[] | null;
  asOf?: string | number;
}

export function assessCrossSectionalRs(
  input: AssessCrossSectionalRsInput,
): CrossSectionalRsAssessment {
  const rs =
    input.rsVsNifty50 != null && Number.isFinite(input.rsVsNifty50)
      ? round4(Number(input.rsVsNifty50))
      : null;
  const peers = (input.peerRsValues ?? []).filter((p) => Number.isFinite(p));
  const rsPercentile = rs != null && peers.length >= 3 ? percentileRank(rs, peers) : null;

  let rsBucket: TiRsBucket = 'UNKNOWN';
  let source: CrossSectionalRsAssessment['source'] = 'MISSING';
  if (rsPercentile != null) {
    rsBucket = rsBucketFromPercentile(rsPercentile);
    source = rs != null ? 'MIXED' : 'PEER_CROSS_SECTION';
  } else if (rs != null) {
    rsBucket = rsBucketFromRatio(rs);
    source = 'QUOTE_RS';
  }

  const asOf =
    input.asOf == null
      ? undefined
      : typeof input.asOf === 'number'
        ? new Date(input.asOf).toISOString()
        : input.asOf;

  return {
    rsVsNifty50: rs,
    rsPercentile: rsPercentile ?? undefined,
    rsBucket,
    peerSampleSize: peers.length || undefined,
    asOf,
    source,
    provenance: {
      engineVersion: 'cross-sectional-rs.v1',
      calculationVersion: 'rs-bucket.v1',
      sourceDataTimestamp: asOf,
      asOf,
      inputs: {
        rsVsNifty50: rs,
        peerCount: peers.length,
        rsPercentile: rsPercentile ?? null,
      },
    },
  };
}

export interface AssessSectorIntelligenceInput {
  sector?: string | null;
  sectorMedianRs?: number | null;
  stockRsVsNifty50?: number | null;
  peVsMedianPct?: number | null;
  pbVsMedianPct?: number | null;
  rsBucket?: TiRsBucket;
  asOf?: string | number;
}

export function assessSectorIntelligence(
  input: AssessSectorIntelligenceInput,
): SectorIntelligenceAssessment {
  const sectorTrend = sectorTrendFromMedianRs(input.sectorMedianRs);
  const valuationVsPeers = valuationVsPeersFromPct(input.peVsMedianPct, input.pbVsMedianPct);
  const stockRs =
    input.stockRsVsNifty50 != null && Number.isFinite(input.stockRsVsNifty50)
      ? Number(input.stockRsVsNifty50)
      : null;
  const sectorRs =
    input.sectorMedianRs != null && Number.isFinite(input.sectorMedianRs)
      ? Number(input.sectorMedianRs)
      : null;
  const stockVsSectorRs =
    stockRs != null && sectorRs != null && sectorRs > 1e-9 ? round4(stockRs / sectorRs) : null;
  const rsBucket = input.rsBucket ?? rsBucketFromRatio(stockRs);
  const sectorFit = sectorFitFrom(rsBucket, valuationVsPeers, sectorTrend);
  const asOf =
    input.asOf == null
      ? undefined
      : typeof input.asOf === 'number'
        ? new Date(input.asOf).toISOString()
        : input.asOf;

  return {
    sector: input.sector ?? null,
    sectorTrend,
    stockVsSectorRs,
    valuationVsPeers,
    peVsMedianPct:
      input.peVsMedianPct != null && Number.isFinite(input.peVsMedianPct)
        ? round4(Number(input.peVsMedianPct))
        : null,
    pbVsMedianPct:
      input.pbVsMedianPct != null && Number.isFinite(input.pbVsMedianPct)
        ? round4(Number(input.pbVsMedianPct))
        : null,
    sectorFit,
    asOf,
    provenance: {
      engineVersion: 'sector-intelligence.v1',
      calculationVersion: 'sector-fit.v1',
      sourceDataTimestamp: asOf,
      asOf,
      inputs: {
        sector: input.sector ?? null,
        sectorMedianRs:
          input.sectorMedianRs != null && Number.isFinite(input.sectorMedianRs)
            ? Number(input.sectorMedianRs)
            : null,
        peVsMedianPct:
          input.peVsMedianPct != null && Number.isFinite(input.peVsMedianPct)
            ? Number(input.peVsMedianPct)
            : null,
        rsBucket,
      },
    },
  };
}
