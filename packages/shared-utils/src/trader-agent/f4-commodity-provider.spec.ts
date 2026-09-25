/**
 * F4 — commodity products via Yahoo+EIA. No TD commodity endpoints.
 * COMMODITY ≠ COMMODITY_FUTURE ≠ MCX ≠ CME. Missing stays UNAVAILABLE, never 0.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { InstrumentRef } from '@stockpred/shared-types';
import {
  assertTwelveDataSafePath,
  hydrateBatchDataSnapshot,
  lookupCommodityKeylessSeries,
  selectBatchProvider,
  TWELVE_DATA_REQUIRES_GROW,
} from './index';

function product(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'COMMODITY',
    venue: 'ALPHA_VANTAGE',
    quoteCurrency: 'USD',
    canonicalSymbol: symbol,
    providerAssetId: symbol,
    contractType: 'PRODUCT',
    underlying: symbol,
  };
}

function yahooWti(url: string): unknown {
  if (!url.includes('CL=F')) throw new Error(`unexpected commodity url ${url}`);
  return {
    chart: {
      result: [
        {
          timestamp: [1_700_000_000],
          meta: { regularMarketPrice: 73.2 },
          indicators: {
            quote: [{ open: [73], high: [74], low: [72], close: [73.2], volume: [1] }],
          },
        },
      ],
    },
  };
}

describe('F4 commodity product provider', () => {
  it('selects keyless Yahoo+EIA and keeps TWELVE_DATA_REQUIRES_GROW', () => {
    const selection = selectBatchProvider('COMMODITY_ALL', [
      { assetClass: 'COMMODITY', venue: 'ALPHA_VANTAGE' },
    ]);
    expect(selection.provider).toBe('keyless-commodity+eia-bulk');
    expect(selection.reason).toBe(TWELVE_DATA_REQUIRES_GROW);
  });

  it('forbids Twelve Data commodity endpoints', () => {
    expect(() => assertTwelveDataSafePath('/commodities')).toThrow(TWELVE_DATA_REQUIRES_GROW);
    expect(() => assertTwelveDataSafePath('/commodity')).toThrow(TWELVE_DATA_REQUIRES_GROW);
    const td = readFileSync(join(__dirname, 'twelve-data-client.ts'), 'utf8');
    expect(td).not.toMatch(/this\.url\(\s*['"`]\/commodit/i);
    expect(td).toMatch(/FORBIDDEN_COMMODITY_PATH/);
  });

  it('hydrates WTI as a product with EIA economics, then freeze — never MCX/CME', async () => {
    const fetchText = jest.fn(async () => {
      throw new Error('approved futures must not run for COMMODITY_ALL');
    });
    const { snapshot, report } = await hydrateBatchDataSnapshot({
      batchId: 'f4-wti',
      universeId: 'COMMODITY_ALL',
      instruments: [product('WTI')],
      deps: {
        fetchJson: async (url) => yahooWti(url),
        fetchText,
        eiaSeries: { 'PET.RWTC.D': [{ t: 1_700_000_000_000, v: 73.1 }] },
        now: () => 1_700_000_100_000,
      },
    });
    expect(report.readiness).toBe('READY');
    expect(snapshot.frozen).toBe(true);
    expect(snapshot.provider).toBe('keyless-commodity+eia-bulk');
    expect(snapshot.providerSelectionReason).toBe(TWELVE_DATA_REQUIRES_GROW);
    const row = snapshot.instruments[0];
    expect(row?.dataStatus).toBe('AVAILABLE');
    expect(row?.quote?.price).toBe(73.2);
    expect(row?.instrumentRef.assetClass).toBe('COMMODITY');
    expect(row?.instrumentRef.contractType).toBe('PRODUCT');
    expect(row?.instrumentRef.contractMonth).toBeUndefined();
    expect(row?.fundamentals).toEqual(
      expect.objectContaining({ kind: 'COMMODITY_ECONOMICS', seriesId: 'PET.RWTC.D' }),
    );
    expect(row?.seriesProvenance?.fallbackUsed).toBe(true);
    expect(row?.seriesProvenance?.providerSelectionReason).toBe(TWELVE_DATA_REQUIRES_GROW);
    expect(row?.onchain).toBeUndefined();
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('missing catalog product stays UNAVAILABLE — never numeric 0', async () => {
    expect(lookupCommodityKeylessSeries(product('ALUMINUM'))).toBeNull();
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f4-alum',
      universeId: 'COMMODITY_ALL',
      instruments: [product('ALUMINUM')],
      deps: {
        fetchJson: async () => {
          throw new Error('no yahoo series');
        },
      },
    });
    const row = snapshot.instruments[0];
    expect(row?.dataStatus).toBe('UNAVAILABLE');
    expect(row?.reasonCode).toBe('NO_PROVIDER_DATA');
    expect(row?.quote).toBeUndefined();
  });

  it('COMMODITY_FUTURE / MCX month is not a commodity product', async () => {
    const fetchJson = jest.fn(async () => {
      throw new Error('must not fetch Yahoo for MCX contract');
    });
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f4-mcx-mix',
      universeId: 'COMMODITY_ALL',
      instruments: [
        {
          symbol: 'GOLD26',
          assetClass: 'COMMODITY_FUTURE',
          venue: 'MCX',
          quoteCurrency: 'INR',
          underlying: 'GOLD',
          contractMonth: '2026-04',
          contractType: 'MONTHLY',
        },
      ],
      deps: { fetchJson },
    });
    expect(snapshot.instruments[0]?.reasonCode).toBe('IDENTITY_MISMATCH');
    expect(snapshot.instruments[0]?.quote).toBeUndefined();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('zero EIA / Yahoo price is not filled as 0', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f4-zero',
      universeId: 'COMMODITY_ALL',
      instruments: [product('WTI')],
      deps: {
        fetchJson: async () => ({
          chart: {
            result: [
              {
                timestamp: [1_700_000_000],
                meta: { regularMarketPrice: 0 },
                indicators: {
                  quote: [{ open: [0], high: [0], low: [0], close: [0], volume: [0] }],
                },
              },
            ],
          },
        }),
        eiaSeries: { 'PET.RWTC.D': [{ t: 1_700_000_000_000, v: 0 }] },
      },
    });
    expect(snapshot.instruments[0]?.dataStatus).toBe('UNAVAILABLE');
    expect(snapshot.instruments[0]?.quote).toBeUndefined();
  });

  it('does not start TD commodity hydrate', () => {
    const hydrate = readFileSync(join(__dirname, 'batch-data-hydrate.ts'), 'utf8');
    expect(hydrate).not.toMatch(/api\.twelvedata\.com\/commodit/i);
  });
});
