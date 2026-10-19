import {
  CryptoFuturesAdapter,
  CryptoSpotAdapter,
  CommodityProductAdapter,
  FuturesStubAdapter,
  NseEquityAdapter,
  UsEquityAdapter,
  adapterHorizonBars,
  resolveAssetAdapter,
} from './asset-adapter';
import {
  instrumentIdentityKey,
  mapProviderSymbolToInstrument,
  resolveInstrumentWithAdapter,
  DISCOVERED_PROVIDERS,
  isProductionMarketDataProvider,
  providerMayEstablishProductionCapability,
  providerAuthorizesExecution,
  providerSupports,
} from './instrument-registry';
import { buildBatchCapabilityCoverage, buildBatchResearchReport } from './batch-research-report';
import { buildBullRunV2FromEvidence } from './bull-run-v2-engine';
import { computeCurrentSessionReturn1d, sessionReturn1dToPercent } from './session-return-1d';
import {
  createPaperExperiment,
  learningTouchesRiskOrGate,
  loadPaperExperimentStore,
  recordPaperOutcome,
  appendLearningNote,
  registerCandidateModel,
} from './paper-experiment';
import { resolveIntelligenceUniverse } from './intelligence-batch-universe';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import type { IntelligenceBatchResultRow } from '@stockpred/shared-types';
import { Timeframe } from '@stockpred/shared-types';

