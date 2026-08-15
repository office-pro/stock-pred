/**
 * Universe Configuration System
 *
 * - quick-start: liquid NSE names (~100) for fast local boots
 * - full-universe: official NSE EQ + BSE equity master (ISIN-deduped)
 *
 * Full list is produced by `npm run ingest:listings` into
 * packages/database/data/equity-master.json.
 */
import { STOCK_UNIVERSE as DEFAULT_UNIVERSE } from './universe';
import type { UniverseStock } from './universe';
import { isPlaceholderSymbol, listedToUniverse, loadEquityMaster } from './listings';

export type UniverseMode = 'quick-start' | 'full-universe';

export function getUniverseMode(): UniverseMode {
  return (process.env.STOCK_UNIVERSE_MODE as UniverseMode) || 'full-universe';
}

export function getStockUniverse(mode?: UniverseMode): UniverseStock[] {
  const configMode = mode || getUniverseMode();
  console.log(`[universe-config] Using mode: ${configMode}`);

  if (configMode === 'full-universe') {
    return getFullUniverse();
  }

  return DEFAULT_UNIVERSE.filter((stock) => !isPlaceholderSymbol(stock.symbol));
}

function getFullUniverse(): UniverseStock[] {
  const master = loadEquityMaster();
  if (master.length > 0) {
    console.log(`[universe-config] Loaded official equity master with ${master.length} stocks`);
    return master.map(listedToUniverse);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const completeModule = require('./universe-complete') as {
      STOCK_UNIVERSE_COMPLETE: UniverseStock[];
    };
    const real = completeModule.STOCK_UNIVERSE_COMPLETE.filter(
      (stock) => !isPlaceholderSymbol(stock.symbol),
    );
    console.log(
      `[universe-config] equity-master.json missing; using curated ${real.length} stocks. Run npm run ingest:listings`,
    );
    return real;
  } catch {
    console.warn(
      '[universe-config] Falling back to quick-start universe. Run npm run ingest:listings',
    );
    return DEFAULT_UNIVERSE.filter((stock) => !isPlaceholderSymbol(stock.symbol));
  }
}

export function getUniverseStats(): {
  mode: UniverseMode;
  totalStocks: number;
  sectors: Set<string>;
} {
  const mode = getUniverseMode();
  const universe = getStockUniverse(mode);
  const sectors = new Set(universe.map((s) => s.sector));
  return { mode, totalStocks: universe.length, sectors };
}
