import type { Candle, PriceLevel, SupportResistance } from '@stockpred/shared-types';
export interface SwingPoint {
    index: number;
    price: number;
}
export interface SwingPoints {
    highs: SwingPoint[];
    lows: SwingPoint[];
}
/** Static S/R: local swing highs/lows with `lookback` bars on each side. */
export declare function findSwingPoints(candles: Candle[], lookback?: number): SwingPoints;
export interface FibonacciLevels {
    high: number;
    low: number;
    levels: {
        ratio: number;
        price: number;
    }[];
}
/** Dynamic S/R: Fibonacci retracement of the high/low range in the window. */
export declare function fibonacciRetracement(candles: Candle[], lookbackBars?: number): FibonacciLevels;
export interface PivotLevels {
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
}
/** Classic floor-trader pivot points from the previous period's OHLC. */
export declare function pivotPoints(prev: {
    high: number;
    low: number;
    close: number;
}): PivotLevels;
export interface VolumeProfileBin {
    price: number;
    volume: number;
}
export interface VolumeProfile {
    bins: VolumeProfileBin[];
    /** Point of control: price bin with the highest traded volume. */
    poc: number;
}
/** Dynamic S/R: volume distribution by price bins. */
export declare function volumeProfile(candles: Candle[], binCount?: number): VolumeProfile;
/** Cluster nearby prices (within tolerancePct) into single levels; strength = touches. */
export declare function clusterLevels(prices: number[], tolerancePct?: number): {
    price: number;
    strength: number;
}[];
export interface SupportResistanceDetail extends SupportResistance {
    levels: PriceLevel[];
}
/**
 * Merge static (swing) and dynamic (fibonacci, pivots, VWAP, volume profile)
 * level sources, cluster them, and split into support/resistance around the
 * latest close. Nearest levels come first in each array.
 */
export declare function computeSupportResistance(candles: Candle[], options?: {
    vwapValue?: number | null;
    maxLevels?: number;
}): SupportResistanceDetail;
//# sourceMappingURL=support-resistance.d.ts.map