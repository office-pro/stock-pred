/**
 * MI-7.8 — IntelligenceContext attaches advanced row from batch-loaded snapshot only.
 */
import type {
  AdvancedIntelligenceSnapshot,
  InstrumentMiBundle,
  MarketIntelligenceBatchSnapshot,
} from '@stockpred/shared-types';
import {
  ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION,
  MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION,
} from '@stockpred/shared-types';
import { buildIntelligenceContext } from './mi-batch-snapshot';
import { buildEmptyAdvancedIntelligenceSnapshot } from './mi-advanced-contract';
import { nseEquityInstrumentRef } from './market-intelligence-core';

describe('MI-7.8 generate context (frozen advanced)', () => {
  const asOf = '2026-06-01T00:00:00.000Z';
  const instrument = nseEquityInstrumentRef('GEN');

  it('attaches advancedIntelligence from preloaded snapshot; missing stays absent', () => {
    const bundle: InstrumentMiBundle = {
      instrument,
      fundamentals: { status: 'UNAVAILABLE', facts: [] },
      news: { status: 'UNAVAILABLE', items: [] },
      corporateEvents: { status: 'UNAVAILABLE', items: [] },
      sentiment: { availability: 'UNAVAILABLE' },
    };
    const mi: MarketIntelligenceBatchSnapshot = {
      schemaVersion: MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION,
      snapshotId: 'MI-GEN',
      batchId: 'B-GEN',
      dataSnapshotVersion: 'md-v1',
      asOf,
      universeType: 'CUSTOM',
      instruments: [instrument],
      bySymbol: { GEN: bundle },
      coverage: {
        fundamentalsAvailable: 0,
        newsAvailable: 0,
        sentimentAvailable: 0,
        corporateAvailable: 0,
        technicalAvailable: 0,
        eligible: 1,
      },
      generatedAt: asOf,
    };

    const without = buildIntelligenceContext({
      dataSnapshotVersion: 'md-v1',
      miSnapshot: mi,
      symbol: 'GEN',
    });
    expect(without?.advancedIntelligenceSnapshotId).toBeUndefined();
    expect(without?.advancedIntelligence).toBeUndefined();

    const advanced: AdvancedIntelligenceSnapshot = buildEmptyAdvancedIntelligenceSnapshot({
      snapshotId: 'ADV-GEN',
      batchId: 'B-GEN',
      dataSnapshotVersion: 'md-v1',
      marketIntelligenceSnapshotId: 'MI-GEN',
      asOf,
      instruments: [instrument],
      generatedAt: asOf,
    });
    expect(advanced.schemaVersion).toBe(ADVANCED_INTELLIGENCE_SNAPSHOT_VERSION);

    const withAdv = buildIntelligenceContext({
      dataSnapshotVersion: 'md-v1',
      miSnapshot: mi,
      symbol: 'GEN',
      advancedIntelligenceSnapshotId: advanced.snapshotId,
      advancedIntelligence: advanced.bySymbol.GEN,
    });
    expect(withAdv?.advancedIntelligenceSnapshotId).toBe('ADV-GEN');
    expect(withAdv?.advancedIntelligence?.catalyst.status).toBe('UNAVAILABLE');
  });
});
