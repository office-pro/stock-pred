import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import type { AgentService } from './agent.service';
import { IntelligenceBatchService } from './intelligence-batch.service';

jest.mock('@stockpred/database', () => ({
  canonicalInstrumentExists: jest.fn(() => false),
  resolveGatedCanonicalUniverse: jest.fn(() => ({ supported: false })),
  resolveNseAllMembership: jest.fn(() => {
    throw new Error('not needed by rejection tests');
  }),
}));

describe('IntelligenceBatchService public create contract', () => {
  const service = new IntelligenceBatchService({} as AgentService);

  it('rejects manual symbols for predefined universes', async () => {
    await expect(
      service.create({ universe: 'NSE_ALL', symbols: ['RELIANCE'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects public truncation even when membership is canonical', async () => {
    await expect(service.create({ universe: 'NSE_ALL', allLimit: 50 })).rejects.toThrow('allLimit');
  });

  it('rejects invalid scan parameter combinations', async () => {
    await expect(
      service.create({ universe: 'NIFTY50', scanKind: 'GLOBAL_EVENT_SCAN' }),
    ).rejects.toThrow('globalEventType');
    await expect(service.create({ universe: 'NIFTY50', scanKind: 'INVERSE_SCAN' })).rejects.toThrow(
      'inverseDownsideThreshold',
    );
  });

  it('requires canonical InstrumentRefs rather than free-form CUSTOM symbols', async () => {
    await expect(
      service.create({ universe: 'CUSTOM', symbols: ['UNKNOWN-FREE-FORM'] }),
    ).rejects.toThrow('canonical instruments');
  });

  it('requires startDate and endDate when analysis period is CUSTOM', async () => {
    await expect(service.create({ universe: 'NIFTY50', analysisPeriod: 'CUSTOM' })).rejects.toThrow(
      'startDate and endDate',
    );
  });

  it('keeps eligible and available denominators separate at market close', async () => {
    const withOneHistoricalQuote = new IntelligenceBatchService({
      fetchCachedQuotesMap: async () =>
        new Map([
          [
            'RELIANCE',
            {
              symbol: 'RELIANCE',
              updatedAt: 100,
              freshnessStatus: 'CLOSED_MARKET',
            },
          ],
        ]),
    } as unknown as AgentService);
    const entry = (await withOneHistoricalQuote.universeCatalogWithAvailability()).find(
      (row) => row.universeId === 'NIFTY50',
    );
    expect(entry?.instrumentCount).toBe(50);
    expect(entry?.availability?.marketDataAvailable).toBe(1);
    expect(entry?.availability?.historical).toBe(1);
    expect(entry?.availability?.missing).toBe(49);
  });
});

describe('IntelligenceBatchService freeze contract', () => {
  it('does not recover quotes from MDS after BatchDataSnapshot freeze', () => {
    const src = readFileSync(join(__dirname, 'intelligence-batch.service.ts'), 'utf8');
    expect(src).not.toMatch(/fetchQuoteForIntelligenceBatch/);
    expect(src).toMatch(/hydrateBatchDataSnapshot/);
    expect(src).toMatch(/quotesMapFromSnapshot/);
  });

  it('binds result identity from frozen InstrumentRef and never re-resolves tickers', () => {
    const src = readFileSync(join(__dirname, 'intelligence-batch.service.ts'), 'utf8');
    expect(src).toMatch(/bindFrozenResultIdentity/);
    expect(src).not.toMatch(/resolveInstrumentWithAdapter/);
    expect(src).not.toMatch(/adapterHintFromUniverse\(String\(batch\.universe \?\? 'NIFTY50'\)\)/);
  });
});
