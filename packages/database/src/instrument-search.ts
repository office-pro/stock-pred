import type {
  AssetClass,
  CanonicalInstrumentSearchResult,
  InstrumentRef,
} from '@stockpred/shared-types';
import { loadEquityMaster } from './listings';
import {
  resolveGatedCanonicalUniverse,
  type CanonicalUniverseId,
  type CanonicalUniverseInstrument,
} from './canonical-universe-registry';

const GLOBAL_IDS: CanonicalUniverseId[] = [
  'US_SP500',
  'US_ALL',
  'CRYPTO_SPOT_ALL',
  'CRYPTO_FUTURES_ALL',
  'COMMODITY_ALL',
  'MCX_FUTURES_ALL',
  'CME_FUTURES_ALL',
];

function identityKey(ref: InstrumentRef): string {
  const month = String(ref.contractMonth ?? ref.expiry ?? '')
    .trim()
    .toUpperCase();
  const contractType = String(ref.contractType ?? '')
    .trim()
    .toUpperCase();
  const id = String(ref.providerAssetId ?? ref.canonicalSymbol ?? ref.symbol)
    .trim()
    .toUpperCase();
  return `${ref.venue}|${ref.assetClass}|${id}|${contractType}|${month}`;
}

function globalIdentity(
  universeId: CanonicalUniverseId,
  row: CanonicalUniverseInstrument,
): InstrumentRef | null {
  if (universeId === 'US_SP500' || universeId === 'US_ALL') {
    return {
      symbol: row.symbol,
      canonicalSymbol: row.symbol,
      assetClass: 'EQUITY',
      venue: row.venue,
      quoteCurrency: 'USD',
    };
  }
  if (universeId === 'CRYPTO_SPOT_ALL' || universeId === 'CRYPTO_ALL') {
    return {
      symbol: row.symbol,
      canonicalSymbol: row.providerAssetId ?? row.canonicalSymbol ?? row.symbol,
      providerAssetId: row.providerAssetId,
      assetClass: 'CRYPTO_SPOT',
      venue: row.venue,
      quoteCurrency: row.quoteCurrency ?? '',
      contractType: row.contractType,
    };
  }
  if (universeId === 'CRYPTO_FUTURES_ALL') {
    return {
      symbol: row.symbol,
      canonicalSymbol: row.providerAssetId ?? row.canonicalSymbol ?? row.symbol,
      providerAssetId: row.providerAssetId,
      assetClass: 'CRYPTO_FUTURE',
      venue: row.venue,
      quoteCurrency: row.quoteCurrency ?? '',
      underlying: row.underlying ?? row.baseAsset,
      contractType: row.contractType,
      contractMonth: row.contractMonth,
      expiry: row.expiry,
      contractMultiplier: row.contractMultiplier,
    };
  }
  if (universeId === 'COMMODITY_ALL') {
    if (!row.quoteCurrency) return null;
    return {
      symbol: row.symbol,
      canonicalSymbol: row.providerAssetId ?? row.canonicalSymbol ?? row.symbol,
      providerAssetId: row.providerAssetId,
      assetClass: 'COMMODITY',
      venue: row.venue,
      quoteCurrency: row.quoteCurrency,
      underlying: row.underlying,
      contractType: 'PRODUCT',
    };
  }
  if (universeId === 'MCX_FUTURES_ALL' || universeId === 'CME_FUTURES_ALL') {
    if (!row.quoteCurrency || (!row.contractMonth && !row.expiry)) return null;
    return {
      symbol: row.symbol,
      canonicalSymbol: row.providerAssetId ?? row.canonicalSymbol ?? row.symbol,
      providerAssetId: row.providerAssetId,
      assetClass: 'COMMODITY_FUTURE',
      venue: row.venue,
      quoteCurrency: row.quoteCurrency,
      underlying: row.underlying,
      expiry: row.expiry,
      contractMonth: row.contractMonth,
      contractMultiplier: row.contractMultiplier,
      contractType: row.contractType,
    };
  }
  return null;
}

/** Search only canonical artifacts. Unknown ticker text never becomes an InstrumentRef. */
export function searchCanonicalInstruments(input: {
  query: string;
  assetClass?: AssetClass;
  venue?: string;
  limit?: number;
}): CanonicalInstrumentSearchResult[] {
  const query = input.query.trim().toUpperCase();
  if (query.length < 2) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const out: CanonicalInstrumentSearchResult[] = [];
  const seen = new Set<string>();

  const push = (instrument: InstrumentRef, name: string, source: string): void => {
    if (input.assetClass && instrument.assetClass !== input.assetClass) return;
    if (input.venue && instrument.venue.toUpperCase() !== input.venue.toUpperCase()) return;
    const key = identityKey(instrument);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      instrument,
      name,
      source,
      identityKey: key,
      eligibilityStatus: 'ELIGIBLE',
    });
  };

  for (const row of loadEquityMaster()) {
    if (out.length >= limit) break;
    if (
      !row.symbol.toUpperCase().includes(query) &&
      !row.name.toUpperCase().includes(query) &&
      !(row.isin ?? '').toUpperCase().includes(query)
    ) {
      continue;
    }
    push(
      {
        symbol: row.symbol,
        canonicalSymbol: row.symbol,
        assetClass: 'EQUITY',
        venue: row.exchange,
        quoteCurrency: 'INR',
      },
      row.name,
      'equity-master.json',
    );
  }

  for (const universeId of GLOBAL_IDS) {
    if (out.length >= limit) break;
    const resolved = resolveGatedCanonicalUniverse(universeId);
    const snapshot = resolved.snapshot;
    if (!resolved.supported || !snapshot) continue;
    for (const row of snapshot.instruments) {
      if (out.length >= limit) break;
      if (
        !row.symbol.toUpperCase().includes(query) &&
        !row.name.toUpperCase().includes(query) &&
        !(row.providerAssetId ?? '').toUpperCase().includes(query) &&
        !(row.canonicalSymbol ?? '').toUpperCase().includes(query)
      ) {
        continue;
      }
      const instrument = globalIdentity(universeId, row);
      if (instrument && instrument.quoteCurrency) {
        push(instrument, row.name, snapshot.source);
      }
    }
  }
  return out;
}

export function canonicalInstrumentExists(ref: InstrumentRef): boolean {
  return searchCanonicalInstruments({
    query: ref.canonicalSymbol ?? ref.symbol,
    assetClass: ref.assetClass,
    venue: ref.venue,
    limit: 50,
  }).some(
    (row) =>
      identityKey(row.instrument) === identityKey(ref) &&
      row.instrument.quoteCurrency === ref.quoteCurrency,
  );
}
