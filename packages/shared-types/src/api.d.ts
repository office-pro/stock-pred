/**
 * Compliance: every analytics payload carries this disclaimer.
 * Predictions are probabilistic. No guarantee of profits.
 */
export declare const DISCLAIMER = "This is not investment advice.";
export interface ApiMeta {
    disclaimer: string;
    timestamp: number;
}
export interface ApiResponse<T> {
    data: T;
    meta: ApiMeta;
}
export declare function withDisclaimer<T>(data: T): ApiResponse<T>;
//# sourceMappingURL=api.d.ts.map