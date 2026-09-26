/**
 * Backend-owned BatchDataReadiness. Denominator = canonical eligible universe.
 * Frontend must not recompute READY / READY_PARTIAL / NOT_READY.
 */

import {
  BATCH_MIN_REQUIRED_COVERAGE_PCT,
  type BatchDataReadiness,
  type BatchDataReadinessReport,
  type BatchInstrumentData,
} from '@stockpred/shared-types';

export function computeBatchDataReadiness(input: {
  instruments: BatchInstrumentData[];
  eligible: number;
  requiredCapabilities: string[];
  minRequiredCoveragePct?: number;
  extraReasons?: string[];
}): BatchDataReadinessReport {
  const eligible = Math.max(0, input.eligible);
  const minRequiredCoveragePct = input.minRequiredCoveragePct ?? BATCH_MIN_REQUIRED_COVERAGE_PCT;
  const reasons = [...(input.extraReasons ?? [])];

  let available = 0;
  let partial = 0;
  let unavailable = 0;
  let failed = 0;
  let pending = 0;
  let marketDataAvailable = 0;
  let historicalAvailable = 0;
  let derivativesAvailable = 0;

  for (const row of input.instruments) {
    if (row.dataStatus === 'AVAILABLE') available += 1;
    else if (row.dataStatus === 'PARTIAL') partial += 1;
    else if (row.dataStatus === 'FAILED') failed += 1;
    else if (row.dataStatus === 'PENDING') pending += 1;
    else unavailable += 1;

    if (row.quote && Number.isFinite(row.quote.price) && row.quote.price > 0) {
      marketDataAvailable += 1;
    }
    if (row.candles && row.candles.length > 0) historicalAvailable += 1;
    if (
      row.derivatives &&
      row.derivatives.openInterest != null &&
      Number.isFinite(row.derivatives.openInterest)
    ) {
      derivativesAvailable += 1;
    }
    if (row.reasonCode && row.dataStatus !== 'AVAILABLE') {
      const msg = `${row.instrumentRef.symbol}:${row.reasonCode}`;
      if (reasons.length < 24 && !reasons.includes(msg)) reasons.push(msg);
    }
  }

  if (eligible === 0) {
    reasons.unshift('MEMBERSHIP_SNAPSHOT_MISSING');
  }

  const processed = available + partial + unavailable + failed;
  const coveragePct = eligible > 0 ? (available / eligible) * 100 : 0;

  let readiness: BatchDataReadiness;
  if (eligible === 0 || coveragePct < minRequiredCoveragePct) {
    readiness = 'NOT_READY';
    if (eligible > 0 && coveragePct < minRequiredCoveragePct) {
      reasons.unshift(
        `BELOW_MIN_REQUIRED_COVERAGE:${coveragePct.toFixed(2)}<${minRequiredCoveragePct}`,
      );
    }
  } else if (partial + unavailable + failed + pending > 0) {
    readiness = 'READY_PARTIAL';
  } else {
    readiness = 'READY';
  }

  return {
    readiness,
    eligible,
    processed,
    available,
    partial,
    unavailable,
    failed,
    pending,
    marketDataAvailable,
    historicalAvailable,
    derivativesAvailable,
    requiredCapabilities: input.requiredCapabilities,
    coveragePct,
    minRequiredCoveragePct,
    reasons,
  };
}
