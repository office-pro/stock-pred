import { withRetry } from './retry';

describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { retries: 3, delayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries failures then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok');
    const onRetry = jest.fn();
    await expect(withRetry(fn, { retries: 3, delayMs: 1, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always'));
    await expect(withRetry(fn, { retries: 2, delayMs: 1 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
