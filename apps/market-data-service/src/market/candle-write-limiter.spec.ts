import { CandleWriteLimiter, isPrismaPoolPressureError } from './candle-write-limiter';

describe('CandleWriteLimiter', () => {
  it('bounds concurrent work to maxConcurrent', async () => {
    const limiter = new CandleWriteLimiter(2);
    let active = 0;
    let peak = 0;

    const job = () =>
      limiter.run('saveHistory', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
      });

    await Promise.all([job(), job(), job(), job(), job()]);

    expect(peak).toBeLessThanOrEqual(2);
    expect(limiter.getMetrics().candleWriteCompleted).toBe(5);
    expect(limiter.getMetrics().candleWriteActive).toBe(0);
    expect(limiter.getMetrics().candleWriteQueueDepth).toBe(0);
  });

  it('retries pool-pressure errors with backoff then succeeds', async () => {
    const limiter = new CandleWriteLimiter(1);
    let attempts = 0;

    await limiter.run('saveToday', async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error(
          'Timed out fetching a new connection from the connection pool. (Current connection pool timeout: 10, connection limit: 9)',
        );
      }
    });

    expect(attempts).toBe(2);
    expect(limiter.getMetrics().candleWriteCompleted).toBe(1);
    expect(limiter.getMetrics().candleWriteFailed).toBe(0);
  });

  it('fails after exhausting pool-pressure retries', async () => {
    const limiter = new CandleWriteLimiter(1);
    let attempts = 0;

    await expect(
      limiter.run('saveHistory', async () => {
        attempts += 1;
        throw new Error('Timed out fetching a new connection from the connection pool');
      }),
    ).rejects.toThrow(/Timed out fetching/);

    expect(attempts).toBe(4); // 1 initial + 3 backoffs
    expect(limiter.getMetrics().candleWriteFailed).toBe(1);
    expect(limiter.getMetrics().candleWriteCompleted).toBe(0);
  });

  it('does not retry non-pool errors', async () => {
    const limiter = new CandleWriteLimiter(1);
    let attempts = 0;

    await expect(
      limiter.run('saveToday', async () => {
        attempts += 1;
        throw new Error('unique constraint');
      }),
    ).rejects.toThrow(/unique constraint/);

    expect(attempts).toBe(1);
    expect(limiter.getMetrics().candleWriteFailed).toBe(1);
  });
});

describe('isPrismaPoolPressureError', () => {
  it('detects known pool timeout messages', () => {
    expect(
      isPrismaPoolPressureError(
        new Error('Timed out fetching a new connection from the connection pool'),
      ),
    ).toBe(true);
    expect(isPrismaPoolPressureError(new Error('unique constraint'))).toBe(false);
  });
});
