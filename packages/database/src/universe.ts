import { STOCK_UNIVERSE as EXPANDED } from './universe-expanded';
import type { UniverseStock as ExpandedStock } from './universe-expanded';

export interface UniverseStock {
  symbol: string;
  name: string;
  exchange: ExpandedStock['exchange'];
  sector: string;
  indices: ExpandedStock['indices'];
  /** Reference price used to seed the simulated feed. */
  basePrice: number;
  isin?: string | null;
  bseCode?: string | null;
}

/**
 * Quick-start universe: liquid NSE names only (no generated placeholders).
 * Full listed NSE/BSE comes from `npm run ingest:listings` → equity-master.json.
 */
export const STOCK_UNIVERSE: UniverseStock[] = EXPANDED;
