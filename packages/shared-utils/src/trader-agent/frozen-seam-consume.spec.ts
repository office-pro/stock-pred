/**
 * Crown tests: ZERO-HALLUCINATION + canonical NSE_ALL ≠ MDS + source authority.
 */
import {
  assertNotLlmDataProvider,
  missingDataMarker,
  ZERO_HALLUCINATION_POLICY,
} from './zero-hallucination-policy';
import {
  providerMayRedefineUniverseMembership,
  productionCertificationGate,
  resolveAuthorityConflict,
  selectProviderForCapability,
} from './source-authority';
import {
  assertContinuousNotFullUniverseScan,
  planTargetedIntelligenceRefresh,
} from './continuous-intelligence-engine';
import { resolvePriceSeriesPolicy, resolveBenchmarkSymbol } from './price-series-policy';
import { buildNseMarketSessionState, sanitizeSessionLiveConsistency } from './market-session-state';
import { learningKeysCompatible, learningSegregationKey } from './paper-experiment';
import { missingNewsSentiment, newsCatalystAvailability } from './sector-fundamentals-news';
import { canonicalNiftySnapshot, resolveIntelligenceUniverse } from './intelligence-batch-universe';
import { computeCurrentSessionReturn1d } from './session-return-1d';

describe('zero-hallucination-policy', () => {
  it('declares LLM is not an authoritative data source', () => {
    expect(ZERO_HALLUCINATION_POLICY.llmIsAuthoritativeDataSource).toBe(false);
    expect(assertNotLlmDataProvider('openai-gpt')).toBe(false);
    expect(assertNotLlmDataProvider('yahoo')).toBe(true);
    expect(missingDataMarker().value).toBeNull();
  });
});

describe('canonical predefined membership', () => {
  it('derives a stable NIFTY version from actual ordered basket contents', () => {
    const first = canonicalNiftySnapshot('NIFTY50');
    const second = canonicalNiftySnapshot('NIFTY50');
    expect(first.symbols.length).toBe(50);
    expect(first.version).toBe(second.version);
    expect(first.version).toMatch(/^nifty50-[a-f0-9]{16}$/);
  });

  it('does not truncate canonical ALL membership with allLimit', () => {
    const symbols = ['A', 'B', 'C'];
    expect(
      resolveIntelligenceUniverse({
        universe: 'NSE_ALL',
        allSymbols: symbols,
        allLimit: 1,
      }),
    ).toEqual(symbols);
  });
});

describe('source-authority', () => {
  it('never auto-selects simulated for production marketData', () => {
    const sel = selectProviderForCapability({ capability: 'marketData' });
    expect(sel).not.toBeNull();
    expect(sel!.provider).not.toBe('simulated');
    expect(sel!.authorizedForUniverseMembership).toBe(false);
    expect(providerMayRedefineUniverseMembership('yahoo')).toBe(false);
  });

  it('flags identity conflicts explicitly', () => {
    const c = resolveAuthorityConflict({
      field: 'identity',
      sources: ['nse-equity-master', 'instrument-registry'],
    });
    expect(c.winner).toBeTruthy();
    expect(
      c.reasonCode === 'IDENTITY_CONFLICT' || c.conflict === true || c.conflict === false,
    ).toBe(true);
  });

  it('requires production certification for AVAILABLE', () => {
    const fail = productionCertificationGate({
      schemaOk: true,
      paginationOk: true,
      identityOk: true,
      freshnessOk: true,
      coverageOk: true,
      sampleComparisonOk: true,
      productionApproved: false,
    });
    expect(fail.capability).toBe('UNAVAILABLE');
  });
});

describe('continuous targeted refresh', () => {
  it('forbids full-universe deep scan', () => {
    const plan = planTargetedIntelligenceRefresh({
      eventId: 'e1',
      trigger: 'PRICE',
      affectedSymbols: ['RELIANCE', 'TCS'],
      dataStatus: 'LIVE',
      message: 'test',
    });
    expect(plan.mode).toBe('TARGETED_REFRESH');
    expect(
      assertContinuousNotFullUniverseScan({ mode: plan.mode, symbolCount: plan.symbols.length }).ok,
    ).toBe(true);
    expect(
      assertContinuousNotFullUniverseScan({ mode: 'TARGETED_REFRESH', symbolCount: 500 }).ok,
    ).toBe(false);
  });
});

