/**
 * MI source-data binding — policy, MDS map, sentiment denom, corporate ≠ news.
 */

import type {
  BatchDataSnapshot,
  BatchInstrumentData,
  InstrumentRef,
} from '@stockpred/shared-types';
import { BATCH_DATA_SNAPSHOT_VERSION } from '@stockpred/shared-types';
import { buildMiEvidenceFromMdsPanels, nseEquityInstrumentRef } from './market-intelligence-core';
import { listEnabledMiProviders } from './market-intelligence-providers';
import {
  corporateFromMdsPanel,
  normalizedFundamentalsFromMdsPanel,
  rawFundamentalsFromMdsPanel,
} from './mi-mds-bind';
import {
  isYahooFundamentalAuthority,
  miSourceBindings,
  resolveMiFundamentalProviders,
} from './mi-source-policy';
import { buildSnapshotCapabilityCoverage } from './snapshot-capability-coverage';

function nse(symbol: string): InstrumentRef {
  return nseEquityInstrumentRef(symbol);
}

function snap(
  instruments: BatchInstrumentData[],
  macro?: BatchDataSnapshot['macro'],
): BatchDataSnapshot {
  return {
    schemaVersion: BATCH_DATA_SNAPSHOT_VERSION,
    batchId: 's',
    universeId: 'CUSTOM',
    provider: 'mds',
    providerSelectionReason: 'test',
    instruments,
    dataAsOf: 1,
    createdAt: 1,
    coverage: {
      readiness: 'READY',
      eligible: instruments.length,
      processed: instruments.length,
      available: instruments.length,
      partial: 0,
      unavailable: 0,
      failed: 0,
      pending: 0,
      marketDataAvailable: instruments.length,
      historicalAvailable: 0,
      derivativesAvailable: 0,
      requiredCapabilities: ['marketData'],
      coveragePct: 100,
      minRequiredCoveragePct: 50,
      reasons: [],
    },
    freshnessPolicyVersion: 'v1',
    dataSnapshotVersion: BATCH_DATA_SNAPSHOT_VERSION,
    frozen: true,
    ...(macro ? { macro } : {}),
  };
}

