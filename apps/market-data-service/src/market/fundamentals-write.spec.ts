/**
 * Cached fundamentals must still be mirrored into MI facts, otherwise MI
 * preflight reports FUNDAMENTALS_INSUFFICIENT for symbols that have snapshots.
 */

const findFirst = jest.fn();
const findMany = jest.fn();
const persistMiFundamentalsFromSnapshots = jest.fn();

jest.mock('@stockpred/database', () => ({
  getPrismaClient: () => ({ fundamentalSnapshot: { findFirst, findMany } }),
  isPlaceholderSymbol: () => false,
}));

jest.mock('./mi-persist', () => ({
  persistMiFundamentalsFromSnapshots: (...args: unknown[]) =>
    persistMiFundamentalsFromSnapshots(...args),
}));

import { ingestSymbol, mirrorStoredSnapshotsToMi } from './fundamentals-write';

const snapshot = {
  symbol: 'RELIANCE',
  asOfDate: new Date('2026-06-30T00:00:00.000Z'),
  availableAt: new Date('2026-08-01T00:00:00.000Z'),
  source: 'yahoo',
  revenue: 1,
  pat: 2,
  roe: 3,
};

describe('fundamentals MI mirror', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    findFirst.mockReset();
    findMany.mockReset();
    persistMiFundamentalsFromSnapshots.mockReset();
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it('mirrors stored snapshots into MI when the cache is fresh', async () => {
    findFirst.mockResolvedValue({ availableAt: new Date() });
    findMany.mockResolvedValue([snapshot]);
    persistMiFundamentalsFromSnapshots.mockResolvedValue({ written: 1, skippedFuture: 0 });

    const result = await ingestSymbol('RELIANCE');

    expect(result).toEqual({ symbol: 'RELIANCE', snapshots: 0, cached: true });
    expect(findMany).toHaveBeenCalledWith({ where: { symbol: 'RELIANCE' } });
    expect(persistMiFundamentalsFromSnapshots).toHaveBeenCalledWith([snapshot]);
  });

  it('skips the MI write when the symbol has no stored snapshots', async () => {
    findMany.mockResolvedValue([]);
    await expect(mirrorStoredSnapshotsToMi('JBCHEPHARM')).resolves.toBe(0);
    expect(persistMiFundamentalsFromSnapshots).not.toHaveBeenCalled();
  });

  it('does not fail the ingest when the MI write throws', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    findMany.mockResolvedValue([snapshot]);
    persistMiFundamentalsFromSnapshots.mockRejectedValue(new Error('db down'));
    await expect(mirrorStoredSnapshotsToMi('RELIANCE')).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
