'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.withRetry = withRetry;
async function withRetry(fn, options) {
  const backoff = options.backoff ?? 2;
  let delay = options.delayMs;
  let lastError;
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
//# sourceMappingURL=retry.js.map
