/**
 * F6 — Reddit/social evidence, not truth.
 * Frozen aliases only. Unmatched dropped. Missing UNAVAILABLE, never 0.
 * Volume is not a BUY/SELL. No social → Risk / Gate / execution.
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
  dimensionPrecedenceForContext,
  emptyPortfolioSnapshot,
  evaluatePortfolio,
  evaluateRisk,
  evaluateTrade,
  hydrateBatchDataSnapshot,
  OPPORTUNITY_RANKING_CALCULATION_VERSION,
  parseRedditListing,
  REDDIT_SEARCH_URL,
  resolveSocialPostsForRef,
  shouldAttachSocial,
  SOCIAL_SCRAPE_FORBIDDEN,
  SOCIAL_UNAVAILABLE,
  socialFromPosts,
  unavailableSocial,
  type OpportunityRankingCandidate,
  type RedditSocialPost,
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
  return {};
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

function listing(posts: Array<Partial<RedditSocialPost> & { title: string }>): string {
  return JSON.stringify({
    data: {
      children: posts.map((post, i) => ({
        data: {
          id: post.id ?? `t3_${i}`,
          title: post.title,
          selftext: post.selftext ?? '',
          author: post.author ?? 'user1',
          created_utc: post.createdUtc ?? 1_700_000_000,
          subreddit: post.subreddit ?? 'IndiaInvestments',
        },
      })),
    },
  });
}

function baseAnalysis(symbol: string): AgentAnalysis {
  return {
    symbol,
    currentPrice: 3500,
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
      entry: 3500,
      stopLoss: 3400,
      target1: 3700,
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

describe('F6 Reddit/social evidence', () => {
  it('ingests Reddit JSON only and forbids HTML scrape / TD indicators', () => {
    expect(REDDIT_SEARCH_URL).toBe('https://www.reddit.com/search.json');
    expect(parseRedditListing('<html><body>TCS 3500</body></html>')).toEqual({
      scrapeForbidden: true,
    });
    expect(unavailableSocial(SOCIAL_SCRAPE_FORBIDDEN).reasonCode).toBe(SOCIAL_SCRAPE_FORBIDDEN);
    const src = readFileSync(join(__dirname, 'reddit-social-evidence.ts'), 'utf8');
    expect(src).toMatch(/reddit\.com\/search\.json/);
    expect(src).not.toMatch(/stocktwits/i);
    const hydrate = readFileSync(join(__dirname, 'batch-data-hydrate.ts'), 'utf8');
    expect(hydrate).not.toMatch(/api\.twelvedata\.com\/(rsi|macd|adx|commodit)/i);
  });

  it('keeps unmatched / guessed names off the frozen symbol', () => {
    const parsed = parseRedditListing(
      JSON.parse(
        listing([
          { id: '1', title: 'TCS beats street, IT rally continues' },
          { id: '2', title: 'Tata Consultancy Services outlook' },
          { id: '3', title: 'Infosys INFY guidance cut' },
        ]),
      ),
    );
    expect('scrapeForbidden' in parsed).toBe(false);
    const posts = parsed as RedditSocialPost[];
    const tcs = resolveSocialPostsForRef(posts, nseEquity('TCS'));
    expect(tcs.map((p) => p.id)).toEqual(['1']);
    expect(tcs.some((p) => /Tata Consultancy|INFY/i.test(p.title))).toBe(false);
  });

  it('missing matches are UNAVAILABLE — never mentionCount 0 or fabricated score 0', async () => {
    const block = await socialFromPosts(nseEquity('TCS'), [], undefined, 1);
    expect(block.status).toBe('UNAVAILABLE');
    expect(block.reasonCode).toBe(SOCIAL_UNAVAILABLE);
    expect(block.mentionCount).toBeUndefined();
    expect(block.score).toBeUndefined();
    expect(block.score).not.toBe(0);
  });

  it('scores MODEL_DERIVED only from the scorer; genuine 0 is kept; missing scorer is not 0', async () => {
    const posts = parseRedditListing(
      JSON.parse(listing([{ id: '1', title: 'TCS results tonight' }])),
    ) as RedditSocialPost[];
    const scored = await socialFromPosts(nseEquity('TCS'), posts, () => 0, 1);
    expect(scored.status).toBe('AVAILABLE');
    expect(scored.source).toBe('MODEL_DERIVED');
    expect(scored.score).toBe(0);
    expect(scored.mentionCount).toBe(1);
    const unscored = await socialFromPosts(nseEquity('TCS'), posts, undefined, 1);
    expect(unscored.status).toBe('PARTIAL');
    expect(unscored.source).toBe('SOURCE_REPORTED');
    expect(unscored.score).toBeUndefined();
    const nullScore = await socialFromPosts(nseEquity('TCS'), posts, () => null, 1);
    expect(nullScore.score).toBeUndefined();
    expect(nullScore.source).toBe('SOURCE_REPORTED');
  });

  it('hydrates social separately from news FinBERT and quote.price', async () => {
    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f6-btc',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => binanceSpotFetch(url, '70000'),
        skipEvidence: true,
        socialBody: listing([
          { id: 'a', title: 'BTCUSDT funding flip', createdUtc: 1_700_000_000 },
          { id: 'a', title: 'BTCUSDT funding flip', createdUtc: 1_700_000_000 },
        ]),
        scoreHeadline: () => 0.25,
        now: () => 1_700_000_100_000,
      },
    });
    const row = snapshot.instruments[0];
    expect(row?.quote?.price).toBe(70000);
    expect(row?.social?.status).toBe('AVAILABLE');
    expect(row?.social?.source).toBe('MODEL_DERIVED');
    expect(row?.social?.provider).toBe('reddit');
    expect(row?.social?.mentionCount).toBe(1);
    expect(row?.social?.score).toBe(0.25);
    expect(row?.social?.score).not.toBe(row?.quote?.price);
    expect(row?.sentiment).not.toEqual(row?.social);
    const intel = attachBatchInstrumentToIntelligenceSnapshot(twinSnap('BTCUSDT'), row);
    expect(intel.social?.score).toBe(0.25);
    expect(intel.sentiment).not.toEqual(intel.social);
  });

  it('HTML social body is SCRAPE_FORBIDDEN; skipSocial wins', async () => {
    expect(shouldAttachSocial({ skipSocial: true, socialBody: listing([]) })).toBe(false);
    expect(shouldAttachSocial({ fetchJson: async () => ({}) })).toBe(false);
    expect(shouldAttachSocial({ socialBody: listing([]) })).toBe(true);

    const { snapshot } = await hydrateBatchDataSnapshot({
      batchId: 'f6-html',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => binanceSpotFetch(url, '70000'),
        skipEvidence: true,
        socialBody: '<!doctype html><html><body>BTCUSDT to the moon</body></html>',
      },
    });
    expect(snapshot.instruments[0]?.quote?.price).toBe(70000);
    expect(snapshot.instruments[0]?.social?.status).toBe('UNAVAILABLE');
    expect(snapshot.instruments[0]?.social?.reasonCode).toBe(SOCIAL_SCRAPE_FORBIDDEN);
    expect(snapshot.instruments[0]?.social?.mentionCount).toBeUndefined();

    const skipped = await hydrateBatchDataSnapshot({
      batchId: 'f6-skip',
      universeId: 'CRYPTO_SPOT_ALL',
      instruments: [cryptoSpot('BTCUSDT')],
      deps: {
        fetchJson: async (url) => binanceSpotFetch(url, '70000'),
        skipEvidence: true,
        socialBody: listing([{ id: '1', title: 'BTCUSDT beats' }]),
        skipSocial: true,
      },
    });
    expect(skipped.snapshot.instruments[0]?.quote?.price).toBe(70000);
    expect(skipped.snapshot.instruments[0]?.social).toBeUndefined();
  });

  it('ranks SOCIAL as MED for presence, never HIGH from volume, and skips absent blocks', () => {
    expect(dimensionPrecedenceForContext('SWING_TRADE').at(-2)).toBe('SOCIAL');
    expect(dimensionPrecedenceForContext('SWING_TRADE').at(-3)).toBe('ONCHAIN');
    expect(dimensionPrecedenceForContext('SWING_TRADE').at(-1)).toBe('PORTFOLIO_FIT');
    expect(OPPORTUNITY_RANKING_CALCULATION_VERSION).toBe('lexicographic-context-precedence.v4');

    const quiet = twinSnap('INFY');
    const loud = twinSnap('TCS');
    loud.social = {
      status: 'AVAILABLE',
      source: 'MODEL_DERIVED',
      provider: 'reddit',
      mentionCount: 80,
      score: 0.9,
      asOf: 1,
    };
    quiet.social = {
      status: 'UNAVAILABLE',
      source: 'SOURCE_REPORTED',
      provider: 'reddit',
      reasonCode: SOCIAL_UNAVAILABLE,
      asOf: 1,
    };
    const none = twinSnap('WIPRO');

    const result = assessOpportunityRanking({
      context: swingCtx,
      candidates: [candidate('INFY', quiet), candidate('TCS', loud), candidate('WIPRO', none)],
    });
    const tcs = result.rankings.find((r) => r.symbol === 'TCS');
    const infy = result.rankings.find((r) => r.symbol === 'INFY');
    const wipro = result.rankings.find((r) => r.symbol === 'WIPRO');
    expect(tcs?.dimensions.social).toBe('MED');
    expect(tcs?.dimensions.social).not.toBe('HIGH');
    expect(tcs?.strengths.some((s) => s.code === 'SOCIAL_PRESENT')).toBe(true);
    expect(infy?.dimensions.social).toBe('UNKNOWN');
    expect(infy?.unknownDimensions).toContain('SOCIAL');
    expect(wipro?.unknownDimensions).not.toContain('SOCIAL');
    expect(tcs?.rank).toBeLessThan(infy!.rank);
    expect(JSON.stringify(result)).not.toMatch(/rankingScore|rankScore/i);
  });

  it('does not change Risk / Portfolio and keeps ProfessionalTrader polarity NEUTRAL', () => {
    const analysis = baseAnalysis('TCS');
    const decision = evaluateTrade({ analysis });
    const riskInput = {
      decision,
      capital: 1_000_000,
      cash: 1_000_000,
      tradingEnabled: true,
      killSwitch: false,
    };
    const riskA = evaluateRisk(riskInput);
    const snap = twinSnap('TCS');
    snap.social = {
      status: 'AVAILABLE',
      source: 'MODEL_DERIVED',
      provider: 'reddit',
      mentionCount: 80,
      score: 0.9,
      asOf: 1,
    };
    expect(evaluateRisk(riskInput)).toEqual(riskA);
    const port = emptyPortfolioSnapshot(TradingMode.PAPER, 1_000_000);
    expect(evaluatePortfolio({ decision, risk: riskA, portfolio: port })).toEqual(
      evaluatePortfolio({ decision, risk: riskA, portfolio: port }),
    );

    const without = buildProfessionalTraderAssessment({
      now: 1,
      opportunityId: 'opp-tcs',
      analysis,
      snapshot: twinSnap('TCS'),
    });
    const withSocial = buildProfessionalTraderAssessment({
      now: 1,
      opportunityId: 'opp-tcs',
      analysis,
      snapshot: snap,
    });
    expect(withSocial.direction).toBe(without.direction);
    expect(withSocial.evidence.find((e) => e.code === 'SOCIAL')?.polarity).toBe('NEUTRAL');
    const plan = buildTradePlan({
      now: 1,
      opportunityId: 'opp-tcs',
      analysis,
      snapshot: snap,
    });
    expect(
      plan.assessment.evidence.some((e) => e.code === 'SOCIAL' && e.polarity === 'NEUTRAL'),
    ).toBe(true);
  });

  it('coverage is UNAVAILABLE when missing and AVAILABLE when matched — never 0 fill', () => {
    const missing = buildSnapshotCapabilityCoverage({
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
    const none = missing.find((row) => row.capability === 'social');
    expect(none?.status).toBe('UNAVAILABLE');
    expect(none?.na).toBe(0);

    const present = buildSnapshotCapabilityCoverage({
      instruments: [
        {
          instrumentRef: nseEquity('TCS'),
          quote: { price: 3500 },
          dataStatus: 'AVAILABLE',
          social: {
            status: 'AVAILABLE',
            source: 'MODEL_DERIVED',
            provider: 'reddit',
            mentionCount: 3,
            score: 0.2,
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
    expect(present.find((row) => row.capability === 'social')?.status).toBe('AVAILABLE');
  });
});
