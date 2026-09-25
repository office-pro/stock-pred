import { InFlightRequestRegistry } from './in-flight-registry';

describe('InFlightRequestRegistry', () => {
  it('N callers for the same key share one in-flight work item', async () => {
    const registry = new InFlightRequestRegistry();
    let runs = 0;
    const work = (): Promise<string> =>
      new Promise((resolve) => {
        runs += 1;
        setTimeout(() => resolve('ok'), 20);
      });

    const [a, b, c] = await Promise.all([
      registry.coalesce('RELIANCE:quote', work),
      registry.coalesce('RELIANCE:quote', work),
      registry.coalesce('RELIANCE:quote', work),
    ]);

    expect([a, b, c]).toEqual(['ok', 'ok', 'ok']);
    expect(runs).toBe(1);
    expect(registry.duplicatePrevented).toBe(2);
  });

  it('different keys do not share work', async () => {
    const registry = new InFlightRequestRegistry();
    let runs = 0;
    const work = async (id: string): Promise<string> => {
      runs += 1;
      return id;
    };

    await Promise.all([
      registry.coalesce('A', () => work('A')),
      registry.coalesce('B', () => work('B')),
    ]);
    expect(runs).toBe(2);
  });
});
