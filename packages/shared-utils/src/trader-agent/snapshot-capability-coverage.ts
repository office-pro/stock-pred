/**
 * Snapshot-owned capability coverage.
 * Data + Intelligence + Derivatives only. Paper Trading / Trade Plan / Execution excluded.
 * N/A uses `na` with coveragePct null. Applicable coveragePct is backend-owned.
 */

import type {
  AssetClass,
  BatchDataSnapshot,
  BatchInstrumentData,
  SnapshotCapabilityCoverageItem,
  SnapshotCoverageGroup,
  SnapshotCoverageStatus,
} from '@stockpred/shared-types';

type CoverageCap = {
  capability: string;
  group: SnapshotCoverageGroup;
};

export const SNAPSHOT_COVERAGE_CAPABILITIES: CoverageCap[] = [
  { capability: 'marketData', group: 'data' },
  { capability: 'historicalCandles', group: 'data' },
  { capability: 'fundamentals', group: 'data' },
  { capability: 'news', group: 'data' },
  { capability: 'sentiment', group: 'data' },
  { capability: 'macro', group: 'data' },
  { capability: 'onchain', group: 'data' },
  { capability: 'social', group: 'data' },
  { capability: 'technical', group: 'intelligence' },
  { capability: 'sector', group: 'intelligence' },
  { capability: 'benchmark', group: 'intelligence' },
  { capability: 'catalyst', group: 'intelligence' },
  { capability: 'ml', group: 'intelligence' },
  { capability: 'historicalAnalogues', group: 'intelligence' },
  { capability: 'bullRun', group: 'intelligence' },
  { capability: 'relationships', group: 'intelligence' },
  { capability: 'globalImpact', group: 'intelligence' },
  { capability: 'fno', group: 'derivatives' },
  { capability: 'derivatives', group: 'derivatives' },
  { capability: 'positioning', group: 'derivatives' },
];

function assetClassOf(row: BatchInstrumentData): AssetClass {
  return row.instrumentRef.assetClass;
}

function notApplicableReason(capability: string, row: BatchInstrumentData): string | null {
  const assetClass = assetClassOf(row);
  const venue = String(row.instrumentRef.venue ?? '')
    .trim()
    .toUpperCase();
  if (capability === 'fundamentals') {
    if (assetClass === 'FX') return 'NOT_EQUITY';
  }
  if (capability === 'sector') {
    if (
      assetClass === 'CRYPTO_SPOT' ||
      assetClass === 'CRYPTO_FUTURE' ||
      assetClass === 'FX' ||
      assetClass === 'COMMODITY' ||
      assetClass === 'COMMODITY_FUTURE'
    ) {
      return 'NOT_EQUITY';
    }
  }
  if (capability === 'bullRun') {
    if (assetClass === 'CRYPTO_SPOT' || assetClass === 'CRYPTO_FUTURE' || assetClass === 'FX') {
      return 'ASSET_CLASS_UNSUPPORTED';
    }
  }
  if (capability === 'fno') {
    if (
      venue !== 'NSE' ||
      (assetClass !== 'EQUITY' && assetClass !== 'INDEX' && assetClass !== 'ETF')
    ) {
      return 'NOT_NSE_FNO';
    }
  }
  if (capability === 'derivatives') {
    if (
      assetClass === 'FX' ||
      assetClass === 'EQUITY' ||
      assetClass === 'ETF' ||
      assetClass === 'INDEX'
    ) {
      return 'NOT_LISTED_DERIVATIVE';
    }
  }
  if (capability === 'positioning') {
    if (assetClass !== 'CRYPTO_FUTURE') return 'NOT_FUTURES_POSITIONING';
  }
  if (capability === 'onchain') {
    if (assetClass !== 'CRYPTO_SPOT' && assetClass !== 'CRYPTO_FUTURE') return 'NOT_CRYPTO';
  }
  return null;
}

function rowStatus(
  capability: string,
  row: BatchInstrumentData,
): Exclude<SnapshotCoverageStatus, 'N/A'> {
  if (row.dataStatus === 'PENDING') return 'PENDING';
  if (capability === 'marketData') {
    return row.quote && row.quote.price > 0
      ? 'AVAILABLE'
      : row.dataStatus === 'PARTIAL'
        ? 'PARTIAL'
        : 'UNAVAILABLE';
  }
  if (capability === 'historicalCandles') {
    const n = row.candles?.length ?? 0;
    if (n >= 20) return 'AVAILABLE';
    if (n > 0) return 'PARTIAL';
    return 'UNAVAILABLE';
  }
  if (capability === 'technical') {
    const tech = row.technicals;
    if (tech && (tech.rsi != null || tech.adx != null || tech.ema20 != null || tech.macd != null)) {
      return 'AVAILABLE';
    }
    const n = row.candles?.length ?? 0;
    if (n >= 20) return 'AVAILABLE';
    if (n > 0) return 'PARTIAL';
    return 'UNAVAILABLE';
  }
  if (capability === 'fundamentals') {
    if (!row.fundamentals || row.fundamentals.kind === 'UNAVAILABLE') return 'UNAVAILABLE';
    return 'AVAILABLE';
  }
  if (capability === 'news') {
    const count = row.news?.headlineCount ?? 0;
    return count > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
  }
  if (capability === 'sentiment') {
    if (row.sentiment != null && typeof row.sentiment.score === 'number') return 'AVAILABLE';
    return 'UNAVAILABLE';
  }
  if (capability === 'derivatives') {
    const d = row.derivatives;
    if (!d) return 'UNAVAILABLE';
    if (d.markPrice != null || d.openInterest != null) return 'AVAILABLE';
    return 'PARTIAL';
  }
  if (capability === 'positioning') {
    if (row.positioning?.status === 'AVAILABLE') return 'AVAILABLE';
    if (row.positioning?.status === 'PARTIAL') return 'PARTIAL';
    return 'UNAVAILABLE';
  }
  if (capability === 'onchain') {
    if (row.onchain?.status === 'AVAILABLE') return 'AVAILABLE';
    if (row.onchain?.status === 'PARTIAL') return 'PARTIAL';
    return 'UNAVAILABLE';
  }
  if (capability === 'social') {
    if (row.social?.status === 'AVAILABLE') return 'AVAILABLE';
    if (row.social?.status === 'PARTIAL') return 'PARTIAL';
    return 'UNAVAILABLE';
  }
  if (capability === 'fno') return 'UNAVAILABLE';
  if (
    capability === 'sector' ||
    capability === 'catalyst' ||
    capability === 'ml' ||
    capability === 'historicalAnalogues' ||
    capability === 'bullRun' ||
    capability === 'relationships' ||
    capability === 'globalImpact'
  ) {
    return 'UNAVAILABLE';
  }
  if (capability === 'benchmark') {
    return row.quote && row.quote.price > 0 ? 'PARTIAL' : 'UNAVAILABLE';
  }
  return 'UNAVAILABLE';
}

