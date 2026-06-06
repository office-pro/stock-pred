export interface RetryOptions {
  retries: number;
  delayMs: number;
  /** Multiplier applied to the delay after each attempt. */
  backoff?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const backoff = options.backoff ?? 2;
  let delay = options.delayMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt > options.retries) break;
      options.onRetry?.(attempt, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= backoff;
    }
  }
  throw lastError;
}
