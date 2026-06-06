export interface RetryOptions {
    retries: number;
    delayMs: number;
    /** Multiplier applied to the delay after each attempt. */
    backoff?: number;
    onRetry?: (attempt: number, error: unknown) => void;
}
export declare function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
//# sourceMappingURL=retry.d.ts.map