describe('MI source-data binding', () => {
  it('locks NSE as fundamental primary; Yahoo is not fund SoT', () => {
    expect(isYahooFundamentalAuthority()).toBe(false);
    expect(resolveMiFundamentalProviders()).toEqual(['nse']);
    expect(resolveMiFundamentalProviders()).not.toContain('yahoo');
    const list = listEnabledMiProviders();
    expect(list.fundamentals).toEqual(['nse']);
    expect(list.news).toEqual(expect.arrayContaining(['current', 'gdelt']));
    expect(list.macro).toBe('rbi');
    const enrichment = miSourceBindings().find((b) => b.capability === 'fundamentalEnrichment');
    expect(enrichment?.enabled).toBe(false);
  });

  it('maps MDS fundamentals panel to PIT facts without fabricating', () => {
    const instrument = nse('TCS');
    const raw = rawFundamentalsFromMdsPanel(instrument, {
      symbol: 'TCS',
      revenue: 1e11,
      pat: 2e10,
      roe: 25,
      as_of_date: '2026-06-30',
      available_at: '2026-08-10T00:00:00.000Z',
      source: 'nse',
    });
    expect(raw.some((r) => r.metric === 'revenue')).toBe(true);
    expect(raw.every((r) => r.provenance.availableAt && r.provenance.sourceType === 'NSE')).toBe(
      true,
    );
    expect(rawFundamentalsFromMdsPanel(instrument, { symbol: 'TCS' })).toEqual([]);
    const facts = normalizedFundamentalsFromMdsPanel(instrument, {
      symbol: 'TCS',
      revenue: 1e11,
      available_at: '2026-08-10T00:00:00.000Z',
      source: 'nse',
    });
    expect(facts[0].conflict).toBe(false);
  });

  it('treats corporate announcements as events, not news', () => {
    const instrument = nse('INFY');
    const { disclosures, actions } = corporateFromMdsPanel(instrument, [
      {
        symbol: 'INFY',
        kind: 'ANNOUNCEMENT',
        event_type: 'Board meeting',
        headline: 'Board meeting on 12 Sep',
        available_at: '2026-09-01T00:00:00.000Z',
        published_at: '2026-09-01T00:00:00.000Z',
        source: 'nse',
      },
      {
        symbol: 'INFY',
        kind: 'CORPORATE_ACTION',
        event_type: 'DIVIDEND',
        action_type: 'DIVIDEND',
        headline: 'Interim dividend',
        available_at: '2026-08-15T00:00:00.000Z',
        published_at: '2026-08-15T00:00:00.000Z',
        source: 'nse',
      },
    ]);
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0].provenance.evidenceKind).toBe('FILING');
    expect(actions).toHaveLength(1);
    expect(actions[0].provenance.evidenceKind).toBe('CORPORATE_ACTION');
  });

  it('buildMiEvidenceFromMdsPanels sets hasCorporateEvents from corporate panel', () => {
    const instruments = [nse('AAA'), nse('BBB')];
    const evidence = buildMiEvidenceFromMdsPanels({
      instruments,
      fundamentalsRows: [{ symbol: 'AAA', revenue: 1, available_at: '2026-08-01T00:00:00.000Z' }],
      newsRows: [{ symbol: 'BBB', news_count_7d: 2, available_at: '2026-08-02T00:00:00.000Z' }],
      corporateRows: [
        {
          symbol: 'AAA',
          kind: 'ANNOUNCEMENT',
          event_type: 'Order win',
          headline: 'Large order',
          available_at: '2026-08-03T00:00:00.000Z',
        },
      ],
    });
    expect(evidence[0].hasCorporateEvents).toBe(true);
    expect(evidence[1].hasCorporateEvents).toBe(false);
    expect(evidence[0].hasFundamentals).toBe(true);
    expect(evidence[1].hasNewsInWindow).toBe(true);
  });

  it('sentiment eligible ≤ news contexts (N/A without headlines)', () => {
    const coverage = buildSnapshotCapabilityCoverage(
      snap([
        {
          instrumentRef: nse('AAA'),
          quote: { price: 100 },
          dataStatus: 'AVAILABLE',
          news: { source: 'SOURCE_REPORTED', headlineCount: 3 },
          sentiment: { source: 'MODEL_DERIVED', score: 0.2 },
        },
        {
          instrumentRef: nse('BBB'),
          quote: { price: 100 },
          dataStatus: 'AVAILABLE',
          news: { source: 'SOURCE_REPORTED', headlineCount: 0 },
          sentiment: null,
        },
      ]),
    );
    const sentiment = coverage.find((c) => c.capability === 'sentiment');
    const news = coverage.find((c) => c.capability === 'news');
    expect(sentiment?.eligible).toBe(1);
    expect(sentiment?.na).toBe(1);
    expect(sentiment?.available).toBe(1);
    expect(news?.eligible).toBe(2);
    expect(sentiment!.eligible).toBeLessThanOrEqual(news!.available + news!.partial);
  });

  it('macro coverage stays batch-level eligible=1', () => {
    const coverage = buildSnapshotCapabilityCoverage(
      snap(
        [
          { instrumentRef: nse('AAA'), quote: { price: 1 }, dataStatus: 'AVAILABLE' },
          { instrumentRef: nse('BBB'), quote: { price: 1 }, dataStatus: 'AVAILABLE' },
        ],
        {
          source: 'SOURCE_REPORTED',
          requestedCount: 4,
          requestedSeries: ['FEDFUNDS', 'CPI', 'UNEMPLOYMENT', 'DGS10'],
          series: [
            {
              seriesId: 'FEDFUNDS',
              value: 5,
              asOf: 1,
              source: 'SOURCE_REPORTED',
              provider: 'fed',
            },
            {
              seriesId: 'CPI',
              value: 3,
              asOf: 1,
              source: 'SOURCE_REPORTED',
              provider: 'bls',
            },
            {
              seriesId: 'UNEMPLOYMENT',
              value: 4,
              asOf: 1,
              source: 'SOURCE_REPORTED',
              provider: 'bls',
            },
            {
              seriesId: 'DGS10',
              value: 4,
              asOf: 1,
              source: 'SOURCE_REPORTED',
              provider: 'treasury',
            },
          ],
        },
      ),
    );
    const macro = coverage.find((c) => c.capability === 'macro');
    expect(macro?.eligible).toBe(1);
    expect(macro?.available).toBe(1);
  });
});
