/**
 * Universe Configuration System
 *
 * Allows switching between:
 * - Quick-start mode (33 stocks for testing)
 * - Full universe mode (all NSE/BSE stocks)
 *
 * Does NOT break existing code - backward compatible via env vars
 */

import { STOCK_UNIVERSE as DEFAULT_UNIVERSE } from './universe';
import type { UniverseStock } from './universe';

export type UniverseMode = 'quick-start' | 'full-universe';

/**
 * Get the universe based on env config
 * Defaults to 'quick-start' for backward compatibility
 */
export function getStockUniverse(mode?: UniverseMode): UniverseStock[] {
  const configMode = mode || (process.env.STOCK_UNIVERSE_MODE as UniverseMode) || 'quick-start';

  console.log(`[universe-config] Using mode: ${configMode}`);

  if (configMode === 'full-universe') {
    return getFullUniverse();
  }

  return DEFAULT_UNIVERSE;
}

/**
 * Get full universe (all NSE/BSE stocks)
 * Loads from expanded universe file if available
 */
function getFullUniverse(): UniverseStock[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expanded: { STOCK_UNIVERSE: UniverseStock[] } = require('./universe-expanded');
    console.log(
      `[universe-config] Loaded full universe with ${expanded.STOCK_UNIVERSE.length} stocks`,
    );
    return expanded.STOCK_UNIVERSE;
  } catch {
    console.warn(
      `[universe-config] universe-expanded.ts not found. Run: npx ts-node scripts/fetch-all-stocks.ts`,
    );
    return DEFAULT_UNIVERSE; // Fallback to quick-start
  }
}

/**
 * Get universe stats
 */
export function getUniverseStats(): {
  mode: UniverseMode;
  totalStocks: number;
  sectors: Set<string>;
} {
  const mode = (process.env.STOCK_UNIVERSE_MODE as UniverseMode) || 'quick-start';
  const universe = getStockUniverse(mode);
  const sectors = new Set(universe.map((s) => s.sector));

  return {
    mode,
    totalStocks: universe.length,
    sectors,
  };
}

/**
 * Environment variable usage:
 *
 * STOCK_UNIVERSE_MODE=quick-start    # Default (33 stocks, fast)
 * STOCK_UNIVERSE_MODE=full-universe  # All NSE/BSE stocks (~2000+)
 *
 * Example:
 *   STOCK_UNIVERSE_MODE=full-universe npm run prisma:seed
 *   STOCK_UNIVERSE_MODE=full-universe npm run start:all
 */
