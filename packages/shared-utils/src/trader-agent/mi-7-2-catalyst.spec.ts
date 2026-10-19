/**
 * MI-7.2 — Catalyst engine from frozen MI snapshot (PIT + order-independent).
 */
import type { InstrumentMiBundle, MarketIntelligenceBatchSnapshot } from '@stockpred/shared-types';
import { MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION } from '@stockpred/shared-types';
import { nseEquityInstrumentRef } from './market-intelligence-core';
import {
  assessAdvancedCatalystSection,
  dedupeCatalystItems,
  isCatalystPitSafe,
} from './mi-7-catalyst-engine';
import { sectionHasFabricatedMissing } from './mi-advanced-contract';

function emptyBundle(symbol: string): InstrumentMiBundle {
  const instrument = nseEquityInstrumentRef(symbol);
  return {
    instrument,
    fundamentals: { status: 'UNAVAILABLE', facts: [] },
    news: { status: 'UNAVAILABLE', items: [] },
    corporateEvents: { status: 'UNAVAILABLE', items: [] },
    sentiment: { availability: 'UNAVAILABLE' },
  };
}

function miSnap(
  bySymbol: Record<string, InstrumentMiBundle>,
  asOf = '2026-06-01T00:00:00.000Z',
): MarketIntelligenceBatchSnapshot {
  const instruments = Object.values(bySymbol).map((b) => b.instrument);
  return {
    schemaVersion: MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION,
    snapshotId: 'MI-TEST-1',
    batchId: 'B1',
    dataSnapshotVersion: 'batch-data-snapshot.v1',
    asOf,
    universeType: 'CUSTOM',
    instruments,
    bySymbol,
    coverage: {
      fundamentalsAvailable: 0,
      newsAvailable: 1,
      sentimentAvailable: 0,
      corporateAvailable: 1,
      technicalAvailable: 0,
      eligible: instruments.length,
    },
    generatedAt: asOf,
  };
}

describe('MI-7.2 catalyst engine', () => {
  const asOf = '2026-06-01T00:00:00.000Z';

  it('excludes future publishedAt / availableAt (PIT)', () => {
    const bundle = emptyBundle('AAA');
    bundle.news = {
      status: 'AVAILABLE',
      items: [
        {
          eventId: 'past',
          headline: 'Past news',
          publishedAt: '2026-05-01T00:00:00.000Z',
          availableAt: '2026-05-01T00:00:00.000Z',
          sentimentScore: 0.5,
        },
        {
          eventId: 'future-pub',
          headline: 'Future published',
          publishedAt: '2026-07-01T00:00:00.000Z',
          availableAt: '2026-05-01T00:00:00.000Z',
        },
        {
          eventId: 'future-avail',
          headline: 'Future available',
          publishedAt: '2026-05-01T00:00:00.000Z',
          availableAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    };
    expect(isCatalystPitSafe(bundle.news.items[0]!, asOf)).toBe(true);
    expect(isCatalystPitSafe(bundle.news.items[1]!, asOf)).toBe(false);
    expect(isCatalystPitSafe(bundle.news.items[2]!, asOf)).toBe(false);

    const section = assessAdvancedCatalystSection({
      instrument: bundle.instrument,
      miSnapshot: miSnap({ AAA: bundle }, asOf),
      asOf,
      calculatedAt: asOf,
    });
    expect(section.status).toBe('PARTIAL');
    expect(section.payload?.catalysts).toHaveLength(1);
    expect(section.payload?.catalysts[0]?.title).toBe('Past news');
  });

  it('is candidate-order independent and dedupes evidenceIds', () => {
    const make = (order: 'asc' | 'desc') => {
      const items = [
        {
          eventId: 'e1',
          headline: 'Alpha',
          publishedAt: '2026-05-10T00:00:00.000Z',
          availableAt: '2026-05-10T00:00:00.000Z',
        },
        {
          eventId: 'e2',
          headline: 'Beta',
          publishedAt: '2026-05-11T00:00:00.000Z',
          availableAt: '2026-05-11T00:00:00.000Z',
        },
        {
          eventId: 'e1',
          headline: 'Alpha dup',
          publishedAt: '2026-05-10T00:00:00.000Z',
          availableAt: '2026-05-10T00:00:00.000Z',
        },
      ];
      if (order === 'desc') items.reverse();
      const bundle = emptyBundle('BBB');
      bundle.news = { status: 'AVAILABLE', items };
      return assessAdvancedCatalystSection({
        instrument: bundle.instrument,
        miSnapshot: miSnap({ BBB: bundle }, asOf),
        asOf,
        calculatedAt: asOf,
      });
    };
    const a = make('asc');
    const b = make('desc');
    expect(a.payload).toEqual(b.payload);
    expect(a.payload?.catalysts).toHaveLength(2);
  });

  it('UNAVAILABLE / DATA_INCOMPLETE never carries fabricated payload', () => {
    const bundle = emptyBundle('CCC');
    const section = assessAdvancedCatalystSection({
      instrument: bundle.instrument,
      miSnapshot: miSnap({ CCC: bundle }, asOf),
      asOf,
      calculatedAt: asOf,
    });
    expect(['UNAVAILABLE', 'DATA_INCOMPLETE']).toContain(section.status);
    expect(section.payload).toBeUndefined();
    expect(sectionHasFabricatedMissing(section)).toBe(false);
  });

  it('dedupeCatalystItems is deterministic', () => {
    const items = [
      {
        type: 'NEWS' as const,
        direction: 'UNKNOWN' as const,
        materiality: 'MED' as const,
        publishedAt: '2026-01-02T00:00:00.000Z',
        availableAt: '2026-01-02T00:00:00.000Z',
        confidence: 'LOW' as const,
        evidenceIds: ['b', 'a'],
        title: 'Z',
      },
      {
        type: 'NEWS' as const,
        direction: 'UNKNOWN' as const,
        materiality: 'MED' as const,
        publishedAt: '2026-01-01T00:00:00.000Z',
        availableAt: '2026-01-01T00:00:00.000Z',
        confidence: 'LOW' as const,
        evidenceIds: ['c'],
        title: 'A',
      },
    ];
    expect(dedupeCatalystItems(items)).toEqual(dedupeCatalystItems([...items].reverse()));
  });
});
