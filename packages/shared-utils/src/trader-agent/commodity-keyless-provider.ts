/**
 * F4 — approved commodity *product* provider: keyless Yahoo + EIA bulk.
 * Twelve Data commodities stay TWELVE_DATA_REQUIRES_GROW (no TD commodity endpoints).
 * COMMODITY (product) ≠ COMMODITY_FUTURE ≠ MCX ≠ CME.
 */
import type { InstrumentRef } from '@stockpred/shared-types';
import { TWELVE_DATA_REQUIRES_GROW } from './twelve-data-client';

export const COMMODITY_PROVIDER = 'keyless-commodity+eia-bulk';
export const COMMODITY_FALLBACK_REASON = TWELVE_DATA_REQUIRES_GROW;

export interface CommodityKeylessSeries {
  yahoo?: string;
  eiaSeriesId?: string;
}

/** Product proxies (Yahoo front-month / EIA spot). Not MCX/CME contract months. */
export const COMMODITY_KEYLESS_MAP: Record<string, CommodityKeylessSeries> = {
  WTI: { yahoo: 'CL=F', eiaSeriesId: 'PET.RWTC.D' },
  BRENT: { yahoo: 'BZ=F', eiaSeriesId: 'PET.RBRTE.D' },
  NG: { yahoo: 'NG=F', eiaSeriesId: 'NG.RNGWHHD.D' },
  NATURAL_GAS: { yahoo: 'NG=F', eiaSeriesId: 'NG.RNGWHHD.D' },
  COPPER: { yahoo: 'HG=F' },
  WHEAT: { yahoo: 'ZW=F' },
  CORN: { yahoo: 'ZC=F' },
  COTTON: { yahoo: 'CT=F' },
  SUGAR: { yahoo: 'SB=F' },
  COFFEE: { yahoo: 'KC=F' },
};

export function commodityLookupKeys(ref: InstrumentRef): string[] {
  return [ref.providerAssetId, ref.canonicalSymbol, ref.symbol, ref.underlying]
    .map((value) =>
      String(value ?? '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
}

export function lookupCommodityKeylessSeries(ref: InstrumentRef): CommodityKeylessSeries | null {
  for (const key of commodityLookupKeys(ref)) {
    const hit = COMMODITY_KEYLESS_MAP[key];
    if (hit) return hit;
  }
  return null;
}

export function commodityProductIdentityError(ref: InstrumentRef): string | null {
  const venue = String(ref.venue ?? '')
    .trim()
    .toUpperCase();
  if (ref.assetClass !== 'COMMODITY') {
    return 'COMMODITY_ALL hydrates products only — not futures contracts';
  }
  if (venue === 'MCX' || venue === 'CME') {
    return 'MCX/CME venues are not commodity products';
  }
  if (ref.contractType && ref.contractType !== 'PRODUCT') {
    return `Commodity product cannot use contractType ${ref.contractType}`;
  }
  if (ref.contractMonth) {
    return 'Commodity products do not carry contract months (not MCX/CME)';
  }
  return null;
}
