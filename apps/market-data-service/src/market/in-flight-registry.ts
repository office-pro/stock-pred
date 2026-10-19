/**
 * Process-local in-flight request dedupe (Stage 1).
 * N callers for the same key share one Promise. This is not a distributed lock
 * and is not the batch-level BatchFetchCoordinator (Stage 2).
 */
export class InFlightRequestRegistry {
  private readonly inflight = new Map<string, Promise<unknown>>();
  duplicatePrevented = 0;

  coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.duplicatePrevented += 1;
      return existing as Promise<T>;
    }
    const job = Promise.resolve()
      .then(work)
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, job);
    return job as Promise<T>;
  }
}