function rollupStatus(input: {
  eligible: number;
  available: number;
  partial: number;
  unavailable: number;
  pending: number;
  na: number;
}): SnapshotCoverageStatus {
  if (input.eligible === 0 && input.na > 0) return 'N/A';
  if (input.pending > 0 && input.available === 0 && input.partial === 0) return 'PENDING';
  if (input.available === input.eligible && input.eligible > 0) return 'AVAILABLE';
  if (input.available + input.partial > 0 && input.unavailable + input.pending > 0)
    return 'PARTIAL';
  if (input.available + input.partial > 0)
    return input.partial > 0 && input.available === 0 ? 'PARTIAL' : 'AVAILABLE';
  return 'UNAVAILABLE';
}

function buildMacroCoverage(
  snapshot: Pick<BatchDataSnapshot, 'macro'>,
  group: SnapshotCoverageGroup,
): SnapshotCapabilityCoverageItem {
  const requested = snapshot.macro?.requestedCount ?? 3;
  const n = snapshot.macro?.series?.length ?? 0;
  const available = n > 0 && n >= requested ? 1 : 0;
  const partial = n > 0 && n < requested ? 1 : 0;
  const unavailable = n === 0 ? 1 : 0;
  const status: SnapshotCoverageStatus =
    available === 1 ? 'AVAILABLE' : partial === 1 ? 'PARTIAL' : 'UNAVAILABLE';
  return {
    capability: 'macro',
    group,
    status,
    eligible: 1,
    available,
    partial,
    unavailable,
    pending: 0,
    na: 0,
    coveragePct: (available + partial) / 1,
    reason:
      status === 'UNAVAILABLE'
        ? (snapshot.macro?.reasonCode ?? 'NOT_IN_SNAPSHOT')
        : status === 'PARTIAL'
          ? 'MACRO_SERIES_PARTIAL'
          : undefined,
  };
}

export function buildSnapshotCapabilityCoverage(
  snapshot: Pick<BatchDataSnapshot, 'instruments' | 'coverage' | 'frozen' | 'macro'>,
): SnapshotCapabilityCoverageItem[] {
  const rows = snapshot.instruments ?? [];
  const membership = snapshot.coverage?.eligible ?? rows.length;

  return SNAPSHOT_COVERAGE_CAPABILITIES.map(({ capability, group }) => {
    if (capability === 'macro') {
      return buildMacroCoverage(snapshot, group);
    }
    let available = 0;
    let partial = 0;
    let unavailable = 0;
    let pending = 0;
    let na = 0;
    let eligible = 0;
    const naReasons = new Set<string>();
    const missingReasons = new Set<string>();

    for (const row of rows) {
      const naReason = notApplicableReason(capability, row);
      if (naReason) {
        na += 1;
        naReasons.add(naReason);
        continue;
      }
      eligible += 1;
      const status = rowStatus(capability, row);
      if (status === 'AVAILABLE') available += 1;
      else if (status === 'PARTIAL') partial += 1;
      else if (status === 'PENDING') pending += 1;
      else {
        unavailable += 1;
        missingReasons.add('NOT_IN_SNAPSHOT');
      }
    }

    if (rows.length === 0 && membership > 0) {
      pending = membership;
      eligible = membership;
    }

    if (eligible === 0) {
      return {
        capability,
        group,
        status: 'N/A' as const,
        eligible: 0,
        available: 0,
        partial: 0,
        unavailable: 0,
        pending: 0,
        na: Math.max(na, membership),
        coveragePct: null,
        reason: [...naReasons][0] ?? 'NOT_APPLICABLE',
      };
    }

    const status = rollupStatus({ eligible, available, partial, unavailable, pending, na });
    return {
      capability,
      group,
      status,
      eligible,
      available,
      partial,
      unavailable,
      pending,
      na,
      coveragePct: eligible > 0 ? (available + partial) / eligible : null,
      reason:
        status === 'N/A'
          ? [...naReasons][0]
          : status === 'UNAVAILABLE' || status === 'PARTIAL'
            ? [...missingReasons][0]
            : undefined,
    };
  });
}
