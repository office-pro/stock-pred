/**
 * MI-7.7 — Advanced snapshot aggregation + contentHash determinism.
 */
import type {
  BatchDataSnapshot,
  InstrumentMiBundle,
  MarketIntelligenceBatchSnapshot,
} from '@stockpred/shared-types';
import {
  BATCH_DATA_SNAPSHOT_VERSION,
  MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION,
} from '@stockpred/shared-types';
import {
  buildAdvancedIntelligenceSnapshot,
  hashAdvancedContent,
} from './mi-7-advanced-snapshot-builder';
import { nseEquityInstrumentRef } from './market-intelligence-core';
import { validateAdvancedSnapshotLinkage } from './mi-advanced-contract';

function closes(n: number) {
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1.002;
    out.push({
      time: 1_700_000_000_000 + i * 86_400_000,
      open: p,
      high: p,
      low: p,
      close: p,
      volume: 1000,
    });
  }
  return out;
}

describe('MI-7.7 advanced snapshot builder', () => {
  const asOf = '2026-06-01T00:00:00.000Z';
  const instrument = nseEquityInstrumentRef('SNAP');

  it('builds linked snapshot with contentHash; same inputs → same hash', () => {
    const dataSnapshot: BatchDataSnapshot = {
      schemaVersion: BATCH_DATA_SNAPSHOT_VERSION,
      batchId: 'B-SNAP',
      universeId: 'CUSTOM',
      provider: 'test',
      providerSelectionReason: 'test',
      instruments: [
        {
          instrumentRef: instrument,
          candles: closes(80),
          dataStatus: 'AVAILABLE',
        },
      ],
      dataAsOf: Date.parse(asOf),
      createdAt: Date.parse(asOf),
      coverage: {
        readiness: 'READY',
        eligible: 1,
        processed: 1,
        available: 1,
        partial: 0,
        unavailable: 0,
        failed: 0,
        pending: 0,
        marketDataAvailable: 1,
        historicalAvailable: 1,
        derivativesAvailable: 0,
        requiredCapabilities: [],
        coveragePct: 100,
        minRequiredCoveragePct: 0,
        reasons: [],
      },
      freshnessPolicyVersion: 'v1',
      dataSnapshotVersion: 'md-test-v1',
      frozen: true,
    };

    const bundle: InstrumentMiBundle = {
      instrument,
      fundamentals: { status: 'UNAVAILABLE', facts: [] },
      news: {
        status: 'AVAILABLE',
        items: [
          {
            eventId: 'n1',
            headline: 'News',
            publishedAt: '2026-05-01T00:00:00.000Z',
            availableAt: '2026-05-01T00:00:00.000Z',
          },
        ],
      },
      corporateEvents: { status: 'UNAVAILABLE', items: [] },
      sentiment: { availability: 'UNAVAILABLE' },
    };
    const miSnapshot: MarketIntelligenceBatchSnapshot = {
      schemaVersion: MARKET_INTELLIGENCE_BATCH_SNAPSHOT_VERSION,
      snapshotId: 'MI-SNAP',
      batchId: 'B-SNAP',
      dataSnapshotVersion: 'md-test-v1',
      asOf,
      universeType: 'CUSTOM',
      instruments: [instrument],
      bySymbol: { SNAP: bundle },
      coverage: {
        fundamentalsAvailable: 0,
        newsAvailable: 1,
        sentimentAvailable: 0,
        corporateAvailable: 0,
        technicalAvailable: 0,
        eligible: 1,
      },
      generatedAt: asOf,
    };

    const a = buildAdvancedIntelligenceSnapshot({
      snapshotId: 'ADV-A',
      batchId: 'B-SNAP',
      dataSnapshot,
      miSnapshot,
      asOf,
      generatedAt: asOf,
    });
    const b = buildAdvancedIntelligenceSnapshot({
      snapshotId: 'ADV-B',
      batchId: 'B-SNAP',
      dataSnapshot,
      miSnapshot,
      asOf,
      generatedAt: asOf,
    });
    expect(validateAdvancedSnapshotLinkage(a)).toEqual({ ok: true });
    expect(a.sourceMetadata.contentHash).toBeTruthy();
    expect(hashAdvancedContent(a)).toBe(hashAdvancedContent(b));
    expect(a.bySymbol.SNAP?.catalyst.status).toMatch(/AVAILABLE|PARTIAL/);
    expect(a.coverage.eligible).toBe(1);
  });
});
