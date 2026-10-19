/**
 * F3 — MCX/CME machine-readable JSON feeds only.
 * HTML is SCRAPE_FORBIDDEN. FUTURES_ALL stays GENERIC_FUTURES_UNSUPPORTED.
 * No TD commodity endpoints. No scrape.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { InstrumentRef } from '@stockpred/shared-types';
import {
  hydrateBatchDataSnapshot,
  parseApprovedFuturesHydrateFeed,
  selectBatchProvider,
  universeForcesNotReady,
} from './index';
import { looksLikeHtml, futuresContractIdentity } from './approved-futures-feed';

function mcxGold(): InstrumentRef {
  return {
    symbol: 'GOLD26',
    assetClass: 'COMMODITY_FUTURE',
    venue: 'MCX',
    quoteCurrency: 'INR',
    underlying: 'GOLD',
    contractMonth: '2026-04',
    contractType: 'MONTHLY',
  };
}

function cmeGold(): InstrumentRef {
  return {
    symbol: 'GCJ26',
    assetClass: 'COMMODITY_FUTURE',
    venue: 'CME',
    quoteCurrency: 'USD',
    underlying: 'GC',
    contractMonth: '2026-04',
    contractType: 'MONTHLY',
  };
}

const MCX_FEED = JSON.stringify({
  session: { status: 'OPEN' },
  contracts: [
    {
      symbol: 'GOLD26',
      underlying: 'GOLD',
      venue: 'MCX',
      contractMonth: '2026-04',
      contractType: 'MONTHLY',
      asOf: 1_710_000_000_000,
      quote: { price: 72000, change: 120, changePercent: 0.17, volume: 42 },
      candles: [
        { time: 1_710_000_000, open: 71000, high: 72500, low: 70800, close: 72000, volume: 10 },
      ],
    },
  ],
});

const CME_FEED = JSON.stringify({
  session: { status: 'OPEN' },
  contracts: [
    {
      symbol: 'GCJ26',
      underlying: 'GC',
      venue: 'CME',
      contractMonth: '2026-04',
      contractType: 'MONTHLY',
      asOf: 1_710_000_000_000,
      quote: { price: 2350.4, volume: 1200 },
      candles: [
        { time: 1_710_000_000, open: 2340, high: 2360, low: 2338, close: 2350.4, volume: 88 },
      ],
    },
  ],
});

describe('F3 approved MCX/CME futures feed', () => {
  it('keeps MCX/CME NOT_READY until a validated JSON feed exists; no fetch', async () => {
    expect(universeForcesNotReady('MCX_FUTURES_ALL')).toBe('MCX_FUTURES_NO_APPROVED_FEED');
    expect(universeForcesNotReady('CME_FUTURES_ALL')).toBe('CME_FUTURES_NO_APPROVED_FEED');
    const fetchJson = jest.fn(async () => {
      throw new Error('should not scrape');
    });
    const fetchText = jest.fn(async () => {
      throw new Error('should not scrape');
    });
    const { report } = await hydrateBatchDataSnapshot({
      batchId: 'f3-none',
      universeId: 'MCX_FUTURES_ALL',
      instruments: [mcxGold()],
      deps: { fetchJson, fetchText, env: {} },
    });
    expect(report.readiness).toBe('NOT_READY');
    expect(fetchJson).not.toHaveBeenCalled();
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('FUTURES_ALL stays GENERIC_FUTURES_UNSUPPORTED even if a feed is ready', () => {
    expect(universeForcesNotReady('FUTURES_ALL', { approvedFuturesFeedReady: true })).toBe(
      'GENERIC_FUTURES_UNSUPPORTED',
    );
    expect(selectBatchProvider('FUTURES_ALL', [], { approvedFuturesFeedReady: true }).reason).toBe(
      'GENERIC_FUTURES_UNSUPPORTED',
    );
  });

  it('rejects HTML as SCRAPE_FORBIDDEN and never treats it as quotes', async () => {
    expect(looksLikeHtml('<html><body>GOLD 72000</body></html>')).toBe(true);
    const fetchText = jest.fn(
      async () => '<!doctype html><html><head></head><body>GOLD</body></html>',
    );
    const fetchJson = jest.fn(async () => {
      throw new Error('json scrape path must not run');
    });
    const { report, snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f3-html',
      universeId: 'MCX_FUTURES_ALL',
      instruments: [mcxGold()],
      deps: {
        fetchJson,
        fetchText,
        approvedFuturesFeedUrl: 'https://example.invalid/mcx-watch',
      },
    });
    expect(report.readiness).toBe('NOT_READY');
    expect(report.reasons).toContain('SCRAPE_FORBIDDEN');
    expect(snapshot.instruments[0]?.reasonCode).toBe('SCRAPE_FORBIDDEN');
    expect(snapshot.instruments[0]?.quote).toBeUndefined();
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(snapshot.frozen).toBe(true);
  });

  it('hydrates MCX from validated JSON: identity, quotes, candles, session, then freeze', async () => {
    const fetchText = jest.fn(async () => MCX_FEED);
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'f3-mcx-ok',
      universeId: 'MCX_FUTURES_ALL',
      instruments: [mcxGold()],
      deps: {
        fetchText,
        approvedFuturesFeedUrl: 'https://feeds.example.invalid/mcx.json',
        now: () => 1_710_000_100_000,
      },
    });
    expect(report.readiness).toBe('READY');
    expect(snapshot.provider).toBe('approved-futures-feed');
    expect(snapshot.frozen).toBe(true);
    const row = snapshot.instruments[0];
    expect(row?.dataStatus).toBe('AVAILABLE');
    expect(row?.quote?.price).toBe(72000);
    expect(row?.candles?.[0]?.close).toBe(72000);
    expect(row?.instrumentRef.providerAssetId).toBe(
      futuresContractIdentity({
        symbol: 'GOLD26',
        venue: 'MCX',
        underlying: 'GOLD',
        contractMonth: '2026-04',
        contractType: 'MONTHLY',
      }),
    );
    expect(row?.source).toBe('SOURCE_REPORTED');
    expect(snapshot.marketSession?.venue).toBe('MCX');
    expect(snapshot.marketSession?.timezone).toBe('Asia/Kolkata');
    expect(snapshot.marketSession?.isTradable).toBe(false);
    expect(snapshot.marketSession?.assetClass).toBe('COMMODITY_FUTURE');
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText).toHaveBeenCalledWith('https://feeds.example.invalid/mcx.json');
  });

  it('keeps MCX and CME universes separate', async () => {
    const { snapshot: mcxSnap } = await hydrateBatchDataSnapshot({
      batchId: 'f3-sep-mcx',
      universeId: 'MCX_FUTURES_ALL',
      instruments: [mcxGold()],
      deps: { approvedFuturesFeedBody: CME_FEED },
    });
    expect(mcxSnap.instruments[0]?.reasonCode).toBe('NO_VALID_CONTRACTS');
    expect(mcxSnap.coverage.readiness).toBe('NOT_READY');

    const { snapshot: cmeSnap, report } = await hydrateBatchDataSnapshot({
      batchId: 'f3-sep-cme',
      universeId: 'CME_FUTURES_ALL',
      instruments: [cmeGold()],
      deps: { approvedFuturesFeedBody: CME_FEED },
    });
    expect(report.readiness).toBe('READY');
    expect(cmeSnap.provider).toBe('approved-futures-feed');
    expect(cmeSnap.instruments[0]?.dataStatus).toBe('AVAILABLE');
    expect(cmeSnap.instruments[0]?.quote?.price).toBe(2350.4);
    expect(cmeSnap.marketSession?.venue).toBe('CME');
    expect(cmeSnap.marketSession?.timezone).toBe('America/Chicago');
    expect(cmeSnap.marketSession?.isTradable).toBe(false);
  });

  it('missing quote stays UNAVAILABLE / DATA_INCOMPLETE — never numeric 0', () => {
    const parsed = parseApprovedFuturesHydrateFeed(
      JSON.stringify({
        contracts: [
          {
            symbol: 'SILVER26',
            underlying: 'SILVER',
            venue: 'MCX',
            contractMonth: '2026-05',
            contractType: 'MONTHLY',
            quote: { price: 0 },
          },
        ],
      }),
      'MCX_FUTURES_ALL',
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.contracts[0]?.quote).toBeUndefined();
  });

  it('hydrate leaves missing quotes UNAVAILABLE, not filled 0', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f3-no-quote',
      universeId: 'MCX_FUTURES_ALL',
      instruments: [
        {
          symbol: 'SILVER26',
          assetClass: 'COMMODITY_FUTURE',
          venue: 'MCX',
          quoteCurrency: 'INR',
          underlying: 'SILVER',
          contractMonth: '2026-05',
          contractType: 'MONTHLY',
        },
      ],
      deps: {
        approvedFuturesFeedBody: JSON.stringify({
          contracts: [
            {
              symbol: 'SILVER26',
              underlying: 'SILVER',
              venue: 'MCX',
              contractMonth: '2026-05',
              contractType: 'MONTHLY',
            },
          ],
        }),
      },
    });
    const row = snapshot.instruments[0];
    expect(row?.dataStatus).toBe('UNAVAILABLE');
    expect(row?.reasonCode).toBe('DATA_INCOMPLETE');
    expect(row?.quote).toBeUndefined();
  });

  it('delayed approved feed hydrates PARTIAL, not invented live quotes', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f3-delayed',
      universeId: 'MCX_FUTURES_ALL',
      instruments: [mcxGold()],
      deps: {
        approvedFuturesFeedBody: JSON.stringify({
          contracts: [
            {
              symbol: 'GOLD26',
              underlying: 'GOLD',
              venue: 'MCX',
              contractMonth: '2026-04',
              contractType: 'MONTHLY',
              delayed: true,
              asOf: 1_710_000_000_000,
              quote: { price: 72000 },
            },
          ],
        }),
        now: () => 1_710_000_100_000,
      },
    });
    expect(snapshot.instruments[0]?.dataStatus).toBe('PARTIAL');
    expect(snapshot.instruments[0]?.reasonCode).toBe('DELAYED_FEED');
    expect(snapshot.instruments[0]?.quote?.price).toBe(72000);
    expect(snapshot.marketSession?.dataStatus).toBe('DELAYED');
  });

  it('COMMODITY products stay off the MCX/CME feed path (F4 not started)', () => {
    const selection = selectBatchProvider(
      'COMMODITY_ALL',
      [{ assetClass: 'COMMODITY', venue: 'ALPHA_VANTAGE' }],
      { approvedFuturesFeedReady: true },
    );
    expect(selection.provider).toBe('keyless-commodity+eia-bulk');
    expect(selection.reason).toBe('TWELVE_DATA_REQUIRES_GROW');
    const td = readFileSync(join(__dirname, 'twelve-data-client.ts'), 'utf8');
    expect(td).not.toMatch(/['"`]\/commodit/i);
  });
});
