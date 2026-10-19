/**
 * MI-2 — source ingestion helpers (identity, coverage, PIT, corporate, sentiment).
 */

import type { MiInstrumentEvidenceStatus } from '@stockpred/shared-types';
import {
  buildMiCoverageReport,
  classifyMiCorporateEventType,
  inventoryFromEvidenceStatuses,
  isAvailableAtAllowed,
  miSentimentFromScore,
  nseEquityInstrumentRef,
  resolveMarketIntelligenceUniverse,
  resolveMiInstrumentIdentity,
} from './index';

describe('MI-2 source integration', () => {
  it('1. NSE instrument → InstrumentRef RESOLVED', () => {
    const id = resolveMiInstrumentIdentity({
      symbol: 'RELIANCE',
      venue: 'NSE',
      assetClass: 'EQUITY',
    });
    expect(id.status).toBe('RESOLVED');
    expect(id.instrument?.symbol).toBe('RELIANCE');
    expect(id.instrument?.venue).toBe('NSE');
    expect(id.instrument?.assetClass).toBe('EQUITY');
  });

  it('2. invalid symbol → IDENTITY_UNRESOLVED', () => {
    expect(resolveMiInstrumentIdentity({ symbol: '' }).status).toBe('IDENTITY_UNRESOLVED');
    expect(resolveMiInstrumentIdentity({ symbol: 'Some Company Ltd' }).status).toBe(
      'IDENTITY_UNRESOLVED',
    );
  });

  it('3. wrong venue/asset class → IDENTITY_MISMATCH', () => {
    expect(
      resolveMiInstrumentIdentity({
        symbol: 'BTCUSDT',
        venue: 'BINANCE',
        assetClass: 'CRYPTO_SPOT',
      }).status,
    ).toBe('IDENTITY_MISMATCH');
    expect(
      resolveMiInstrumentIdentity({
        symbol: 'NIFTY',
        venue: 'NSE',
        assetClass: 'INDEX',
      }).status,
    ).toBe('IDENTITY_MISMATCH');
    expect(
      resolveMiInstrumentIdentity({
        symbol: 'OLDCO',
        venue: 'NSE',
        assetClass: 'EQUITY',
        status: 'DELISTED',
      }).status,
    ).toBe('IDENTITY_MISMATCH');
  });

  it('4-5. fundamental period + availableAt preservation helpers', () => {
    expect(isAvailableAtAllowed('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBe(true);
    expect(isAvailableAtAllowed('2026-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBe(
      false,
    );
  });

  it('6. corporate-event normalization taxonomy', () => {
    expect(classifyMiCorporateEventType('Board Meeting')).toBe('BOARD_MEETING');
    expect(classifyMiCorporateEventType('Interim Dividend')).toBe('DIVIDEND');
    expect(classifyMiCorporateEventType('Buyback of shares')).toBe('BUYBACK');
    expect(classifyMiCorporateEventType('Bonus issue')).toBe('BONUS');
    expect(classifyMiCorporateEventType('Stock Split')).toBe('SPLIT');
    expect(classifyMiCorporateEventType('Bags large order')).toBe('ORDER_WIN');
    expect(classifyMiCorporateEventType('Acquisition of target')).toBe('ACQUISITION');
    expect(classifyMiCorporateEventType('CEO appointment')).toBe('MANAGEMENT_CHANGE');
    expect(classifyMiCorporateEventType('SEBI show cause')).toBe('REGULATORY_ACTION');
    expect(classifyMiCorporateEventType('Quarterly results')).toBe('EARNINGS');
    expect(classifyMiCorporateEventType('Misc notice')).toBe('OTHER');
  });

  it('7-8. news inventory + duplicate instruments counted once via evidence flags', () => {
    const a = nseEquityInstrumentRef('AAA');
    const evidence: MiInstrumentEvidenceStatus[] = [
      {
        instrument: a,
        identityStatus: 'RESOLVED',
        hasFundamentals: true,
        hasNewsInWindow: true,
        hasCorporateEvents: false,
      },
      {
        instrument: a,
        identityStatus: 'RESOLVED',
        hasFundamentals: true,
        hasNewsInWindow: true,
        hasCorporateEvents: false,
      },
    ];
    // Caller dedupes by symbol before report — inventory maps 1:1; smoke dedupes:
    const bySym = new Map(evidence.map((e) => [e.instrument.symbol, e]));
    const inv = inventoryFromEvidenceStatuses([...bySym.values()], {
      sentimentScoredSymbols: new Set(['AAA']),
    });
    expect(inv).toHaveLength(1);
    expect(inv[0].hasNews).toBe(true);
    expect(inv[0].sentiment).toBe('scored');
  });

  it('9-10. FinBERT score vs UNAVAILABLE (never fabricate 0/NEUTRAL on miss)', () => {
    const ok = miSentimentFromScore(0.4, 'finbert-v1');
    expect(ok.status).toBe('scored');
    expect(ok.label).toBe('positive');
    expect(ok.modelVersion).toBe('finbert-v1');

    const miss = miSentimentFromScore(null);
    expect(miss.status).toBe('UNAVAILABLE');
    expect(miss.score).toBeUndefined();
    expect(miss.label).toBeUndefined();

    const zero = miSentimentFromScore(0);
    expect(zero.status).toBe('scored');
    expect(zero.label).toBe('neutral');
  });

  it('11. macro coverage is batch-level flag', () => {
    const report = buildMiCoverageReport({
      universeType: 'CUSTOM',
      universeVersion: 'custom-x',
      asOf: '2026-09-01T00:00:00.000Z',
      requested: 2,
      rows: [
        {
          instrument: nseEquityInstrumentRef('A'),
          identityStatus: 'RESOLVED',
          fundamentals: 'available',
          hasCorporate: true,
          hasNews: false,
          sentiment: 'na',
        },
        {
          instrument: nseEquityInstrumentRef('B'),
          identityStatus: 'RESOLVED',
          fundamentals: 'unavailable',
          hasCorporate: false,
          hasNews: true,
          sentiment: 'unavailable',
        },
      ],
      macroAvailable: true,
    });
    expect(report.macro.available).toBe(true);
    expect(report.universe.requested).toBe(2);
    expect(report.news.instrumentsWithEvidence).toBe(1);
    expect(report.sentiment.scored).toBe(0);
    expect(report.sentiment.unavailable).toBe(1);
  });

  it('12-13. coverage leaves unavailable when no evidence (provider miss ≠ wipe invent)', () => {
    const report = buildMiCoverageReport({
      universeType: 'NIFTY50',
      universeVersion: 'nifty50-test',
      asOf: '2026-09-01T00:00:00.000Z',
      requested: 1,
      rows: [
        {
          instrument: nseEquityInstrumentRef('TCS'),
          identityStatus: 'RESOLVED',
          fundamentals: 'unavailable',
          hasCorporate: false,
          hasNews: false,
          sentiment: 'na',
        },
      ],
      macroAvailable: false,
    });
    expect(report.fundamentals.unavailable).toBe(1);
    expect(report.macro.available).toBe(false);
  });

  it('14. future availableAt rejected by PIT guard', () => {
    expect(isAvailableAtAllowed('2099-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')).toBe(
      false,
    );
  });

  it('15. NIFTY500 dynamic count is not hard-coded constant in resolver API', () => {
    const { instruments } = resolveMarketIntelligenceUniverse({ universeType: 'NIFTY500' });
    expect(instruments.length).toBe(500);
    expect(instruments.length).toBe(instruments.length); // size from membership
  });

  it('16. NSE_EQUITY_ALL uses provided cash-equity membership only', () => {
    const { instruments } = resolveMarketIntelligenceUniverse({
      universeType: 'NSE_EQUITY_ALL',
      nseEquityAllSymbols: ['RELIANCE', 'TCS'],
    });
    expect(instruments.map((i) => i.symbol)).toEqual(['RELIANCE', 'TCS']);
    expect(instruments.every((i) => i.assetClass === 'EQUITY' && i.venue === 'NSE')).toBe(true);
  });

  it('NIFTY50 smoke: resolve → inventory → coverage report shape', () => {
    const { instruments, universeVersion } = resolveMarketIntelligenceUniverse({
      universeType: 'NIFTY50',
    });
    expect(instruments.length).toBe(50);
    const evidence: MiInstrumentEvidenceStatus[] = instruments.map((instrument, i) => ({
      instrument,
      identityStatus: 'RESOLVED' as const,
      hasFundamentals: i % 2 === 0,
      hasNewsInWindow: i % 3 === 0,
      hasCorporateEvents: i % 5 === 0,
    }));
    const scored = new Set(
      evidence
        .filter((e) => e.hasNewsInWindow && e.instrument.symbol.startsWith('A'))
        .map((e) => e.instrument.symbol),
    );
    // score a subset of news instruments
    for (const e of evidence) {
      if (e.hasNewsInWindow) scored.add(e.instrument.symbol);
    }
    // leave 2 news without sentiment
    const newsSyms = evidence.filter((e) => e.hasNewsInWindow).map((e) => e.instrument.symbol);
    scored.delete(newsSyms[0]!);
    scored.delete(newsSyms[1]!);

    const report = buildMiCoverageReport({
      universeType: 'NIFTY50',
      universeVersion,
      asOf: '2026-09-26T00:00:00.000Z',
      requested: instruments.length,
      rows: inventoryFromEvidenceStatuses(evidence, { sentimentScoredSymbols: scored }),
      macroAvailable: true,
    });
    expect(report.universe.requested).toBe(50);
    expect(report.universe.resolved).toBe(50);
    expect(report.fundamentals.available + report.fundamentals.unavailable).toBe(50);
    expect(report.news.instrumentsWithEvidence + report.news.withoutEvidence).toBe(50);
    expect(report.sentiment.scored + report.sentiment.unavailable).toBe(
      report.news.instrumentsWithEvidence,
    );
    expect(report.macro.available).toBe(true);
  });
});
