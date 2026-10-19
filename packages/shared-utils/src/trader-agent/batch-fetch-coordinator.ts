/** Hot-path provider timeout for batch hydrate / TI (Stage 2). */
export const BATCH_HOT_PATH_TIMEOUT_MS = 1_500;

export type BatchFetchKind = 'external' | 'internal';

/**
 * Authoritative per-batch requirement dedupe.
 * Process-local in-flight coalescing is nested inside; this Map keeps completed
 * results for the rest of the batch. Not a distributed lock.
 */
export class BatchFetchCoordinator {
  private readonly results = new Map<
    string,
    { ok: true; value: unknown } | { ok: false; error: unknown }
  >();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private frozen = false;
  duplicateRequestsPrevented = 0;
  requestCount = 0;
  retryCount = 0;
  timeoutCount = 0;
  cacheHitCount = 0;
  cacheMissCount = 0;
  postFreezeProviderRequestCount = 0;

  freeze(): void {
    this.frozen = true;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  metrics(): {
    requestCount: number;
    cacheHitCount: number;
    cacheMissCount: number;
    timeoutCount: number;
    retryCount: number;
    duplicateRequestsPrevented: number;
    postFreezeProviderRequestCount: number;
  } {
    return {
      requestCount: this.requestCount,
      cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount,
      timeoutCount: this.timeoutCount,
      retryCount: this.retryCount,
      duplicateRequestsPrevented: this.duplicateRequestsPrevented,
      postFreezeProviderRequestCount: this.postFreezeProviderRequestCount,
    };
  }

  noteRetry(): void {
    this.retryCount += 1;
  }

  noteTimeout(): void {
    this.timeoutCount += 1;
  }

  async resolve<T>(
    key: string,
    work: () => Promise<T>,
    kind: BatchFetchKind = 'external',
  ): Promise<T> {
    const cached = this.results.get(key);
    if (cached) {
      this.cacheHitCount += 1;
      this.duplicateRequestsPrevented += 1;
      if (cached.ok) return cached.value as T;
      throw cached.error;
    }
    if (this.frozen && kind === 'external') {
      this.postFreezeProviderRequestCount += 1;
      throw new Error('POST_FREEZE_EXTERNAL_PROVIDER_HTTP');
    }
    const existing = this.inflight.get(key);
    if (existing) {
      this.duplicateRequestsPrevented += 1;
      return existing as Promise<T>;
    }
    this.cacheMissCount += 1;
    this.requestCount += 1;
    const job = (async () => {
      try {
        const value = await work();
        this.results.set(key, { ok: true, value });
        return value;
      } catch (error) {
        this.results.set(key, { ok: false, error });
        throw error;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job as Promise<T>;
  }
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
