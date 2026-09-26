import { BatchFetchCoordinator } from './batch-fetch-coordinator';

describe('BatchFetchCoordinator', () => {
  it('N callers for the same requirement share one fetch', async () => {
    const coord = new BatchFetchCoordinator();
    let runs = 0;
    const work = (): Promise<string> =>
      new Promise((resolve) => {
        runs += 1;
        setTimeout(() => resolve('nifty'), 10);
      });
    const [a, b, c] = await Promise.all([
      coord.resolve('NIFTY_50:1D:benchmark', work),
      coord.resolve('NIFTY_50:1D:benchmark', work),
      coord.resolve('NIFTY_50:1D:benchmark', work),
    ]);
    expect([a, b, c]).toEqual(['nifty', 'nifty', 'nifty']);
    expect(runs).toBe(1);
    expect(coord.duplicateRequestsPrevented).toBe(2);
    expect(coord.requestCount).toBe(1);
  });

  it('reuses the completed result later in the same batch', async () => {
    const coord = new BatchFetchCoordinator();
    let runs = 0;
    await coord.resolve('MACRO:bls', async () => {
      runs += 1;
      return 1;
    });
    await coord.resolve('MACRO:bls', async () => {
      runs += 1;
      return 2;
    });
    expect(runs).toBe(1);
  });

  it('after freeze, a new external requirement is counted and rejected', async () => {
    const coord = new BatchFetchCoordinator();
    await coord.resolve('BTCUSDT:1D:history', async () => 'ok');
    coord.freeze();
    await expect(coord.resolve('ETHUSDT:1D:history', async () => 'nope')).rejects.toThrow(
      'POST_FREEZE_EXTERNAL_PROVIDER_HTTP',
    );
    expect(coord.postFreezeProviderRequestCount).toBe(1);
    await expect(coord.resolve('BTCUSDT:1D:history', async () => 'again')).resolves.toBe('ok');
    expect(coord.postFreezeProviderRequestCount).toBe(1);
  });
});
