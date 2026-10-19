import type { MiInstrumentEvidenceStatus } from '@stockpred/shared-types';
import {
  buildMiEvidenceFromMdsPanels,
  combineBatchPreflight,
  nseEquityInstrumentRef,
  resolveMarketIntelligenceRequirements,
  resolveMarketIntelligenceUniverse,
  resolveMiInstrumentIdentity,
  runMarketIntelligencePreflight,
} from './market-intelligence-core';
import { listEnabledMiProviders } from './market-intelligence-providers';
import {
  dedupeNormalizedNews,
  normalizeFundamentalFacts,
  normalizeNewsArticle,
} from './market-intelligence-normalize';

describe('market intelligence first slice', () => {
  it('resolves NIFTY500 size from canonical basket (not hard-coded constant in API)', () => {
    const { instruments, universeVersion } = resolveMarketIntelligenceUniverse({
      universeType: 'NIFTY500',
    });
    expect(instruments.length).toBe(500);
    expect(instruments[0].venue).toBe('NSE');
    expect(universeVersion).toMatch(/^nifty500-/);
  });

  it('resolves NIFTY200 as subset of NIFTY500', () => {
    const { instruments } = resolveMarketIntelligenceUniverse({ universeType: 'NIFTY200' });
    expect(instruments.length).toBe(200);
  });

  it('resolves CUSTOM and NSE_EQUITY_ALL from provided membership', () => {
    const custom = resolveMarketIntelligenceUniverse({
      universeType: 'CUSTOM',
      customSymbols: ['RELIANCE', 'TCS', 'INFY'],
    });
    expect(custom.instruments.map((i) => i.symbol)).toEqual(['RELIANCE', 'TCS', 'INFY']);
    expect(custom.instruments.length).toBe(3);

    const all = resolveMarketIntelligenceUniverse({
      universeType: 'NSE_EQUITY_ALL',
      nseEquityAllSymbols: Array.from({ length: 37 }, (_, i) => `S${i}`),
    });
    expect(all.instruments.length).toBe(37);
  });

  it('requirements requiredCount follows resolved universe', () => {
    const req = resolveMarketIntelligenceRequirements({
      universeType: 'CUSTOM',
      customSymbols: ['A', 'B', 'C', 'D'],
      mode: 'STANDARD',
    });
    expect(req.requiredCount).toBe(4);
    expect(req.fundamentals).toBe('required');
    expect(req.news).toBe('optional');
  });

  it('ADVANCED mode requires news and corporate events', () => {
    const req = resolveMarketIntelligenceRequirements({
      universeType: 'NIFTY50',
      mode: 'ADVANCED',
    });
    expect(req.news).toBe('required');
    expect(req.corporateEvents).toBe('required');
  });

  it('preflight PASS when required fundamentals complete; optional news warns', () => {
    const req = resolveMarketIntelligenceRequirements({
      universeType: 'CUSTOM',
      customSymbols: ['AAA', 'BBB'],
      mode: 'STANDARD',
      asOf: '2026-09-01T00:00:00.000Z',
    });
    const evidence: MiInstrumentEvidenceStatus[] = req.instruments.map((instrument) => ({
      instrument,
      identityStatus: 'RESOLVED',
      hasFundamentals: true,
      fundamentalsAvailableAt: '2026-08-31T12:00:00.000Z',
      hasNewsInWindow: false,
      hasCorporateEvents: false,
    }));
    const result = runMarketIntelligencePreflight({ requirements: req, evidence });
    expect(result.canRun).toBe(true);
    expect(result.coverage.fundamentals.coverage).toBe('COMPLETE');
    expect(result.coverage.fundamentals.freshness).toBe('CURRENT');
    expect(result.coverage.news.coverage).toBe('MISSING');
    expect(result.coverage.news.freshness).toBe('UNKNOWN');
    expect(result.warnings.some((w) => w.startsWith('NEWS_PARTIAL'))).toBe(true);
  });

  it('preflight BLOCK when required fundamentals missing', () => {
    const req = resolveMarketIntelligenceRequirements({
      universeType: 'CUSTOM',
      customSymbols: ['AAA', 'BBB'],
      mode: 'STANDARD',
      asOf: '2026-09-01T00:00:00.000Z',
    });
    const evidence: MiInstrumentEvidenceStatus[] = req.instruments.map((instrument) => ({
      instrument,
      identityStatus: 'RESOLVED',
      hasFundamentals: false,
      hasNewsInWindow: false,
      hasCorporateEvents: false,
    }));
    const result = runMarketIntelligencePreflight({ requirements: req, evidence });
    expect(result.canRun).toBe(false);
    expect(result.blockingReasons.some((r) => r.startsWith('FUNDAMENTALS_INSUFFICIENT'))).toBe(
      true,
    );
  });

  it('preflight BLOCK on future availableAt (look-ahead)', () => {
    const req = resolveMarketIntelligenceRequirements({
      universeType: 'CUSTOM',
      customSymbols: ['AAA'],
      mode: 'STANDARD',
      asOf: '2026-07-01T00:00:00.000Z',
    });
    const evidence: MiInstrumentEvidenceStatus[] = [
      {
        instrument: req.instruments[0],
        identityStatus: 'RESOLVED',
        hasFundamentals: true,
        fundamentalsAvailableAt: '2026-08-10T00:00:00.000Z',
        hasNewsInWindow: false,
        hasCorporateEvents: false,
      },
    ];
    const result = runMarketIntelligencePreflight({ requirements: req, evidence });
    expect(result.canRun).toBe(false);
    expect(result.blockingReasons.some((r) => r.startsWith('FUTURE_DATA_LEAKAGE'))).toBe(true);
  });

  it('combined preflight requires both market data and MI', () => {
    const req = resolveMarketIntelligenceRequirements({
      universeType: 'CUSTOM',
      customSymbols: ['AAA'],
      mode: 'STANDARD',
      asOf: '2026-09-01T00:00:00.000Z',
    });
    const mi = runMarketIntelligencePreflight({
      requirements: req,
      evidence: [
        {
          instrument: req.instruments[0],
          identityStatus: 'RESOLVED',
          hasFundamentals: true,
          fundamentalsAvailableAt: '2026-08-01T00:00:00.000Z',
          hasNewsInWindow: false,
          hasCorporateEvents: false,
        },
      ],
    });
    const blocked = combineBatchPreflight({
      marketData: {
        canRun: false,
        eligible: 1,
        quotesAvailable: 0,
        blockingReasons: ['QUOTES_INSUFFICIENT'],
      },
      marketIntelligence: mi,
    });
    expect(blocked.canRun).toBe(false);

    const ok = combineBatchPreflight({
      marketData: { canRun: true, eligible: 1, quotesAvailable: 1 },
      marketIntelligence: mi,
    });
    expect(ok.canRun).toBe(true);
  });

  it('identity resolution does not invent from free text', () => {
    expect(resolveMiInstrumentIdentity({ symbol: 'RELIANCE' }).status).toBe('RESOLVED');
    expect(resolveMiInstrumentIdentity({ symbol: 'Some Company Ltd' }).status).toBe(
      'IDENTITY_UNRESOLVED',
    );
    expect(
      resolveMiInstrumentIdentity({ symbol: 'BTC', venue: 'BINANCE', assetClass: 'CRYPTO_SPOT' })
        .status,
    ).toBe('IDENTITY_MISMATCH');
    expect(nseEquityInstrumentRef(' tcs ').symbol).toBe('TCS');
  });

  it('lists enabled providers without requiring TrueData key', () => {
    const list = listEnabledMiProviders();
    expect(list.fundamentals).toEqual(['nse']);
    expect(list.fundamentals).not.toContain('yahoo');
    expect(list.news).toEqual(expect.arrayContaining(['current', 'gdelt']));
  });

  it('records fundamental conflicts without silent overwrite', () => {
    const instrument = nseEquityInstrumentRef('TCS');
    const facts = normalizeFundamentalFacts(instrument, [
      {
        provenance: {
          instrument,
          source: 'nse',
          sourceType: 'NSE',
          evidenceKind: 'FUNDAMENTAL',
          availableAt: '2026-08-01T00:00:00.000Z',
          retrievedAt: '2026-08-01T00:00:00.000Z',
        },
        metric: 'roe',
        valueNative: 20,
        unitNative: 'pct',
      },
      {
        provenance: {
          instrument,
          source: 'yahoo',
          sourceType: 'YAHOO',
          evidenceKind: 'FUNDAMENTAL',
          availableAt: '2026-08-01T00:00:00.000Z',
          retrievedAt: '2026-08-01T00:00:00.000Z',
        },
        metric: 'roe',
        valueNative: 22,
        unitNative: 'pct',
      },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].conflict).toBe(true);
    expect(facts[0].value).toBeNull();
    expect(facts[0].values?.length).toBe(2);
  });

  it('dedupes news by event identity across sources', () => {
    const instrument = nseEquityInstrumentRef('INFY');
    const a = normalizeNewsArticle(instrument, {
      provenance: {
        instrument,
        source: 'current',
        sourceType: 'OTHER',
        evidenceKind: 'NEWS',
        availableAt: '2026-08-01T00:00:00.000Z',
        retrievedAt: '2026-08-01T00:00:00.000Z',
        publishedAt: '2026-08-01T00:00:00.000Z',
      },
      articleId: 'a1',
      title: 'Results beat estimates',
    });
    const b = normalizeNewsArticle(instrument, {
      provenance: {
        instrument,
        source: 'nse',
        sourceType: 'NSE',
        evidenceKind: 'NEWS',
        availableAt: '2026-08-01T01:00:00.000Z',
        retrievedAt: '2026-08-01T01:00:00.000Z',
        publishedAt: '2026-08-01T00:00:00.000Z',
      },
      articleId: 'a2',
      title: 'Results beat estimates',
    });
    const deduped = dedupeNormalizedNews([a, b]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sources.length).toBe(2);
  });

  it('builds evidence from MDS panels without fabricating corporate events', () => {
    const instruments = [nseEquityInstrumentRef('AAA'), nseEquityInstrumentRef('BBB')];
    const evidence = buildMiEvidenceFromMdsPanels({
      instruments,
      fundamentalsRows: [{ symbol: 'AAA', revenue: 1e9, available_at: '2026-08-01T00:00:00.000Z' }],
      newsRows: [{ symbol: 'BBB', news_count_7d: 3, available_at: '2026-08-02T00:00:00.000Z' }],
    });
    expect(evidence[0].hasFundamentals).toBe(true);
    expect(evidence[0].hasNewsInWindow).toBe(false);
    expect(evidence[1].hasFundamentals).toBe(false);
    expect(evidence[1].hasNewsInWindow).toBe(true);
    expect(evidence.every((e) => e.hasCorporateEvents === false)).toBe(true);
  });
});
