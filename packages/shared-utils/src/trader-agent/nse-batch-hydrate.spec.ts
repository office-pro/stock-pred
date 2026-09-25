/**
 * MULTI-ASSET BATCH FIX — NSE hydrate candles acceptance.
 * Quote + >=20 daily candles → AVAILABLE. Quote + 0 candles → PARTIAL / NOT_READY.
 * Coverage rule unchanged. No fabricated bars.
 */

import type { BatchCandle, InstrumentRef, StockQuote } from '@stockpred/shared-types';
import { hydrateBatchDataSnapshot } from './batch-data-hydrate';

function nseEquity(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'EQUITY',
    venue: 'NSE',
    quoteCurrency: 'INR',
    canonicalSymbol: symbol,
  };
}

function nseQuote(symbol: string): StockQuote {
  return {
    symbol,
    name: symbol,
    exchange: 'NSE',
    price: 1400,
    change: 10,
    changePercent: 0.7,
    volume: 1_000_000,
    dayHigh: 1410,
    dayLow: 1390,
    previousClose: 1390,
    updatedAt: 1,
  } as StockQuote;
}

function dailyBars(count: number): BatchCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: 1_700_000_000_000 + i * 86_400_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1_000,
  }));
}

describe('NSE batch hydrate candles (MULTI-ASSET BATCH FIX)', () => {
  it('quote + >=20 daily candles → AVAILABLE historicalCandles and coverage denominator', async () => {
    const instruments = [nseEquity('RELIANCE')];
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'nse-ready',
      universeId: 'NIFTY500',
      instruments,
      eligible: 1,
      deps: {
        skipEvidence: true,
        skipOnchain: true,
        skipSocial: true,
        fetchNseQuote: async () => nseQuote('RELIANCE'),
        fetchNseCandles: async () => dailyBars(20),
      },
    });
    expect(snapshot.instruments[0]?.dataStatus).toBe('AVAILABLE');
    expect(snapshot.instruments[0]?.candles?.length).toBe(20);
    const historical = snapshot.capabilityCoverage?.find(
      (row) => row.capability === 'historicalCandles',
    );
    expect(historical?.status).toBe('AVAILABLE');
    expect(historical?.eligible).toBe(1);
    expect(report.eligible).toBe(1);
    expect(report.available).toBe(1);
    expect(report.readiness).not.toBe('NOT_READY');
  });

  it('quote + 0 candles → PARTIAL, historicalCandles UNAVAILABLE, NOT_READY', async () => {
    const instruments = [nseEquity('RELIANCE')];
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'nse-partial',
      universeId: 'NSE_ALL',
      instruments,
      eligible: 1,
      deps: {
        skipEvidence: true,
        skipOnchain: true,
        skipSocial: true,
        fetchNseQuote: async () => nseQuote('RELIANCE'),
        fetchNseCandles: async () => [],
      },
    });
    expect(snapshot.instruments[0]?.dataStatus).toBe('PARTIAL');
    expect(snapshot.instruments[0]?.candles).toBeUndefined();
    const historical = snapshot.capabilityCoverage?.find(
      (row) => row.capability === 'historicalCandles',
    );
    expect(historical?.status).toBe('UNAVAILABLE');
    expect(report.available).toBe(0);
    expect(report.partial).toBe(1);
    expect(report.coveragePct).toBe(0);
    expect(report.readiness).toBe('NOT_READY');
    expect(report.minRequiredCoveragePct).toBe(50);
  });

  it('missing fetchNseCandles never fabricates bars', async () => {
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'nse-no-fn',
      universeId: 'NSE_ALL',
      instruments: [nseEquity('TCS')],
      eligible: 1,
      deps: {
        skipEvidence: true,
        skipOnchain: true,
        skipSocial: true,
        fetchNseQuote: async () => nseQuote('TCS'),
      },
    });
    expect(snapshot.instruments[0]?.candles).toBeUndefined();
    expect(snapshot.instruments[0]?.dataStatus).toBe('PARTIAL');
    expect(report.readiness).toBe('NOT_READY');
  });

  it('reports hydrate progress as NSE rows finish', async () => {
    const ticks: Array<[number, number]> = [];
    await hydrateBatchDataSnapshot({
      batchId: 'nse-progress',
      universeId: 'NIFTY50',
      instruments: [nseEquity('TCS'), nseEquity('INFY')],
      eligible: 2,
      deps: {
        skipEvidence: true,
        skipOnchain: true,
        skipSocial: true,
        concurrency: 1,
        fetchNseQuote: async (symbol) => nseQuote(symbol),
        fetchNseCandles: async () => dailyBars(20),
        onHydrateProgress: (done, total) => ticks.push([done, total]),
      },
    });
    expect(ticks).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('overlays MDS statements/news after evidence and leaves pe/pb-only UNAVAILABLE', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'nse-mds-overlay',
      universeId: 'NIFTY500',
      instruments: [nseEquity('EMAMILTD'), nseEquity('TCS')],
      eligible: 2,
      deps: {
        skipEvidence: true,
        skipOnchain: true,
        skipSocial: true,
        fetchNseQuote: async (symbol) => nseQuote(symbol),
        fetchNseCandles: async () => dailyBars(20),
        nseMdsEvidence: {
          fundamentalsRows: [
            {
              symbol: 'EMAMILTD',
              roe: 16,
              revenue: 500,
              as_of_date: '2026-09-01T00:00:00.000Z',
              source: 'nse-fundamentals',
            },
            { symbol: 'TCS', trailing_pe: 28, price_to_book: 9 },
          ],
          newsRows: [
            { symbol: 'EMAMILTD', news_count_7d: 3, news_sent_7d: 0 },
            { symbol: 'TCS', news_count_7d: 0, news_sent_7d: null },
          ],
        },
      },
    });
    const emami = snapshot.instruments.find((row) => row.instrumentRef.symbol === 'EMAMILTD');
    const tcs = snapshot.instruments.find((row) => row.instrumentRef.symbol === 'TCS');
    expect(emami?.fundamentals?.kind).toBe('EQUITY_STATEMENTS');
    expect(emami?.news?.headlineCount).toBe(3);
    expect(emami?.sentiment).toEqual({ source: 'MODEL_DERIVED', score: 0 });
    expect(tcs?.fundamentals?.kind).toBe('UNAVAILABLE');
    expect(tcs?.sentiment).toBeNull();
    expect(
      snapshot.capabilityCoverage?.find((row) => row.capability === 'fundamentals')?.available,
    ).toBe(1);
    expect(snapshot.capabilityCoverage?.find((row) => row.capability === 'news')?.available).toBe(
      1,
    );
    expect(
      snapshot.capabilityCoverage?.find((row) => row.capability === 'sentiment')?.available,
    ).toBe(1);
  });

  it('panel error overlay is non-fatal and keeps hydrate AVAILABLE', async () => {
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'nse-mds-panel-error',
      universeId: 'NIFTY50',
      instruments: [nseEquity('INFY')],
      eligible: 1,
      deps: {
        skipEvidence: true,
        skipOnchain: true,
        skipSocial: true,
        fetchNseQuote: async () => nseQuote('INFY'),
        fetchNseCandles: async () => dailyBars(20),
        nseMdsEvidence: {
          fundamentalsRows: [],
          newsRows: [],
          fundamentalsUnavailableReason: 'MDS_FUNDAMENTALS_PANEL_ERROR',
          newsUnavailableReason: 'MDS_NEWS_PANEL_ERROR',
        },
      },
    });
    expect(snapshot.instruments[0]?.dataStatus).toBe('AVAILABLE');
    expect(snapshot.instruments[0]?.fundamentals?.kind).toBe('UNAVAILABLE');
    expect(report.readiness).not.toBeUndefined();
  });

  it('does not issue one GDELT HTTP call per NSE symbol', async () => {
    const gdelt = jest.fn();
    await hydrateBatchDataSnapshot({
      batchId: 'nse-no-gdelt-fanout',
      universeId: 'NSE_ALL',
      instruments: [nseEquity('RELIANCE'), nseEquity('TCS')],
      eligible: 2,
      deps: {
        skipOnchain: true,
        skipSocial: true,
        fetchNseQuote: async (symbol) => nseQuote(symbol),
        fetchNseCandles: async () => dailyBars(20),
        evidenceFetchJson: async (url) => {
          if (String(url).includes('gdeltproject.org')) {
            gdelt(url);
            return { articles: [] };
          }
          return {};
        },
      },
    });
    expect(gdelt).not.toHaveBeenCalled();
  });
});
