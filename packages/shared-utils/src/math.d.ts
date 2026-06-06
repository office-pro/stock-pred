/** Round to 2 decimals (price precision used across the platform). */
export declare function round2(value: number): number;
export declare function mean(values: number[]): number;
/** Population standard deviation. */
export declare function std(values: number[]): number;
export declare function pctChange(from: number, to: number): number;
/** Last finite value of a series, or null. */
export declare function lastFinite(values: number[]): number | null;
export declare function clamp(value: number, min: number, max: number): number;
//# sourceMappingURL=math.d.ts.map