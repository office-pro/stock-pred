/**
 * Universe Manager for Intelligence Batch B1.
 * Canonical baskets shared with FE index-universes.json (copied under data/).
 * NIFTY150 = first 150 of NIFTY500 list order (documented subset).
 *
 * NSE_ALL / ALL membership MUST come from Canonical Universe Registry
 * (equity-master / NSE listings) — never MDS cache symbols.
 */

import { createHash } from 'crypto';
import type { IntelligenceUniverseId } from '@stockpred/shared-types';
import baskets from './data/index-universes.json';

const NIFTY50 = (baskets.nifty50 as string[]).map((s) => s.toUpperCase());
const NIFTY100 = (baskets.nifty100 as string[]).map((s) => s.toUpperCase());
const NIFTY500 = (baskets.nifty500 as string[]).map((s) => s.toUpperCase());
/** Documented subset: first 150 symbols of NIFTY500 basket order. */
const NIFTY150 = NIFTY500.slice(0, 150);

export type CanonicalNiftyUniverseId = 'NIFTY50' | 'NIFTY100' | 'NIFTY150' | 'NIFTY500';

const NIFTY_BY_ID: Record<CanonicalNiftyUniverseId, string[]> = {
  NIFTY50,
  NIFTY100,
  NIFTY150,
  NIFTY500,
};

export function canonicalNiftySnapshot(universe: CanonicalNiftyUniverseId): {
  universeId: CanonicalNiftyUniverseId;
  symbols: string[];
  version: string;
  membershipSource: string;
  validationStatus: 'COMPLETE';
} {
  const symbols = [...NIFTY_BY_ID[universe]];
  const hash = createHash('sha256')
    .update(JSON.stringify({ universe, symbols }))
    .digest('hex')
    .slice(0, 16);
  return {
    universeId: universe,
    symbols,
    version: `${universe.toLowerCase()}-${hash}`,
    membershipSource: 'index-universes.json',
    validationStatus: 'COMPLETE',
  };
}

/** Soft default when callers pass allLimit — not a membership ceiling for NSE_ALL. */
export const DEFAULT_ALL_UNIVERSE_LIMIT = 5000;

/** Universes that require a validated canonical artifact (not MDS, not model knowledge). */
export const GATED_CANONICAL_UNIVERSES = new Set<IntelligenceUniverseId>([
  'US_SP500',
  'US_ALL',
  'CRYPTO_ALL',
  'CRYPTO_SPOT_ALL',
  'CRYPTO_FUTURES_ALL',
  'COMMODITY_ALL',
  'FUTURES_ALL',
  'MCX_FUTURES_ALL',
  'CME_FUTURES_ALL',
  'FOREX_ALL',
]);

export function normalizeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const s = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Resolve universe → ordered symbol list.
 * ALL / NSE_ALL require `allSymbols` from Canonical Universe Registry (eligible membership).
 * MDS cache must never be passed as allSymbols.
 * CUSTOM / US_* / CRYPTO_* require `customSymbols`.
 * Gated multi-asset universes without a canonical artifact throw UNSUPPORTED_UNIVERSE.
 */
export function resolveIntelligenceUniverse(input: {
  universe: IntelligenceUniverseId;
  customSymbols?: string[];
  /** Canonical eligible membership symbols — NEVER MDS cache keys. */
  allSymbols?: string[];
  allLimit?: number;
  /** SECTOR universe: symbols already filtered by sector membership. */
  sectorSymbols?: string[];
}): string[] {
  switch (input.universe) {
    case 'NIFTY50':
      return [...NIFTY50];
    case 'NIFTY100':
      return [...NIFTY100];
    case 'NIFTY150':
      return [...NIFTY150];
    case 'NIFTY500':
      return [...NIFTY500];
    case 'CUSTOM':
    case 'SINGLE_STOCK':
    case 'US_CUSTOM':
    case 'CRYPTO_CUSTOM':
    case 'COMMODITIES_CUSTOM':
    case 'FUTURES_CUSTOM': {
      const custom = normalizeSymbols(input.customSymbols ?? []);
      if (custom.length === 0) {
        throw new Error(`${input.universe} universe requires a non-empty symbols list`);
      }
      if (input.universe === 'SINGLE_STOCK' && custom.length !== 1) {
        throw new Error('SINGLE_STOCK universe requires exactly one symbol');
      }
      return custom;
    }
    case 'SECTOR': {
      const sectorSyms = normalizeSymbols(input.sectorSymbols ?? input.customSymbols ?? []);
      if (sectorSyms.length === 0) {
        throw new Error('SECTOR universe requires sector member symbols');
      }
      return sectorSyms;
    }
    case 'ALL':
    case 'NSE_ALL': {
      const all = normalizeSymbols(input.allSymbols ?? []);
      if (all.length === 0) {
        throw new Error(
          `${input.universe} requires canonical universe membership (equity-master / NSE listings) — MDS cache is not a membership source`,
        );
      }
      return all;
    }
    case 'US_SP500':
    case 'US_ALL':
    case 'CRYPTO_ALL':
    case 'CRYPTO_SPOT_ALL':
    case 'CRYPTO_FUTURES_ALL':
    case 'COMMODITY_ALL':
    case 'MCX_FUTURES_ALL':
    case 'CME_FUTURES_ALL':
    case 'FOREX_ALL': {
      const all = normalizeSymbols(input.allSymbols ?? []);
      if (all.length === 0) {
        throw new Error(
          `UNSUPPORTED_UNIVERSE:${input.universe} — approved versioned canonical artifact required`,
        );
      }
      return all;
    }
    case 'FUTURES_ALL':
      throw new Error(
        'UNSUPPORTED_UNIVERSE:FUTURES_ALL — use CRYPTO_FUTURES_ALL, MCX_FUTURES_ALL, or CME_FUTURES_ALL',
      );
    default: {
      const _exhaustive: never = input.universe;
      throw new Error(`Unsupported universe: ${String(_exhaustive)}`);
    }
  }
}

export function intelligenceUniverseSizes(): Record<
  Exclude<
    IntelligenceUniverseId,
    | 'ALL'
    | 'NSE_ALL'
    | 'US_SP500'
    | 'US_ALL'
    | 'CRYPTO_ALL'
    | 'CRYPTO_SPOT_ALL'
    | 'CRYPTO_FUTURES_ALL'
    | 'COMMODITY_ALL'
    | 'FUTURES_ALL'
    | 'MCX_FUTURES_ALL'
    | 'CME_FUTURES_ALL'
    | 'FOREX_ALL'
    | 'CUSTOM'
    | 'SECTOR'
    | 'SINGLE_STOCK'
    | 'US_CUSTOM'
    | 'CRYPTO_CUSTOM'
    | 'COMMODITIES_CUSTOM'
    | 'FUTURES_CUSTOM'
  >,
  number
> {
  return {
    NIFTY50: NIFTY50.length,
    NIFTY100: NIFTY100.length,
    NIFTY150: NIFTY150.length,
    NIFTY500: NIFTY500.length,
  };
}
