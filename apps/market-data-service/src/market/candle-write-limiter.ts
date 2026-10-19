/**
 * Bounds concurrent Prisma candle persistence so Yahoo fetch concurrency
 * (e.g. bootstrap ×5) does not become unbounded DB write concurrency.
 */

const DEFAULT_MAX_CONCURRENT = 2;
const BACKOFF_MS = [500, 1000, 2000] as const;

export type CandleWriteOp = 'saveHistory' | 'saveToday';

export type CandleWriteMetricsSnapshot = {
  candleWriteQueueDepth: number;
  candleWriteActive: number;
  candleWriteCompleted: number;
  candleWriteFailed: number;
};

export type CandleWriteLimiterHooks = {
  onSuccess?: (op: CandleWriteOp) => void;
  onPoolPressureFailure?: (op: CandleWriteOp, error: unknown) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPrismaPoolPressureError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? '').toLowerCase();
  return (
    msg.includes('timed out fetching a new connection') ||
    msg.includes('connection pool') ||
    msg.includes('pool timeout') ||
    msg.includes('too many connections')
  );
}

export class CandleWriteLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private completed = 0;
  private failed = 0;

  constructor(
    private readonly maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
    private readonly hooks: CandleWriteLimiterHooks = {},
  ) {
    if (maxConcurrent < 1) {
      throw new Error('CandleWriteLimiter maxConcurrent must be >= 1');
    }
  }

  getMetrics(): CandleWriteMetricsSnapshot {
    return {
      candleWriteQueueDepth: this.waiters.length,
      candleWriteActive: this.active,
      candleWriteCompleted: this.completed,
      candleWriteFailed: this.failed,
    };
  }

  async run<T>(op: CandleWriteOp, work: () => Promise<T>): Promise<T> {
    const waitStarted = Date.now();
    await this.acquire();
    const waitMs = Date.now() - waitStarted;
    const runStarted = Date.now();
    let attempt = 0;

    try {
      for (;;) {
        attempt += 1;
        try {
          const result = await work();
          this.completed += 1;
          this.hooks.onSuccess?.(op);
          const m = this.getMetrics();
          console.log(
            `[CANDLE-CACHE] write_ok op=${op} attempt=${attempt} waitMs=${waitMs} ` +
              `durationMs=${Date.now() - runStarted} active=${m.candleWriteActive} ` +
              `queueDepth=${m.candleWriteQueueDepth} completed=${m.candleWriteCompleted} ` +
              `failed=${m.candleWriteFailed}`,
          );
          return result;
        } catch (error) {
          const poolPressure = isPrismaPoolPressureError(error);
          const backoffMs = BACKOFF_MS[attempt - 1];
          if (poolPressure && backoffMs != null) {
            console.warn(
              `[CANDLE-CACHE] write_retry op=${op} attempt=${attempt} backoffMs=${backoffMs} ` +
                `reason=POOL_PRESSURE error=${(error as Error).message}`,
            );
            await sleep(backoffMs);
            continue;
          }
          this.failed += 1;
          if (poolPressure) {
            this.hooks.onPoolPressureFailure?.(op, error);
          }
          const m = this.getMetrics();
          console.warn(
            `[CANDLE-CACHE] write_failed op=${op} attempt=${attempt} waitMs=${waitMs} ` +
              `durationMs=${Date.now() - runStarted} active=${m.candleWriteActive} ` +
              `queueDepth=${m.candleWriteQueueDepth} completed=${m.candleWriteCompleted} ` +
              `failed=${m.candleWriteFailed} error=${(error as Error).message}`,
          );
          throw error;
        }
      }
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
