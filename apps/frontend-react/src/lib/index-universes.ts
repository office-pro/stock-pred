import baskets from './index-universes.json';

export type IndexUniverseId = 'nifty50' | 'nifty100' | 'nifty500' | 'all';

export const INDEX_UNIVERSE_OPTIONS: { id: IndexUniverseId; label: string }[] = [
  { id: 'all', label: 'All listed' },
  { id: 'nifty50', label: 'Nifty 50' },
  { id: 'nifty100', label: 'Nifty 100' },
  { id: 'nifty500', label: 'Nifty 500' },
];

const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['TMPV', 'TATAMOTORS', 'TMCV'],
  ['ETERNAL', 'ZOMATO'],
  ['LTM', 'LTIM', 'LTI'],
  ['UNITDSPR', 'MCDOWELL-N'],
  ['MOTHERSON', 'MOTHERSUMI'],
  ['ESCORTS', 'ESCORT'],
  ['FORTIS', 'FORTISHEALTH'],
  ['IOC', 'IOCL'],
  ['CANBK', 'CANBANK'],
  ['INDUSINDBK', 'INDUSIND'],
  ['AUROPHARMA', 'AUROBINDO'],
  ['LUPIN', 'LUPIINDIA'],
  ['DIVISLAB', 'DIVI'],
  ['CHOLAFIN', 'CCINDIA'],
  ['GMRAIRPORT', 'GMRINFRA'],
];

const ALIASES: Record<string, readonly string[]> = {};
for (const group of ALIAS_GROUPS) {
  for (const symbol of group) {
    ALIASES[symbol] = group;
  }
}

function asSet(symbols: string[]): Set<string> {
  const out = new Set<string>();
  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    out.add(upper);
    for (const alias of ALIASES[upper] ?? []) {
      out.add(alias);
    }
  }
  return out;
}

const NIFTY_50 = asSet(baskets.nifty50);
const NIFTY_100 = asSet(baskets.nifty100);
const NIFTY_500 = asSet(baskets.nifty500);

export const INDEX_BASKET_SIZE: Record<Exclude<IndexUniverseId, 'all'>, number> = {
  nifty50: baskets.nifty50.length,
  nifty100: baskets.nifty100.length,
  nifty500: baskets.nifty500.length,
};

export function inIndexUniverse(symbol: string, universe: IndexUniverseId): boolean {
  if (universe === 'all') return true;
  const key = symbol.trim().toUpperCase();
  if (universe === 'nifty50') return NIFTY_50.has(key);
  if (universe === 'nifty100') return NIFTY_100.has(key);
  return NIFTY_500.has(key);
}

/** Tightest Nifty chip for a row: 50, else 100, else 500. */
export function niftyChip(symbol: string): 'Nifty 50' | 'Nifty 100' | 'Nifty 500' | null {
  const key = symbol.trim().toUpperCase();
  if (NIFTY_50.has(key)) return 'Nifty 50';
  if (NIFTY_100.has(key)) return 'Nifty 100';
  if (NIFTY_500.has(key)) return 'Nifty 500';
  return null;
}
