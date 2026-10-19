import type {
  BatchDataSnapshot,
  InstrumentMiBundle,
  MarketIntelligenceBatchSnapshot,
} from '@stockpred/shared-types';
import { nseEquityInstrumentRef } from './market-intelligence-core';
import { isPitEligible } from './mi-coverage-report';
import { resolveIntelligenceUniverse } from './intelligence-batch-universe';
import {
  assertSnapshotMembershipMatchesBatch,
  buildIntelligenceContext,
  fundamentalPayloadFromMiBundle,
  newsBlockFromMiBundle,
  sentimentFromMiBundle,
  symbolSetEqual,
  technicalFromFrozenRow,
  validateMiSnapshotForGenerate,
} from './mi-batch-snapshot';

describe('MI-5 membership + snapshot helpers', () => {
  it('symbolSetEqual is order-independent', () => {
    expect(symbolSetEqual(['A', 'B'], ['B', 'A'])).toBe(true);
    expect(symbolSetEqual(['A'], ['A', 'B'])).toBe(false);
  });

  it('assertSnapshotMembershipMatchesBatch PASS/FAIL', () => {
    const snapshot = {
      instruments: [
        { instrumentRef: nseEquityInstrumentRef('AAA') },
        { instrumentRef: nseEquityInstrumentRef('BBB') },
      ],
    } as BatchDataSnapshot;
    expect(
      assertSnapshotMembershipMatchesBatch({
        batchSymbols: ['BBB', 'AAA'],
        snapshot,
      }).ok,
    ).toBe(true);
    expect(
      assertSnapshotMembershipMatchesBatch({
        batchSymbols: ['AAA'],
        snapshot,
      }).ok,
    ).toBe(false);
  });

  it('technical UNAVAILABLE without candles; AVAILABLE with technicals', () => {
    expect(technicalFromFrozenRow(undefined)?.status).toBe('UNAVAILABLE');
    expect(
      technicalFromFrozenRow({
        instrumentRef: nseEquityInstrumentRef('X'),
        candles: [],
        technicals: { source: 'ENGINE_DERIVED', rsi: 55 },
        dataStatus: 'AVAILABLE',
      } as never)?.status,
    ).toBe('UNAVAILABLE');
    expect(
      technicalFromFrozenRow({
        instrumentRef: nseEquityInstrumentRef('X'),
        candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        technicals: { source: 'ENGINE_DERIVED', rsi: 55 },
        dataStatus: 'AVAILABLE',
      })?.status,
    ).toBe('AVAILABLE');
  });

  it('PIT-style projections: missing fundamentals stay UNAVAILABLE; sentiment null≠0', () => {
    const empty: InstrumentMiBundle = {
      instrument: nseEquityInstrumentRef('X'),
      fundamentals: { status: 'UNAVAILABLE', facts: [] },
      news: { status: 'UNAVAILABLE', items: [] },
      corporateEvents: { status: 'UNAVAILABLE', items: [] },
      sentiment: { availability: 'UNAVAILABLE' },
    };
    const fund = fundamentalPayloadFromMiBundle(empty);
    expect(fund?.kind).toBe('UNAVAILABLE');
    expect(sentimentFromMiBundle(empty)).toBeNull();
    expect(newsBlockFromMiBundle(empty)?.reasonCode).toBe('NOT_IN_MI_SNAPSHOT');

    const scored: InstrumentMiBundle = {
      ...empty,
      news: {
        status: 'AVAILABLE',
        items: [
          {
            publishedAt: '2026-09-01T00:00:00.000Z',
            availableAt: '2026-09-01T00:00:00.000Z',
            headline: 'h',
          },
        ],
      },
      sentiment: { availability: 'AVAILABLE', score: 0.02, modelVersion: 'finbert' },
    };
    expect(sentimentFromMiBundle(scored)).toEqual({ source: 'MODEL_DERIVED', score: 0.02 });
  });

  it('dual PIT exclusion mirrors isPitEligible', () => {
    const asOf = new Date('2026-09-01T00:00:00.000Z');
    expect(isPitEligible('2026-08-01T00:00:00.000Z', '2026-08-15T00:00:00.000Z', asOf)).toBe(true);
    expect(isPitEligible('2026-09-02T00:00:00.000Z', '2026-08-15T00:00:00.000Z', asOf)).toBe(false);
    expect(isPitEligible('2026-08-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', asOf)).toBe(false);
  });

  it('Generate gate: STANDARD blocks empty fundamentals; CUSTOM allows', () => {
    const emptyMi: MarketIntelligenceBatchSnapshot = {
      schemaVersion: 'mi-batch-snapshot.v1',
      snapshotId: 'MI-empty',
      batchId: 'B1',
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      asOf: '2026-09-01T00:00:00.000Z',
      universeType: 'CUSTOM',
      instruments: [nseEquityInstrumentRef('AAA')],
      bySymbol: {
        AAA: {
          instrument: nseEquityInstrumentRef('AAA'),
          fundamentals: { status: 'UNAVAILABLE', facts: [] },
          news: { status: 'UNAVAILABLE', items: [] },
          corporateEvents: { status: 'UNAVAILABLE', items: [] },
          sentiment: { availability: 'NOT_APPLICABLE' },
        },
      },
      coverage: {
        fundamentalsAvailable: 0,
        newsAvailable: 0,
        sentimentAvailable: 0,
        corporateAvailable: 0,
        technicalAvailable: 0,
        eligible: 1,
      },
      generatedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(
      validateMiSnapshotForGenerate({
        miSnapshot: emptyMi,
        batchSymbols: ['AAA'],
        miMode: 'STANDARD',
      }).ok,
    ).toBe(false);
    expect(
      validateMiSnapshotForGenerate({
        miSnapshot: emptyMi,
        batchSymbols: ['AAA'],
        miMode: 'CUSTOM',
      }).ok,
    ).toBe(true);
  });

  it('buildIntelligenceContext + validateMiSnapshotForGenerate with fundamentals', () => {
    const mi: MarketIntelligenceBatchSnapshot = {
      schemaVersion: 'mi-batch-snapshot.v1',
      snapshotId: 'MI-1',
      batchId: 'B1',
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      asOf: '2026-09-01T00:00:00.000Z',
      universeType: 'CUSTOM',
      instruments: [nseEquityInstrumentRef('AAA'), nseEquityInstrumentRef('BBB')],
      bySymbol: {
        AAA: {
          instrument: nseEquityInstrumentRef('AAA'),
          fundamentals: {
            status: 'AVAILABLE',
            facts: [
              {
                metric: 'revenue',
                value: 1,
                availableAt: '2026-08-01T00:00:00.000Z',
                publishedAt: '2026-08-01T00:00:00.000Z',
              },
              {
                metric: 'pat',
                value: 2,
                availableAt: '2026-08-01T00:00:00.000Z',
                publishedAt: '2026-08-01T00:00:00.000Z',
              },
            ],
          },
          news: { status: 'UNAVAILABLE', items: [] },
          corporateEvents: { status: 'UNAVAILABLE', items: [] },
          sentiment: { availability: 'NOT_APPLICABLE' },
        },
        BBB: {
          instrument: nseEquityInstrumentRef('BBB'),
          fundamentals: {
            status: 'AVAILABLE',
            facts: [
              {
                metric: 'revenue',
                value: 3,
                availableAt: '2026-08-01T00:00:00.000Z',
                publishedAt: '2026-08-01T00:00:00.000Z',
              },
              {
                metric: 'roe',
                value: 0.1,
                availableAt: '2026-08-01T00:00:00.000Z',
                publishedAt: '2026-08-01T00:00:00.000Z',
              },
            ],
          },
          news: { status: 'UNAVAILABLE', items: [] },
          corporateEvents: { status: 'UNAVAILABLE', items: [] },
          sentiment: { availability: 'NOT_APPLICABLE' },
        },
      },
      coverage: {
        fundamentalsAvailable: 2,
        newsAvailable: 0,
        sentimentAvailable: 0,
        corporateAvailable: 0,
        technicalAvailable: 0,
        eligible: 2,
      },
      generatedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(
      validateMiSnapshotForGenerate({
        miSnapshot: mi,
        batchSymbols: ['AAA', 'BBB'],
        miMode: 'STANDARD',
      }).ok,
    ).toBe(true);
    const ctx = buildIntelligenceContext({
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      miSnapshot: mi,
      symbol: 'AAA',
    });
    expect(ctx?.marketIntelligenceSnapshotId).toBe('MI-1');
    expect(ctx?.fundamentals?.status).toBe('AVAILABLE');
    expect(ctx?.dataSnapshotVersion).toBe('batch-data-snapshot.v1');
  });

  it('NIFTY50 membership lock smoke: equality helper holds for 50 symbols', () => {
    const symbols = resolveIntelligenceUniverse({ universe: 'NIFTY50' });
    expect(symbols.length).toBe(50);
    expect(symbolSetEqual(symbols, [...symbols].reverse())).toBe(true);
    expect(symbolSetEqual(symbols, symbols.slice(0, 49))).toBe(false);
  });
});
