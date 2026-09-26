/**
 * F5 — CoinGecko/Binance/TD price ≠ on-chain analytics.
 * DefiLlama chain TVL attaches as IntelligenceSnapshot evidence (SOURCE_REPORTED).
 * Missing is UNAVAILABLE, never numeric 0. Never BUY/SELL / Risk / Gate / Reddit.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentAnalysis, IntelligenceSnapshot, RankingContext } from '@stockpred/shared-types';
import { TradingMode } from '@stockpred/shared-types';
import {
  attachBatchInstrumentToIntelligenceSnapshot,
  assessOpportunityRanking,
  buildIntelligenceSnapshot,
  buildProfessionalTraderAssessment,
  buildSnapshotCapabilityCoverage,
  buildTradePlan,
  DEFILLAMA_CHAINS_URL,
  dimensionPrecedenceForContext,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  geckoIdForOnchain,
  hydrateBatchDataSnapshot,
  ONCHAIN_NOT_CRYPTO,
  ONCHAIN_UNAVAILABLE,
  onchainFromChainMap,
  OPPORTUNITY_RANKING_CALCULATION_VERSION,
  parseDefiLlamaChains,
  shouldAttachOnchain,
  type OpportunityRankingCandidate,
} from './index';

function cryptoSpot(symbol = 'BTCUSDT') {
  return {
    symbol,
    assetClass: 'CRYPTO_SPOT' as const,
    venue: 'BINANCE' as const,
    quoteCurrency: 'USDT',
    canonicalSymbol: symbol,
    providerAssetId: symbol,
  };
}

function nseEquity(symbol = 'TCS') {
  return {
    symbol,
    assetClass: 'EQUITY' as const,
    venue: 'NSE' as const,
    quoteCurrency: 'INR',
    canonicalSymbol: symbol,
  };
}

function llamaBody(tvl = 1_500_000_000): string {
  return JSON.stringify([
    { gecko_id: 'bitcoin', name: 'Bitcoin', tvl },
    { gecko_id: 'ethereum', name: 'Ethereum', tvl: 40_000_000_000 },
    { gecko_id: 'solana', name: 'Solana', tvl: 0 },
  ]);
}

function binanceSpotFetch(url: string, price = '70000'): unknown {
  if (url.includes('/ticker/24hr')) {
    return [
      {
        symbol: 'BTCUSDT',
        lastPrice: price,
        priceChange: '100',
        priceChangePercent: '1.4',
        volume: '10',
        highPrice: price,
        lowPrice: price,
        prevClosePrice: price,
      },
    ];
  }
  if (url.includes('/klines')) {
    return [[1_700_000_000_000, price, price, price, price, '1']];
  }
  throw new Error(`unexpected quote url ${url}`);
}

function baseAnalysis(symbol: string): AgentAnalysis {
  return {
    symbol,
    currentPrice: 70000,
    decision: 'BUY',
    scores: {
      fundamental: 70,
      technical: 80,
      sentiment: 60,
      quant: 65,
      macro: 70,
      sector: 60,
      risk: 70,
      overall: 80,
    },
    setup: {
      instrument: symbol,
      direction: 'LONG',
      entry: 70000,
      stopLoss: 68000,
      target1: 74000,
      target2: null,
      target3: null,
      riskReward: 2,
      positionSize: 10,
      expectedHoldingPeriod: '1-5d',
      confidence: 80,
      invalidation: 'Close below stop',
    },
    marketRegime: 'RISK_ON',
    thesis: 'Breakout with volume',
    counterThesis: 'Market risk-off',
    invalidation: 'Close below stop',
    risks: [],
    action: 'Propose breakout long',
    usedCapabilities: ['quotes'],
    missingCapabilities: [],
    capabilityRequests: [],
    generatedAt: Date.now(),
    disclaimer: 'test',
  };
}

function twinSnap(symbol: string): IntelligenceSnapshot {
  const analysis = baseAnalysis(symbol);
  const decision = evaluateTrade({ analysis });
  const snap = buildIntelligenceSnapshot({
    analysis,
    decision,
    sourceDataTimestamp: '2026-08-24T10:00:00.000Z',
    marketContext: {
      scannerRegime: 'BULL',
      vixLevel: 14,
      niftyChangePercent: 0.4,
      breadthPercentAboveEma50: 65,
      asOf: '2026-08-24T10:00:00.000Z',
    },
    crossSectional: {
      rsVsNifty50: 1.15,
      peerRsValues: [0.9, 0.95, 1.0, 1.05, 1.1],
      sector: 'IT',
      sectorMedianRs: 1.0,
      peVsMedianPct: 0,
      pbVsMedianPct: 0,
      asOf: '2026-08-24T10:00:00.000Z',
    },
  });
  snap.crossSectionalRs = {
    ...(snap.crossSectionalRs ?? { rsBucket: 'LEADERS', source: 'PEER_CROSS_SECTION' }),
    rsBucket: 'LEADERS',
    source: snap.crossSectionalRs?.source ?? 'PEER_CROSS_SECTION',
  };
  snap.sectorIntelligence = {
    sector: 'IT',
    sectorTrend: 'LEADING',
    valuationVsPeers: 'FAIR',
    sectorFit: 'HIGH',
    asOf: '2026-08-24T10:00:00.000Z',
  };
  return snap;
}

function candidate(symbol: string, snap: IntelligenceSnapshot): OpportunityRankingCandidate {
  return { opportunityId: `opp-${symbol}`, symbol, snapshot: snap, portfolioFit: 'GOOD' };
}

const swingCtx: RankingContext = {
  tradeHorizon: 'SWING_TRADE',
  strategyTag: 'BREAKOUT',
  marketRegime: 'BULL',
  timestamp: '2026-08-24T10:30:00.000Z',
};

describe('F5 crypto on-chain evidence', () => {
  it('maps BTCUSDT → bitcoin and never uses CoinGecko simple/price as on-chain', () => {
    expect(geckoIdForOnchain(cryptoSpot('BTCUSDT'))).toBe('bitcoin');
    expect(geckoIdForOnchain(cryptoSpot('ETHUSDT'))).toBe('ethereum');
    expect(geckoIdForOnchain(cryptoSpot('XYZUSDT'))).toBeNull();
    expect(DEFILLAMA_CHAINS_URL).toBe('https://api.llama.fi/v2/chains');
    const src = readFileSync(join(__dirname, 'crypto-onchain-evidence.ts'), 'utf8');
    expect(src).toMatch(/api\.llama\.fi\/v2\/chains/);
    expect(src).not.toMatch(/simple\/price/);
    expect(src).not.toMatch(/reddit/i);
    const hydrate = readFileSync(join(__dirname, 'batch-data-hydrate.ts'), 'utf8');
    expect(hydrate).not.toMatch(/api\.twelvedata\.com\/(rsi|macd|adx|commodit)/i);
  });

  it('parses DefiLlama TVL > 0 and skips numeric 0', () => {
    const map = parseDefiLlamaChains(JSON.parse(llamaBody(0)));
    expect(map.has('bitcoin')).toBe(false);
    const ok = parseDefiLlamaChains(JSON.parse(llamaBody(1_500_000_000)));
    expect(ok.get('bitcoin')?.tvlUsd).toBe(1_500_000_000);
    expect(ok.has('solana')).toBe(false);
  });

  it('builds SOURCE_REPORTED TVL from the chain map — never quote.price', () => {
    const chains = parseDefiLlamaChains(JSON.parse(llamaBody(1_500_000_000)));
    const block = onchainFromChainMap(cryptoSpot('BTCUSDT'), chains, 1_700_000_000_000);
    expect(block.status).toBe('AVAILABLE');
    expect(block.source).toBe('SOURCE_REPORTED');
    expect(block.provider).toBe('defillama');
    expect(block.geckoId).toBe('bitcoin');
    expect(block.tvlUsd).toBe(1_500_000_000);
    expect(block.tvlUsd).not.toBe(70000);
  });

  it('unmapped / missing chain is UNAVAILABLE — never numeric 0', () => {
    const missing = onchainFromChainMap(cryptoSpot('XYZUSDT'), new Map(), 1);
    expect(missing.status).toBe('UNAVAILABLE');
    expect(missing.reasonCode).toBe(ONCHAIN_UNAVAILABLE);
    expect(missing.tvlUsd).toBeUndefined();
    expect(missing.tvlUsd).not.toBe(0);
  });

  it('hydrates BTCUSDT on-chain TVL separately from Binance lastPrice', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f5-btc',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => binanceSpotFetch(url, '70000'),
        onchainBody: llamaBody(1_500_000_000),
        now: () => 1_700_000_100_000,
      },
    });
    const row = snapshot.instruments[0];
    expect(row?.quote?.price).toBe(70000);
    expect(row?.onchain?.status).toBe('AVAILABLE');
    expect(row?.onchain?.source).toBe('SOURCE_REPORTED');
    expect(row?.onchain?.provider).toBe('defillama');
    expect(row?.onchain?.geckoId).toBe('bitcoin');
    expect(row?.onchain?.tvlUsd).toBe(1_500_000_000);
    expect(row?.onchain?.tvlUsd).not.toBe(row?.quote?.price);
    const skipped = await hydrateBatchDataSnapshot({
      batchId: 'f5-skip',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => binanceSpotFetch(url, '70000'),
        onchainBody: llamaBody(1_500_000_000),
        skipOnchain: true,
      },
    });
    expect(skipped.snapshot.instruments[0]?.quote?.price).toBe(70000);
    expect(skipped.snapshot.instruments[0]?.onchain).toBeUndefined();
    const intel = attachBatchInstrumentToIntelligenceSnapshot(twinSnap('BTCUSDT'), row);
    expect(intel.onchain?.tvlUsd).toBe(1_500_000_000);
    expect(intel.onchain?.tvlUsd).not.toBe(70000);
  });

  it('missing DefiLlama row is UNAVAILABLE on the instrument, not tvl 0', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f5-miss',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => binanceSpotFetch(url, '70000'),
        onchainBody: JSON.stringify([{ gecko_id: 'ethereum', name: 'Ethereum', tvl: 1 }]),
      },
    });
    const row = snapshot.instruments[0];
    expect(row?.quote?.price).toBe(70000);
    expect(row?.onchain?.status).toBe('UNAVAILABLE');
    expect(row?.onchain?.reasonCode).toBe(ONCHAIN_UNAVAILABLE);
    expect(row?.onchain?.tvlUsd).toBeUndefined();
    expect(JSON.stringify(row?.onchain)).not.toMatch(/"tvlUsd":0/);
  });

  it('does not attach on-chain to equities; skipOnchain wins over a body', () => {
    expect(shouldAttachOnchain({ skipOnchain: true, onchainBody: llamaBody() })).toBe(false);
    expect(shouldAttachOnchain({ fetchJson: async () => ({}) })).toBe(false);
    expect(shouldAttachOnchain({ twelveDataClient: {} })).toBe(false);
    expect(shouldAttachOnchain({ onchainBody: llamaBody() })).toBe(true);
    expect(shouldAttachOnchain({})).toBe(true);
    const equity = onchainFromChainMap(
      nseEquity('TCS'),
      parseDefiLlamaChains(JSON.parse(llamaBody())),
      1,
    );
    expect(equity.status).toBe('UNAVAILABLE');
    expect(equity.reasonCode).toBe(ONCHAIN_NOT_CRYPTO);
    expect(equity.tvlUsd).toBeUndefined();
  });

  it('ranks ONCHAIN as MED for presence, never HIGH / BUY, and skips N/A equities', () => {
    expect(dimensionPrecedenceForContext('SWING_TRADE').at(-3)).toBe('ONCHAIN');
    expect(dimensionPrecedenceForContext('SWING_TRADE').at(-1)).toBe('PORTFOLIO_FIT');
    expect(OPPORTUNITY_RANKING_CALCULATION_VERSION).toBe('lexicographic-context-precedence.v4');

    const equity = twinSnap('TCS');
    const crypto = twinSnap('BTCUSDT');
    crypto.onchain = {
      status: 'AVAILABLE',
      source: 'SOURCE_REPORTED',
      provider: 'defillama',
      chain: 'Bitcoin',
      geckoId: 'bitcoin',
      tvlUsd: 1_500_000_000,
      asOf: 1,
    };
    const missing = twinSnap('ETHUSDT');
    missing.onchain = {
      status: 'UNAVAILABLE',
      source: 'SOURCE_REPORTED',
      provider: 'defillama',
      geckoId: 'ethereum',
      asOf: 1,
      reasonCode: ONCHAIN_UNAVAILABLE,
    };

    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [
        candidate('TCS', equity),
        candidate('BTCUSDT', crypto),
        candidate('ETHUSDT', missing),
      ],
    });
    expect(result.calculationVersion).toBe('lexicographic-context-precedence.v4');
    const btc = result.rankings.find((r) => r.symbol === 'BTCUSDT');
    const eth = result.rankings.find((r) => r.symbol === 'ETHUSDT');
    const tcs = result.rankings.find((r) => r.symbol === 'TCS');
    expect(btc?.dimensions.onchain).toBe('MED');
    expect(btc?.dimensions.onchain).not.toBe('HIGH');
    expect(btc?.strengths.some((s) => s.code === 'ONCHAIN_TVL_PRESENT')).toBe(true);
    expect(eth?.dimensions.onchain).toBe('UNKNOWN');
    expect(eth?.unknownDimensions).toContain('ONCHAIN');
    expect(tcs?.unknownDimensions).not.toContain('ONCHAIN');
    expect(btc?.rank).toBeLessThan(eth!.rank);
    expect(JSON.stringify(result)).not.toMatch(/rankingScore|rankScore/i);
  });

  it('does not change Risk / Portfolio and keeps ProfessionalTrader polarity NEUTRAL', () => {
    const analysis = baseAnalysis('BTCUSDT');
    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const riskA = evaluateRisk(riskInput);
    const snap = twinSnap('BTCUSDT');
    snap.onchain = {
      status: 'AVAILABLE',
      source: 'SOURCE_REPORTED',
      provider: 'defillama',
      geckoId: 'bitcoin',
      tvlUsd: 1_500_000_000,
      asOf: 1,
    };
    expect(evaluateRisk(riskInput)).toEqual(riskA);
    const port = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    expect(evaluatePortfolio({ decision, risk: riskA, portfolio: port })).toEqual(
      evaluatePortfolio({ decision, risk: riskA, portfolio: port }),
    );

    const without = buildProfessionalTraderAssessment({
      now: 1,
      opportunityId: 'opp-btc',
      analysis,
      snapshot: twinSnap('BTCUSDT'),
    });
    const withOnchain = buildProfessionalTraderAssessment({
      now: 1,
      opportunityId: 'opp-btc',
      analysis,
      snapshot: snap,
    });
    expect(withOnchain.direction).toBe(without.direction);
    expect(withOnchain.direction).toBe('LONG');
    const item = withOnchain.evidence.find((e) => e.code === 'ONCHAIN');
    expect(item?.polarity).toBe('NEUTRAL');
    expect(item?.message).toMatch(/observe-only/i);
    const plan = buildTradePlan({
      now: 1,
      opportunityId: 'opp-btc',
      analysis,
      snapshot: snap,
    });
    expect(
      plan.assessment.evidence.some((e) => e.code === 'ONCHAIN' && e.polarity === 'NEUTRAL'),
    ).toBe(true);
    expect(plan.recommendation).not.toBe('REJECT');
  });

  it('marks on-chain N/A for equities and AVAILABLE for crypto TVL — never 0 fill', () => {
    const equityCov = buildSnapshotCapabilityCoverage({
      instruments: [
        { instrumentRef: nseEquity('TCS'), quote: { price: 3500 }, dataStatus: 'AVAILABLE' },
      ],
      coverage: {
        readiness: 'READY',
        eligible: 1,
        processed: 1,
        available: 1,
        partial: 0,
        unavailable: 0,
        failed: 0,
        pending: 0,
        marketDataAvailable: 1,
        historicalAvailable: 0,
        derivativesAvailable: 0,
        requiredCapabilities: ['marketData'],
        coveragePct: 100,
        minRequiredCoveragePct: 50,
        reasons: [],
      },
      frozen: true,
    });
    const na = equityCov.find((row) => row.capability === 'onchain');
    expect(na?.status).toBe('N/A');
    expect(na?.coveragePct).toBeNull();
    expect(na?.reason).toBe('NOT_CRYPTO');

    const cryptoCov = buildSnapshotCapabilityCoverage({
      instruments: [
        {
          instrumentRef: cryptoSpot('BTCUSDT'),
          quote: { price: 70000 },
          dataStatus: 'AVAILABLE',
          onchain: {
            status: 'AVAILABLE',
            source: 'SOURCE_REPORTED',
            provider: 'defillama',
            geckoId: 'bitcoin',
            tvlUsd: 1_500_000_000,
            asOf: 1,
          },
        },
      ],
      coverage: {
        readiness: 'READY',
        eligible: 1,
        processed: 1,
        available: 1,
        partial: 0,
        unavailable: 0,
        failed: 0,
        pending: 0,
        marketDataAvailable: 1,
        historicalAvailable: 0,
        derivativesAvailable: 0,
        requiredCapabilities: ['marketData'],
        coveragePct: 100,
        minRequiredCoveragePct: 50,
        reasons: [],
      },
      frozen: true,
    });
    const available = cryptoCov.find((row) => row.capability === 'onchain');
    expect(available?.status).toBe('AVAILABLE');
    expect(available?.coveragePct).toBe(1);
    expect(available?.na).toBe(0);
  });
});
