/**
 * Universe Manager for Intelligence Batch B1.
 * Canonical baskets shared with FE index-universes.json (copied under data/).
 * NIFTY150 = first 150 of NIFTY500 list order (documented subset).
 */

import type { IntelligenceUniverseId } from '@stockpred/shared-types';
import baskets from './data/index-universes.json';

const NIFTY50 = (baskets.nifty50 as string[]).map((s) => s.toUpperCase());
const NIFTY100 = (baskets.nifty100 as string[]).map((s) => s.toUpperCase());
const NIFTY500 = (baskets.nifty500 as string[]).map((s) => s.toUpperCase());
/** Documented subset: first 150 symbols of NIFTY500 basket order. */
const NIFTY150 = NIFTY500.slice(0, 150);

export const DEFAULT_ALL_UNIVERSE_LIMIT = 500;

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
 * ALL requires `allSymbols` (eligible MDS cache); CUSTOM requires `customSymbols`.
 */
export function resolveIntelligenceUniverse(input: {
  universe: IntelligenceUniverseId;
  customSymbols?: string[];
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
    case 'SINGLE_STOCK': {
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
    case 'ALL': {
      const limit = Math.max(1, Math.min(input.allLimit ?? DEFAULT_ALL_UNIVERSE_LIMIT, 5000));
      const all = normalizeSymbols(input.allSymbols ?? []).slice(0, limit);
      if (all.length === 0) {
        throw new Error('ALL universe requires eligible market symbols');
      }
      return all;
    }
    default: {
      const _exhaustive: never = input.universe;
      throw new Error(`Unsupported universe: ${String(_exhaustive)}`);
    }
  }
}

export function intelligenceUniverseSizes(): Record<
  Exclude<IntelligenceUniverseId, 'ALL' | 'CUSTOM' | 'SECTOR' | 'SINGLE_STOCK'>,
  number
> {
  return {
    NIFTY50: NIFTY50.length,
    NIFTY100: NIFTY100.length,
    NIFTY150: NIFTY150.length,
    NIFTY500: NIFTY500.length,
  };
}
