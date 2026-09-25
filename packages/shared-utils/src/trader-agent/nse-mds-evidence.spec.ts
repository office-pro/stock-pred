import type { BatchInstrumentData, InstrumentRef } from '@stockpred/shared-types';
import { instrumentIdentityKey } from './instrument-registry';
import {
  MDS_FUNDAMENTALS_MISSING,
  MDS_FUNDAMENTALS_PANEL_ERROR,
  MDS_NEWS_PANEL_ERROR,
  hasEquityStatementsGate,
  indexPanelByInstrumentIdentity,
  overlayNseMdsEvidence,
  payloadFromNseFundamentalsPanel,
} from './nse-mds-evidence';

function nseEquity(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'EQUITY',
    venue: 'NSE',
    quoteCurrency: 'INR',
    canonicalSymbol: symbol,
  };
}

function usEquity(symbol: string): InstrumentRef {
  return {
    symbol,
    assetClass: 'EQUITY',
    venue: 'NASDAQ',
    quoteCurrency: 'USD',
    canonicalSymbol: symbol,
  };
}

function row(ref: InstrumentRef): BatchInstrumentData {
  return {
    instrumentRef: ref,
    quote: { price: 100 },
    dataStatus: 'AVAILABLE',
  };
}

describe('NSE MDS evidence overlay', () => {
  it('does not treat pe/pb-only as EQUITY_STATEMENTS', () => {
    const ratiosOnly = { symbol: 'EMAMILTD', trailing_pe: 22, price_to_book: 4.1 };
    expect(hasEquityStatementsGate(ratiosOnly)).toBe(false);
    const payload = payloadFromNseFundamentalsPanel(ratiosOnly);
    expect(payload.kind).toBe('UNAVAILABLE');
    expect(payload.kind === 'UNAVAILABLE' && payload.reasonCode).toBe(MDS_FUNDAMENTALS_MISSING);
  });

  it('emits EQUITY_STATEMENTS when revenue | netIncome | roe exists and keeps asOf', () => {
    const asOf = '2026-09-01T00:00:00.000Z';
    const payload = payloadFromNseFundamentalsPanel({
      symbol: 'EMAMILTD',
      trailing_pe: 22,
      roe: 18,
      revenue: 1_000,
      as_of_date: asOf,
      source: 'nse-fundamentals',
    });
    expect(payload.kind).toBe('EQUITY_STATEMENTS');
    if (payload.kind === 'EQUITY_STATEMENTS') {
      expect(payload.roe).toBe(18);
      expect(payload.revenue).toBe(1_000);
      expect(payload.pe).toBe(22);
      expect(payload.asOf).toBe(Date.parse(asOf));
    }
  });

  it('indexes by instrumentIdentityKey, not bare symbol', () => {
    const nse = nseEquity('EMAMILTD');
    const us = usEquity('EMAMILTD');
    const map = indexPanelByInstrumentIdentity([nse, us], [{ symbol: 'EMAMILTD', roe: 12 }]);
    expect(map.has(instrumentIdentityKey(nse))).toBe(true);
    expect(map.has(instrumentIdentityKey(us))).toBe(false);
    expect(map.has('EMAMILTD')).toBe(false);
  });

  it('preserves backend-reported sentiment 0 and treats null as unavailable', () => {
    const zero = overlayNseMdsEvidence([row(nseEquity('EMAMILTD'))], {
      fundamentalsRows: [{ symbol: 'EMAMILTD', roe: 15 }],
      newsRows: [{ symbol: 'EMAMILTD', news_count_7d: 4, news_sent_7d: 0 }],
    });
    expect(zero[0]?.news?.headlineCount).toBe(4);
    expect(zero[0]?.sentiment).toEqual({ source: 'MODEL_DERIVED', score: 0 });

    const missing = overlayNseMdsEvidence([row(nseEquity('TCS'))], {
      fundamentalsRows: [{ symbol: 'TCS', roe: 20 }],
      newsRows: [{ symbol: 'TCS', news_count_7d: 2, news_sent_7d: null }],
    });
    expect(missing[0]?.sentiment).toBeNull();
    expect(missing[0]?.news?.headlineCount).toBe(2);
  });

  it('panel error stamps UNAVAILABLE + reason and does not invent LIVE', () => {
    const [nse] = overlayNseMdsEvidence([row(nseEquity('INFY'))], {
      fundamentalsRows: [],
      newsRows: [],
      fundamentalsUnavailableReason: MDS_FUNDAMENTALS_PANEL_ERROR,
      newsUnavailableReason: MDS_NEWS_PANEL_ERROR,
    });
    expect(nse?.fundamentals?.kind).toBe('UNAVAILABLE');
    expect(nse?.fundamentals?.kind === 'UNAVAILABLE' && nse.fundamentals.reasonCode).toBe(
      MDS_FUNDAMENTALS_PANEL_ERROR,
    );
    expect(nse?.news?.reasonCode).toBe(MDS_NEWS_PANEL_ERROR);
    expect(nse?.sentiment).toBeNull();
    expect(nse?.dataStatus).toBe('AVAILABLE');
  });

  it('does not overlay US equity or crypto rows', () => {
    const crypto: InstrumentRef = {
      symbol: 'BTCUSDT',
      assetClass: 'CRYPTO_SPOT',
      venue: 'BINANCE',
      quoteCurrency: 'USDT',
      canonicalSymbol: 'BTCUSDT',
    };
    const out = overlayNseMdsEvidence([row(usEquity('AAPL')), row(crypto)], {
      fundamentalsRows: [
        { symbol: 'AAPL', roe: 40 },
        { symbol: 'BTCUSDT', roe: 1 },
      ],
      newsRows: [{ symbol: 'AAPL', news_count_7d: 9, news_sent_7d: 0.2 }],
    });
    expect(out[0]?.fundamentals).toBeUndefined();
    expect(out[1]?.fundamentals).toBeUndefined();
  });

  it('leaves rows unchanged when overlay input is omitted', () => {
    const input = [row(nseEquity('RELIANCE'))];
    expect(overlayNseMdsEvidence(input, undefined)[0]?.fundamentals).toBeUndefined();
  });
});
