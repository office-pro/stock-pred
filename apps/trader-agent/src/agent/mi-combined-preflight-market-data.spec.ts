/**
 * Market-data leg of combined preflight: a failed quote inventory read must be
 * reported as QUOTE_INVENTORY_UNAVAILABLE, not as a true zero-coverage result.
 */

import type { CapabilityInventory } from '@stockpred/shared-utils';

jest.mock('@stockpred/database', () => ({
  getPrismaClient: jest.fn(),
  resolveNseAllMembership: jest.fn(),
}));

import type { AgentService } from './agent.service';
import { MiCombinedPreflightService } from './mi-combined-preflight.service';

type QuoteInventory = Awaited<ReturnType<AgentService['fetchQuoteInventory']>>;

function collect(inventory: QuoteInventory, symbols: string[]): Promise<CapabilityInventory> {
  const agent = { fetchQuoteInventory: jest.fn().mockResolvedValue(inventory) };
  const svc = new MiCombinedPreflightService(agent as unknown as AgentService);
  return (
    svc as unknown as {
      collectMarketData(s: string[], asOf: string): Promise<CapabilityInventory>;
    }
  ).collectMarketData(symbols, '2026-09-01T12:00:00.000Z');
}

describe('MiCombinedPreflightService market-data inventory', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('counts priced quotes and reports the latest update time', async () => {
    const updatedAt = Date.parse('2026-09-01T11:55:00.000Z');
    const quotes = new Map([
      ['RELIANCE', { symbol: 'RELIANCE', price: 2900, updatedAt }],
      ['TCS', { symbol: 'TCS', price: 0, updatedAt }],
    ]);
    const inv = await collect({ quotes } as unknown as QuoteInventory, ['RELIANCE', 'TCS', 'INFY']);

    expect(inv.available).toBe(1);
    expect(inv.requiredCount).toBe(3);
    expect(inv.latestTimestamp).toBe('2026-09-01T11:55:00.000Z');
    expect(inv.inventoryReasons).toBeUndefined();
    expect(inv.sampleIssues).toEqual([
      { symbol: 'TCS', issues: ['QUOTE_MISSING'] },
      { symbol: 'INFY', issues: ['QUOTE_MISSING'] },
    ]);
  });

  it('marks the leg QUOTE_INVENTORY_UNAVAILABLE when the quote read fails', async () => {
    const inv = await collect({ quotes: new Map(), error: 'timeout of 90000ms exceeded' }, [
      'RELIANCE',
      'TCS',
    ]);

    expect(inv.available).toBe(0);
    expect(inv.inventoryReasons).toEqual(['QUOTE_INVENTORY_UNAVAILABLE']);
    expect(inv.sampleIssues).toEqual([
      { symbol: 'RELIANCE', issues: ['QUOTE_INVENTORY_UNAVAILABLE'] },
      { symbol: 'TCS', issues: ['QUOTE_INVENTORY_UNAVAILABLE'] },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timeout of 90000ms exceeded'));
  });
});

describe('MiCombinedPreflightService historical inventory', () => {
  it('reports a failed candle read as HISTORICAL_FETCH_FAILED, not zero bars', async () => {
    const fetchNseDailyCandlesForBatch = jest.fn(async (sym: string) => {
      if (sym === 'ABB') throw new Error('timeout of 10000ms exceeded');
      return Array.from({ length: sym === 'GROWW' ? 304 : 325 }, () => ({}));
    });
    const svc = new MiCombinedPreflightService({
      fetchNseDailyCandlesForBatch,
    } as unknown as AgentService);

    const inv = await (
      svc as unknown as {
        collectHistorical(s: string[], minBars: number): Promise<CapabilityInventory>;
      }
    ).collectHistorical(['ABB', 'GROWW', 'TCS'], 325);

    expect(fetchNseDailyCandlesForBatch).toHaveBeenCalledWith('ABB', 325, {
      timeoutMs: 10_000,
      throwOnError: true,
    });
    expect(inv.available).toBe(1);
    expect(inv.sampleIssues).toEqual(
      expect.arrayContaining([
        { symbol: 'ABB', issues: ['HISTORICAL_FETCH_FAILED'] },
        { symbol: 'GROWW', issues: ['BARS_INSUFFICIENT:304<325'] },
      ]),
    );
  });

  it('records per-instrument outcomes for ELIGIBLE_SUBSET (uncapped, unlike sampleIssues)', async () => {
    const fetchNseDailyCandlesForBatch = jest.fn(async (sym: string) => {
      if (sym === 'ABB') throw new Error('timeout of 10000ms exceeded');
      const n = sym === 'GROWW' ? 304 : sym === 'NEWCO' ? 0 : 325;
      return Array.from({ length: n }, () => ({}));
    });
    const svc = new MiCombinedPreflightService({
      fetchNseDailyCandlesForBatch,
    } as unknown as AgentService);

    const inv = await (
      svc as unknown as {
        collectHistorical(s: string[], minBars: number): Promise<CapabilityInventory>;
      }
    ).collectHistorical(['ABB', 'GROWW', 'NEWCO', 'TCS'], 325);

    expect(inv.perInstrument).toEqual({
      ABB: { ok: false, reason: 'HISTORICAL_FETCH_FAILED' },
      GROWW: { ok: false, reason: 'INSUFFICIENT_HISTORY:304<325' },
      NEWCO: { ok: false, reason: 'NO_HISTORY' },
      TCS: { ok: true },
    });
  });
});

describe('MiCombinedPreflightService market-data per-instrument outcomes', () => {
  it('keeps each quote timestamp so freshness is judged per instrument', async () => {
    const fresh = Date.parse('2026-09-01T11:55:00.000Z');
    const stale = Date.parse('2026-08-29T10:00:00.000Z');
    const quotes = new Map([
      ['RELIANCE', { symbol: 'RELIANCE', price: 2900, updatedAt: fresh }],
      ['TCS', { symbol: 'TCS', price: 3900, updatedAt: stale }],
    ]);
    const inv = await collect({ quotes } as unknown as QuoteInventory, ['RELIANCE', 'TCS', 'INFY']);

    expect(inv.readFailed).toBeUndefined();
    expect(inv.perInstrument).toEqual({
      RELIANCE: { ok: true, timestamp: '2026-09-01T11:55:00.000Z' },
      TCS: { ok: true, timestamp: '2026-08-29T10:00:00.000Z' },
      INFY: { ok: false, reason: 'QUOTE_MISSING' },
    });
  });

  it('flags readFailed when the quote inventory cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const inv = await collect({ quotes: new Map(), error: 'boom' }, ['RELIANCE']);
    warn.mockRestore();
    expect(inv.readFailed).toBe(true);
  });
});
