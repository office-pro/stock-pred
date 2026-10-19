/**
 * MI-7.6 — Global impact UNAVAILABLE without undefined score.
 */
import type { InstrumentMiBundle, MarketIntelligenceBatchSnapshot } from '@stockpred/shared-types';
import { MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION } from '@stockpred/shared-types';
import { assessAdvancedGlobalImpactSection } from './mi-7-global-impact-engine';
import { nseEquityInstrumentRef } from './market-intelligence-core';
import { sectionHasFabricatedMissing } from './mi-advanced-contract';

describe('MI-7.6 global impact', () => {
  it('UNAVAILABLE when no qualifying global sources (no score=0)', () => {
    const instrument = nseEquityInstrumentRef('GLB');
    const bundle: InstrumentMiBundle = {
      instrument,
      fundamentals: { status: 'UNAVAILABLE', facts: [] },
      news: { status: 'UNAVAILABLE', items: [] },
      corporateEvents: { status: 'UNAVAILABLE', items: [] },
      sentiment: { availability: 'UNAVAILABLE' },
    };
    const mi: MarketIntelligenceBatchSnapshot = {
      schemaVersion: MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION,
      snapshotId: 'MI-G',
      batchId: 'B',
      dataSnapshotVersion: 'md-v1',
      asOf: '2026-06-01T00:00:00.000Z',
      universeType: 'CUSTOM',
      instruments: [instrument],
      bySymbol: { GLB: bundle },
      coverage: {
        fundamentalsAvailable: 0,
        newsAvailable: 0,
        sentimentAvailable: 0,
        corporateAvailable: 0,
        technicalAvailable: 0,
        eligible: 1,
      },
      generatedAt: '2026-06-01T00:00:00.000Z',
    };
    const section = assessAdvancedGlobalImpactSection({
      instrument,
      miSnapshot: mi,
      calculatedAt: mi.asOf,
    });
    expect(section.status).toBe('UNAVAILABLE');
    expect(section.payload).toBeUndefined();
    expect(section.provenance.reason).toBe('NO_QUALIFYING_GLOBAL_SOURCE_DATA');
    expect(sectionHasFabricatedMissing(section)).toBe(false);
  });
});
