/**
 * PriceSeriesPolicy + SeriesProvenance helpers.
 * No silent raw/adjusted mix; missing adjusted → UNAVAILABLE + reason.
 */

import type {
  PriceSeriesPolicy,
  SeriesProvenance,
  SeriesType,
  UnavailableReasonCode,
} from '@stockpred/shared-types';

export function buildSeriesProvenance(input: {
  source: string;
  provider?: string;
  dataAsOf?: number | string | null;
  seriesType?: SeriesType;
  adjustmentPolicy?: string;
  priceAdjustmentPolicy?: string;
  transformation?: string;
  contractSelectionPolicy?: string;
  rollPolicy?: string;
  fallbackUsed?: boolean;
}): SeriesProvenance {
  return {
    source: input.source,
    provider: input.provider,
    dataAsOf: input.dataAsOf ?? null,
    seriesType: input.seriesType,
    adjustmentPolicy: input.adjustmentPolicy ?? input.priceAdjustmentPolicy,
    priceAdjustmentPolicy: input.priceAdjustmentPolicy ?? input.adjustmentPolicy,
    transformation: input.transformation,
    contractSelectionPolicy: input.contractSelectionPolicy,
    rollPolicy: input.rollPolicy,
    fallbackUsed: input.fallbackUsed ?? false,
  };
}

export function resolvePriceSeriesPolicy(input: {
  requested: 'RAW' | 'ADJUSTED';
  available: 'RAW' | 'ADJUSTED' | 'BOTH' | 'NONE';
  source: string;
  appliedAt?: number | string | null;
}): {
  ok: boolean;
  policy?: PriceSeriesPolicy;
  reasonCode?: UnavailableReasonCode;
  detail?: string;
} {
  if (input.available === 'NONE') {
    return { ok: false, reasonCode: 'NO_HISTORY', detail: 'no_price_series' };
  }
  if (input.requested === 'ADJUSTED' && input.available === 'RAW') {
    return {
      ok: false,
      reasonCode: 'INSUFFICIENT_HISTORY',
      detail: 'adjusted_history_unavailable_raw_not_substituted',
    };
  }
  if (input.requested === 'RAW' && input.available === 'ADJUSTED') {
    return {
      ok: false,
      reasonCode: 'INVALID_DATA',
      detail: 'raw_requested_adjusted_only_no_silent_mix',
    };
  }
  return {
    ok: true,
    policy: {
      adjustmentMode: input.requested,
      source: input.source,
      appliedAt: input.appliedAt ?? null,
    },
  };
}

/** Benchmark: non-NSE must not silently use NIFTY. */
export function resolveBenchmarkSymbol(input: {
  venue: string;
  assetClass?: string;
  preferred?: string | null;
}): { benchmark: string | null; reasonCode?: UnavailableReasonCode } {
  const venue = String(input.venue ?? '')
    .trim()
    .toUpperCase();
  if (input.preferred) {
    return { benchmark: input.preferred.toUpperCase() };
  }
  if (venue === 'NSE' || venue === 'BSE') {
    return { benchmark: 'NIFTY' };
  }
  return { benchmark: null, reasonCode: 'NO_BENCHMARK' };
}

/** No silent USD↔INR return conversion. */
export function buildCurrencyContext(input: {
  baseCurrency: string;
  quoteCurrency: string;
  fxSource?: string | null;
  fxDataAsOf?: number | string | null;
}): import('@stockpred/shared-types').CurrencyContext {
  const same = input.baseCurrency.trim().toUpperCase() === input.quoteCurrency.trim().toUpperCase();
  return {
    baseCurrency: input.baseCurrency.toUpperCase(),
    quoteCurrency: input.quoteCurrency.toUpperCase(),
    fxSource: same ? null : (input.fxSource ?? null),
    fxDataAsOf: same ? null : (input.fxDataAsOf ?? null),
    conversionPolicy: same ? 'NONE' : input.fxSource ? 'EXPLICIT_FX' : 'FORBIDDEN_SILENT',
  };
}