describe('multi-asset foundation', () => {
  it('NseEquityAdapter preserves NIFTY benchmark and trading-day horizon bars', () => {
    const nse = new NseEquityAdapter();
    expect(nse.benchmarkId()).toBe('NIFTY50');
    expect(nse.productLabel()).toBe('BULL_RUN');
    expect(nse.resolveHorizon('1W').barCount).toBe(5);
    expect(nse.resolveHorizon('NEXT_CANDLE').barCount).toBeUndefined();
    expect(nse.resolveHorizon('NEXT_SESSION').definition.kind).toBe('NEXT_SESSION');
    expect(nse.capabilities().bullRun).toBe('AVAILABLE');
    expect(nse.capabilities().historicalCandles).toBe('AVAILABLE');
    const ref = nse.resolveInstrument('RELIANCE.NS');
    expect(ref.symbol).toBe('RELIANCE');
    expect(ref.venue).toBe('NSE');
    expect(ref.quoteCurrency).toBe('INR');
  });

  it('UsEquityAdapter gates bullRun UNAVAILABLE until live capabilities', () => {
    const us = new UsEquityAdapter();
    expect(us.capabilities().bullRun).toBe('UNAVAILABLE');
    expect(us.capabilities().historicalCandles).toBe('UNAVAILABLE');
    expect(us.withLiveCapabilities().bullRun).toBe('AVAILABLE');
    expect(us.withLiveCapabilities().historicalCandles).toBe('AVAILABLE');
    expect(us.benchmarkId()).toBe('SPX');
  });

  it('CryptoSpotAdapter is 24/7 and clock-hour horizons', () => {
    const c = new CryptoSpotAdapter();
    expect(c.isSessionOpen()).toBe(true);
    expect(c.temporalContext().sessionMode).toBe('ROLLING_24H');
    expect(c.resolveHorizon('1D').definition.calendarSemantics).toBe('CLOCK_HOURS');
    expect(c.capabilities().bullRun).toBe('UNAVAILABLE');
    expect(c.capabilities().marketData).toBe('AVAILABLE');
    expect(c.capabilities().historicalCandles).toBe('AVAILABLE');
  });

  it('CryptoFuturesAdapter keeps bullRun UNAVAILABLE even when candles exist', () => {
    const f = new CryptoFuturesAdapter();
    expect(f.capabilities().marketData).toBe('AVAILABLE');
    expect(f.capabilities().historicalCandles).toBe('AVAILABLE');
    expect(f.capabilities().bullRun).toBe('UNAVAILABLE');
    expect(f.capabilities().derivatives).toBe('PARTIAL');
    expect(f.capabilities().positioning).toBe('UNAVAILABLE');
    const series = f.normalizeSeries([
      {
        symbol: 'BTCUSDT:PERPETUAL',
        timeframe: Timeframe.ONE_DAY,
        time: 1,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      },
    ]);
    expect(series.closes).toEqual([1]);
    expect(f.capabilities().bullRun).toBe('UNAVAILABLE');
  });

  it('CommodityProductAdapter is PRODUCT identity, not an MCX/CME contract', () => {
    const c = new CommodityProductAdapter();
    expect(c.resolveInstrument('WTI').contractType).toBe('PRODUCT');
    expect(c.resolveInstrument('WTI').assetClass).toBe('COMMODITY');
    expect(c.capabilities().bullRun).toBe('UNAVAILABLE');
  });

  it('Futures stub requires SeriesProvenance and keeps historical UNAVAILABLE', () => {
    const f = new FuturesStubAdapter({
      id: 'commodity-future-stub-v1',
      assetClass: 'COMMODITY_FUTURE',
      venue: 'CME',
    });
    const series = f.normalizeSeries([]);
    expect(series.seriesProvenance.seriesType).toBe('INDIVIDUAL_CONTRACT');
    expect(series.seriesProvenance.contractSelectionPolicy).toBe('UNSPECIFIED');
    expect(f.capabilities().historicalAnalogues).toBe('UNAVAILABLE');
    expect(f.capabilities().bullRun).toBe('UNAVAILABLE');
  });

  it('cross-asset identity does not join on symbol alone', () => {
    const nse = mapProviderSymbolToInstrument('RELIANCE.NS');
    const us = resolveInstrumentWithAdapter('RELIANCE', 'US_EQUITY').instrument;
    expect(instrumentIdentityKey(nse)).not.toBe(instrumentIdentityKey(us));
    expect(nse.venue).toBe('NSE');
    expect(us.venue).toBe('NASDAQ');
  });

  it('does not join futures contracts on product symbol alone', () => {
    const nov = instrumentIdentityKey({
      symbol: 'CLX26',
      canonicalSymbol: 'CL',
      assetClass: 'COMMODITY_FUTURE',
      venue: 'NYMEX',
      quoteCurrency: 'USD',
      underlying: 'CL',
      contractMonth: '2026-11',
    });
    const dec = instrumentIdentityKey({
      symbol: 'CLZ26',
      canonicalSymbol: 'CL',
      assetClass: 'COMMODITY_FUTURE',
      venue: 'NYMEX',
      quoteCurrency: 'USD',
      underlying: 'CL',
      contractMonth: '2026-12',
    });
    expect(nov).not.toBe(dec);
  });

  it('does not join crypto spot with perpetual or quarterly on ticker', () => {
    const spot = instrumentIdentityKey({
      symbol: 'BTCUSDT',
      assetClass: 'CRYPTO_SPOT',
      venue: 'BINANCE',
      quoteCurrency: 'USDT',
      providerAssetId: 'BTCUSDT',
    });
    const perp = instrumentIdentityKey({
      symbol: 'BTCUSDT',
      assetClass: 'CRYPTO_FUTURE',
      venue: 'BINANCE',
      quoteCurrency: 'USDT',
      providerAssetId: 'BTCUSDT:PERPETUAL',
      contractType: 'PERPETUAL',
    });
    const quarterly = instrumentIdentityKey({
      symbol: 'BTCUSDT',
      assetClass: 'CRYPTO_FUTURE',
      venue: 'BINANCE',
      quoteCurrency: 'USDT',
      providerAssetId: 'BTCUSDT:QUARTERLY:2026-12',
      contractType: 'QUARTERLY',
      contractMonth: '2026-12',
    });
    expect(spot).not.toBe(perp);
    expect(perp).not.toBe(quarterly);
  });

  it('resolveAssetAdapter defaults to NSE without inventing US from ticker', () => {
    expect(resolveAssetAdapter('AAPL').id).toBe('nse-equity-v1');
    expect(resolveAssetAdapter('AAPL', 'US_EQUITY').id).toBe('us-equity-v1');
  });

  it('adapterHorizonBars matches NSE calendar map', () => {
    const nse = new NseEquityAdapter();
    expect(adapterHorizonBars(nse, '3M')).toBe(63);
  });
});