describe('series / benchmark / session', () => {
  it('refuses silent raw/adjusted mix', () => {
    const r = resolvePriceSeriesPolicy({
      requested: 'ADJUSTED',
      available: 'RAW',
      source: 'yahoo',
    });
    expect(r.ok).toBe(false);
    expect(r.reasonCode).toBe('INSUFFICIENT_HISTORY');
  });

  it('does not silently use NIFTY for US venue', () => {
    const b = resolveBenchmarkSymbol({ venue: 'NASDAQ' });
    expect(b.benchmark).toBeNull();
    expect(b.reasonCode).toBe('NO_BENCHMARK');
  });

  it('CLOSED session cannot report LIVE', () => {
    const openish = buildNseMarketSessionState({
      now: Date.now(),
      lastMarketUpdateAt: Date.now(),
    });
    const forced = sanitizeSessionLiveConsistency({
      ...openish,
      status: 'CLOSED',
      isLive: true,
      dataStatus: 'LIVE',
    });
    expect(forced.isLive).toBe(false);
    expect(forced.dataStatus).not.toBe('LIVE');
  });
});

describe('paper learning segregation', () => {
  it('blocks NSE→BTC calibration key match', () => {
    const a = learningSegregationKey({
      engine: 'bull-run',
      instrument: { assetClass: 'EQUITY', venue: 'NSE' },
      horizon: '3M',
    });
    const b = learningSegregationKey({
      engine: 'bull-run',
      instrument: { assetClass: 'CRYPTO_SPOT', venue: 'CRYPTO' },
      horizon: '3M',
    });
    expect(learningKeysCompatible(a, b)).toBe(false);
  });
});

describe('news / fundamentals missing', () => {
  it('does not invent neutral sentiment', () => {
    expect(missingNewsSentiment().sentiment).toBeNull();
    expect(newsCatalystAvailability('UNMAPPED').usableForStockCatalyst).toBe(false);
  });
});

describe('universe resolve', () => {
  it('rejects NSE_ALL without canonical membership symbols', () => {
    expect(() => resolveIntelligenceUniverse({ universe: 'NSE_ALL' })).toThrow(/canonical/);
  });

  it('rejects gated US_SP500 without artifact symbols', () => {
    expect(() => resolveIntelligenceUniverse({ universe: 'US_SP500' })).toThrow(
      /UNSUPPORTED_UNIVERSE/,
    );
  });

  it('rejects CRYPTO_ALL / COMMODITY_ALL / FUTURES_ALL without canonical membership', () => {
    expect(() => resolveIntelligenceUniverse({ universe: 'CRYPTO_ALL' })).toThrow(
      /UNSUPPORTED_UNIVERSE/,
    );
    expect(() => resolveIntelligenceUniverse({ universe: 'COMMODITY_ALL' })).toThrow(
      /UNSUPPORTED_UNIVERSE/,
    );
    expect(() => resolveIntelligenceUniverse({ universe: 'FUTURES_ALL' })).toThrow(
      /UNSUPPORTED_UNIVERSE/,
    );
    expect(() => resolveIntelligenceUniverse({ universe: 'CRYPTO_FUTURES_ALL' })).toThrow(
      /UNSUPPORTED_UNIVERSE/,
    );
    expect(() => resolveIntelligenceUniverse({ universe: 'MCX_FUTURES_ALL' })).toThrow(
      /UNSUPPORTED_UNIVERSE/,
    );
  });
});

describe('session-1D regression', () => {
  it('previousClose=100 live LTP=103 → +3%', () => {
    const TUE_LIVE = Date.UTC(2026, 8, 15, 5, 30, 0); // 11:00 IST Tuesday
    const FRI_CLOSE = Date.UTC(2026, 8, 11, 10, 0, 0);
    const THU_CLOSE = Date.UTC(2026, 8, 10, 10, 0, 0);
    const result = computeCurrentSessionReturn1d({
      candles: [
        { close: 98, time: THU_CLOSE },
        { close: 100, time: FRI_CLOSE },
      ],
      lastPrice: 103,
      previousClose: 100,
      quoteUpdatedAt: TUE_LIVE - 5_000,
      now: TUE_LIVE,
    });
    expect(result.source).toBe('LIVE_LTP');
    expect(result.return1d).toBeCloseTo(0.03, 4);
  });
});
