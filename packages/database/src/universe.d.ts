import { Exchange, MarketIndex } from '@stockpred/shared-types';
export interface UniverseStock {
    symbol: string;
    name: string;
    exchange: Exchange;
    sector: string;
    indices: MarketIndex[];
    /** Reference price used to seed the simulated feed. */
    basePrice: number;
}
/**
 * Curated NSE universe used by the seed and the simulated market feed.
 * Base prices are indicative reference values, not live quotes.
 */
export declare const STOCK_UNIVERSE: UniverseStock[];
//# sourceMappingURL=universe.d.ts.map