describe('simulated provider must not masquerade as production', () => {
  it('SIMULATED may exist for tests but never establishes production AVAILABLE', () => {
    const sim = DISCOVERED_PROVIDERS.find((p) => p.provider === 'simulated');
    expect(sim).toBeDefined();
    expect(sim!.liveQuote).toBe('UNAVAILABLE');
    expect(sim!.historicalCandles).toBe('UNAVAILABLE');
    expect(DISCOVERED_PROVIDERS.some((p) => /twelve/i.test(p.provider))).toBe(false);
    expect(
      DISCOVERED_PROVIDERS.filter((p) => p.provider === 'binance').map((p) => p.assetClass),
    ).toEqual(expect.arrayContaining(['CRYPTO_SPOT', 'CRYPTO_FUTURE']));
    expect(DISCOVERED_PROVIDERS.find((p) => p.provider === 'mcx')?.liveQuote).toBe('UNAVAILABLE');
    expect(DISCOVERED_PROVIDERS.find((p) => p.provider === 'cme')?.liveQuote).toBe('UNAVAILABLE');
    expect(sim!.fundamentals).toBe('UNAVAILABLE');

    expect(isProductionMarketDataProvider('simulated')).toBe(false);
    expect(providerMayEstablishProductionCapability('simulated')).toBe(false);
    expect(providerSupports('simulated', 'liveQuote')).toBe('UNAVAILABLE');
    expect(providerSupports('simulated', 'historicalCandles')).toBe('UNAVAILABLE');

    // Never authorizes execution — evaluateTrade → Risk → Gate remains required.
    expect(providerAuthorizesExecution('simulated')).toBe(false);
    expect(providerAuthorizesExecution('yahoo')).toBe(false);
  });

  it('real providers can be production; simulated cannot upgrade NseEquityAdapter claims', () => {
    expect(isProductionMarketDataProvider('yahoo')).toBe(true);
    expect(providerMayEstablishProductionCapability('yahoo')).toBe(true);
    // Adapter AVAILABLE reflects real NSE path eligibility — not simulated feed.
    const nse = new NseEquityAdapter();
    expect(nse.capabilities().marketData).toBe('AVAILABLE');
    expect(providerMayEstablishProductionCapability('simulated')).toBe(false);
  });
});

describe('NSE current-session 1D regression', () => {
  it('previousClose=100, live LTP=103, daily tip=100 → +3%', () => {
    // Friday IST open: 2026-08-14 10:00 IST = 04:30 UTC
    const now = Date.UTC(2026, 7, 14, 4, 30, 0);
    const r = computeCurrentSessionReturn1d({
      candles: [
        { close: 100, time: Date.UTC(2026, 7, 13, 10, 0, 0) },
        { close: 100, time: Date.UTC(2026, 7, 14, 3, 45, 0) },
      ],
      lastPrice: 103,
      previousClose: 100,
      quoteUpdatedAt: now,
      now,
    });
    expect(sessionReturn1dToPercent(r.return1d)).toBe(3);
  });
});

describe('Bull-Run seam + confidence ≠ probability', () => {
  it('accepts optional horizonBarsByHorizon without inventing cells', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.1);
    const a = buildBullRunV2FromEvidence({
      symbol: 'TCS',
      closes,
      horizonBarsByHorizon: { '1D': 1, '1W': 5, '1M': 21, '3M': 63, '6M': 126, '12M': 252 },
    });
    expect(a.executionReadyFromBullRun).toBe(false);
    for (const c of a.cells) {
      if (c.status === 'AVAILABLE') {
        expect(c.probability).not.toBeNull();
        expect(c.confidence).not.toBe(String(c.probability));
        if (c.confidence === 'UNAVAILABLE') {
          // confidence band is categorical, never a numeric probability copy
          expect(typeof c.probability).toBe('number');
        }
      } else {
        expect(c.probability).toBeNull();
      }
    }
  });
});

describe('Batch capabilityCoverage + ranking independence', () => {
  function row(symbol: string, rank: number, withBull: boolean): IntelligenceBatchResultRow {
    return {
      rank,
      symbol,
      opportunityId: `opp-${symbol}`,
      sector: 'IT',
      intelligenceContext: {
        tradePlanRecommendation: 'WAIT',
        tradePlanStatus: 'PARTIAL',
        tradePlanExecutionReady: false,
        ...(withBull
          ? {
              bullRunStage: 'EARLY',
              bullRunV2Cells: [{ t: 0.2, h: '3M' as const, p: 0.61, conf: 'MEDIUM' as const }],
            }
          : {}),
        mlDirection: withBull ? 'UP' : undefined,
        mlModelVersion: withBull ? 'm1' : undefined,
      },
    };
  }

  it('capabilityCoverage reflects real ML/bull counts — not uniform fake', () => {
    const rankings = [
      row('TCS', 1, true),
      row('INFY', 2, true),
      row('WIPRO', 3, false),
      row('HCLTECH', 4, false),
      row('TECHM', 5, false),
    ];
    const cov = buildBatchCapabilityCoverage(rankings, 'NIFTY50');
    const ml = cov.find((c) => c.capability === 'ml')!;
    const bull = cov.find((c) => c.capability === 'bullRun')!;
    expect(ml.available).toBe(2);
    expect(ml.totalCount).toBe(5);
    expect(bull.available).toBe(2);
    expect(ml.available).not.toBe(ml.totalCount);
  });

  it('Best Picks order identical with/without Bull-Run cells', () => {
    const base = [row('A', 1, false), row('B', 2, false), row('C', 3, false)];
    const withBull = [row('A', 1, true), row('B', 2, true), row('C', 3, false)];
    const r1 = buildBatchResearchReport({
      batchId: 'b1',
      completedAt: 1,
      universe: 'NIFTY50',
      coverage: { total: 3, processed: 3, failed: 0 },
      rankings: base,
    });
    const r2 = buildBatchResearchReport({
      batchId: 'b2',
      completedAt: 2,
      universe: 'NIFTY50',
      coverage: { total: 3, processed: 3, failed: 0 },
      rankings: withBull,
    });
    expect(r1.bestOpportunities.map((o) => o.symbol)).toEqual(
      r2.bestOpportunities.map((o) => o.symbol),
    );
    expect(r1.capabilityCoverage?.length).toBeGreaterThan(0);
  });
});

describe('multi-asset universes', () => {
  it('US_CUSTOM requires symbols', () => {
    expect(() => resolveIntelligenceUniverse({ universe: 'US_CUSTOM' })).toThrow(/symbols/);
    expect(resolveIntelligenceUniverse({ universe: 'US_CUSTOM', customSymbols: ['AAPL'] })).toEqual(
      ['AAPL'],
    );
  });

  it('NSE_ALL aliases ALL', () => {
    expect(
      resolveIntelligenceUniverse({
        universe: 'NSE_ALL',
        allSymbols: ['RELIANCE', 'TCS'],
        allLimit: 10,
      }),
    ).toEqual(['RELIANCE', 'TCS']);
  });
});

describe('Paper experiment learning boundary', () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pex-'));
    storePath = join(dir, 'paper-experiments.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Learning never touches Risk/Gate; candidates stay walk-forward pending', () => {
    expect(learningTouchesRiskOrGate()).toBe(false);
    const nse = new NseEquityAdapter();
    const exp = createPaperExperiment(
      {
        instrument: nse.resolveInstrument('TCS'),
        adapterId: nse.id,
        analysisTimeframe: '1d',
        predictionHorizon: '3M',
        sessionContext: 'NSE_REGULAR',
        confidenceStatus: 'UNAVAILABLE',
        confidence: null,
      },
      storePath,
    );
    recordPaperOutcome({ experimentId: exp.experimentId, actualReturn: 0.02 }, storePath);
    const note = appendLearningNote(
      { experimentId: exp.experimentId, phase: 'MEASURE', note: 'measure only' },
      storePath,
    );
    expect(note.phase).toBe('MEASURE');
    const cand = registerCandidateModel(
      { fromExperimentIds: [exp.experimentId], note: 'await walk-forward' },
      storePath,
    );
    expect(cand.status).toBe('WALK_FORWARD_PENDING');
    const store = loadPaperExperimentStore(storePath);
    expect(store.candidates[0]?.status).toBe('WALK_FORWARD_PENDING');
  });
});
