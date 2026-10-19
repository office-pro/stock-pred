/**
 * MI-3 Combined Batch Preflight orchestrator.
 * Resolves plan → integrity → MDS quotes/historical → MI Prisma (dual PIT) → PASS|BLOCK.
 */

import { createHash } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { getPrismaClient, resolveNseAllMembership } from '@stockpred/database';
import type {
  AnalysisSessionContract,
  BatchPreflightConfiguration,
  CombinedBatchPreflightV2,
  DataRequirementPlan,
} from '@stockpred/shared-types';
import {
  applyAnalysisSessionToPreflight,
  emptyInventory,
  isNseRegularSession,
  isPitEligible,
  naInventory,
  normalizeAnalysisSession,
  quoteFreshnessPolicyForAnalysisSession,
  resolveDataRequirementPlan,
  runReadinessPreflight,
  type CapabilityInventory,
} from '@stockpred/shared-utils';
import { AgentService } from './agent.service';

/** Per-symbol candle read; keep short so NIFTY500 cannot pin the UI for minutes. */
const PREFLIGHT_CANDLE_TIMEOUT_MS = 4_000;
/** Parallel candle workers for preflight (hydrate uses a lower default). */
const PREFLIGHT_HISTORICAL_CONCURRENCY = 24;
/** Wall-clock budget for historical leg — remaining symbols fail closed, not hang. */
const PREFLIGHT_HISTORICAL_BUDGET_MS = 45_000;
/** Review→create reuse window (same fingerprint; gate must still pass). */
const PREFLIGHT_VERDICT_CACHE_TTL_MS = 90_000;

export type MiCombinedPreflightRunOptions = {
  /**
   * When true, return a fresh-enough cached verdict if the session gate would pass
   * (skip second MDS pass after a green Review).
   */
  allowCache?: boolean;
};

type Inventories = {
  marketData: CapabilityInventory;
  historical: CapabilityInventory;
  fundamentals: CapabilityInventory;
  news: CapabilityInventory;
  sentiment: CapabilityInventory;
  corporateEvents: CapabilityInventory;
  macro: CapabilityInventory;
  social: CapabilityInventory;
};

/**
 * Predefined NSE_EQUITY_ALL membership is backend-owned (equity-master).
 * FE must not supply the list; same source as intelligence-batch create().
 */
export function hydratePreflightMembership(
  config: BatchPreflightConfiguration,
): BatchPreflightConfiguration {
  if (config.universeType !== 'NSE_EQUITY_ALL') return config;
  if (config.lockedMembershipSymbols && config.lockedMembershipSymbols.length > 0) {
    return config;
  }
  if (config.nseEquityAllSymbols && config.nseEquityAllSymbols.length > 0) {
    return config;
  }
  try {
    const { symbols } = resolveNseAllMembership();
    return { ...config, nseEquityAllSymbols: symbols };
  } catch (err) {
    throw new BadRequestException(
      err instanceof Error
        ? err.message
        : 'NSE_ALL canonical membership unavailable — run npm run ingest:listings',
    );
  }
}

@Injectable()
export class MiCombinedPreflightService {
  private readonly verdictCache = new Map<
    string,
    { at: number; verdict: CombinedBatchPreflightV2 }
  >();

  constructor(private readonly agent: AgentService) {}

  /**
   * Stable key shared by Review (universe-resolved) and create (locked membership)
   * when the resolved symbol set and gate inputs match.
   */
  fingerprintPreflight(
    config: BatchPreflightConfiguration,
    plan: DataRequirementPlan,
    analysisSession: AnalysisSessionContract,
  ): string {
    const symbols = plan.universe.resolved.map((i) => i.symbol.toUpperCase()).sort();
    const symbolsHash = createHash('sha256').update(symbols.join('\n')).digest('hex').slice(0, 24);
    return JSON.stringify({
      universeType: config.universeType,
      symbolsHash,
      n: symbols.length,
      analysisPeriod: config.analysisPeriod,
      resolution: config.resolution,
      predictionHorizon: config.predictionHorizon,
      mode: config.mode ?? 'STANDARD',
      intelligence: config.intelligence ?? null,
      readinessPolicy: config.readinessPolicy ?? null,
      analysisSession,
    });
  }

  async run(
    config: BatchPreflightConfiguration,
    opts?: MiCombinedPreflightRunOptions,
  ): Promise<CombinedBatchPreflightV2> {
    const analysisSession = normalizeAnalysisSession(config.analysisSession);
    const venueSessionOpen = isNseRegularSession();
    const plan = resolveDataRequirementPlan(
      hydratePreflightMembership({ ...config, analysisSession }),
    );
    plan.marketData.freshness = quoteFreshnessPolicyForAnalysisSession({
      analysisSession,
      venueSessionOpen,
    });
    const cacheKey = this.fingerprintPreflight(config, plan, analysisSession);

    if (opts?.allowCache) {
      const hit = this.verdictCache.get(cacheKey);
      if (hit && Date.now() - hit.at <= PREFLIGHT_VERDICT_CACHE_TTL_MS) {
        // Create gates on canAnalyze (research); mirrors canRun when venue is open.
        if (hit.verdict.canAnalyze === true) {
          return hit.verdict;
        }
      }
    }

    const resolved = plan.universe.resolved;
    const resolvedSymbols = resolved.map((i) => i.symbol.toUpperCase());
    const denom = resolvedSymbols.length;

    // Quote inventory first (single MDS /stocks?view=inventory). Running it in
    // parallel with 24 candle workers starves MDS and falsely yields
    // QUOTE_INVENTORY_UNAVAILABLE → create blocked after a green Review preflight.
    const marketData = await this.collectMarketData(resolvedSymbols, plan.asOf);
    const [historical, mi] = await Promise.all([
      this.collectHistorical(resolvedSymbols, plan.historical.minimumBarsPerInstrument),
      this.collectMiInventories(resolvedSymbols, plan.asOf, plan.newsLookbackDays, denom),
    ]);

    const inventories: Inventories = {
      marketData,
      historical,
      fundamentals: mi.fundamentals,
      news: mi.news,
      sentiment: mi.sentiment,
      corporateEvents: mi.corporateEvents,
      macro: mi.macro,
      social: naInventory(),
    };

    const combined = runReadinessPreflight({
      plan,
      inventories,
      readinessPolicy: config.readinessPolicy,
    });
    const latestMs = marketData.latestTimestamp ? Date.parse(marketData.latestTimestamp) : null;
    const verdict = applyAnalysisSessionToPreflight({
      combined,
      analysisSession,
      venueSessionOpen,
      latestQuoteTimestampMs: Number.isFinite(latestMs as number) ? latestMs : null,
    });
    this.verdictCache.set(cacheKey, { at: Date.now(), verdict });
    return verdict;
  }

  /** Pure evaluate path for tests (skip MDS/Prisma). */
  evaluateWithInventories(
    config: BatchPreflightConfiguration,
    inventories: Inventories,
    opts?: { venueSessionOpen?: boolean; nowMs?: number },
  ): CombinedBatchPreflightV2 {
    const analysisSession = normalizeAnalysisSession(config.analysisSession);
    const venueSessionOpen =
      opts?.venueSessionOpen ?? isNseRegularSession(opts?.nowMs ?? Date.now());
    const plan = resolveDataRequirementPlan(
      hydratePreflightMembership({ ...config, analysisSession }),
    );
    plan.marketData.freshness = quoteFreshnessPolicyForAnalysisSession({
      analysisSession,
      venueSessionOpen,
    });
    const combined = runReadinessPreflight({
      plan,
      inventories,
      readinessPolicy: config.readinessPolicy,
    });
    const latestMs = inventories.marketData.latestTimestamp
      ? Date.parse(inventories.marketData.latestTimestamp)
      : null;
    return applyAnalysisSessionToPreflight({
      combined,
      analysisSession,
      venueSessionOpen,
      latestQuoteTimestampMs: Number.isFinite(latestMs as number) ? latestMs : null,
      nowMs: opts?.nowMs,
    });
  }

  private async collectMarketData(symbols: string[], _asOf: string): Promise<CapabilityInventory> {
    const requiredCount = symbols.length;
    if (requiredCount === 0) {
      return emptyInventory(0);
    }
    const { quotes, error } = await this.agent.fetchQuoteInventory();
    if (error) {
      console.warn(`[mi-preflight] quote inventory unavailable: ${error}`);
    }
    const inventoryIssue = error ? 'QUOTE_INVENTORY_UNAVAILABLE' : 'QUOTE_MISSING';

    const sampleIssues: CapabilityInventory['sampleIssues'] = [];
    const perInstrument: NonNullable<CapabilityInventory['perInstrument']> = {};
    let available = 0;
    let latestMs = 0;
    for (const sym of symbols) {
      const q = quotes.get(sym) ?? quotes.get(sym.toUpperCase());
      if (q && Number.isFinite(q.price) && (q.price as number) > 0) {
        available += 1;
        const updatedAt = typeof q.updatedAt === 'number' ? q.updatedAt : 0;
        if (updatedAt > latestMs) latestMs = updatedAt;
        perInstrument[sym] = {
          ok: true,
          timestamp: updatedAt > 0 ? new Date(updatedAt).toISOString() : null,
        };
      } else {
        perInstrument[sym] = { ok: false, reason: inventoryIssue };
        if (sampleIssues!.length < 24) {
          sampleIssues!.push({ symbol: sym, issues: [inventoryIssue] });
        }
      }
    }

    return {
      available,
      requiredCount,
      latestTimestamp: latestMs > 0 ? new Date(latestMs).toISOString() : null,
      sampleIssues,
      freshnessApplicable: latestMs > 0,
      perInstrument,
      ...(error
        ? { inventoryReasons: ['QUOTE_INVENTORY_UNAVAILABLE' as const], readFailed: true }
        : {}),
    };
  }

  private async collectHistorical(
    symbols: string[],
    minBars: number,
  ): Promise<CapabilityInventory> {
    const requiredCount = symbols.length;
    if (requiredCount === 0) return emptyInventory(0);

    const sampleIssues: CapabilityInventory['sampleIssues'] = [];
    const perInstrument: NonNullable<CapabilityInventory['perInstrument']> = {};
    let available = 0;
    let cursor = 0;
    const workers = Math.min(PREFLIGHT_HISTORICAL_CONCURRENCY, Math.max(1, symbols.length));
    const deadline = Date.now() + PREFLIGHT_HISTORICAL_BUDGET_MS;
    let budgetExhausted = false;

    const runWorker = async () => {
      while (cursor < symbols.length) {
        if (Date.now() >= deadline) {
          budgetExhausted = true;
          return;
        }
        const idx = cursor;
        cursor += 1;
        const sym = symbols[idx];
        try {
          const candles = await this.agent.fetchNseDailyCandlesForBatch(sym, minBars, {
            timeoutMs: PREFLIGHT_CANDLE_TIMEOUT_MS,
            throwOnError: true,
          });
          if (candles.length >= minBars) {
            available += 1;
            perInstrument[sym] = { ok: true };
          } else {
            perInstrument[sym] = {
              ok: false,
              reason:
                candles.length === 0
                  ? 'NO_HISTORY'
                  : `INSUFFICIENT_HISTORY:${candles.length}<${minBars}`,
            };
            if (sampleIssues!.length < 24) {
              sampleIssues!.push({
                symbol: sym,
                issues: [`BARS_INSUFFICIENT:${candles.length}<${minBars}`],
              });
            }
          }
        } catch {
          perInstrument[sym] = { ok: false, reason: 'HISTORICAL_FETCH_FAILED' };
          if (sampleIssues!.length < 24) {
            sampleIssues!.push({ symbol: sym, issues: ['HISTORICAL_FETCH_FAILED'] });
          }
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, () => runWorker()));

    // Fail closed for symbols not reached within the wall-clock budget.
    if (budgetExhausted || Object.keys(perInstrument).length < symbols.length) {
      for (const sym of symbols) {
        if (perInstrument[sym]) continue;
        perInstrument[sym] = { ok: false, reason: 'HISTORICAL_FETCH_FAILED' };
        if (sampleIssues!.length < 24) {
          sampleIssues!.push({ symbol: sym, issues: ['HISTORICAL_BUDGET_EXCEEDED'] });
        }
      }
    }

    if (budgetExhausted) {
      console.warn(
        `[mi-preflight] historical budget ${PREFLIGHT_HISTORICAL_BUDGET_MS}ms exhausted; ` +
          `available=${available}/${requiredCount}`,
      );
    }

    return {
      available,
      requiredCount,
      latestTimestamp: null,
      sampleIssues,
      freshnessApplicable: false,
      perInstrument,
    };
  }

  private async collectMiInventories(
    symbols: string[],
    asOf: string,
    newsLookbackDays: number,
    denom: number,
  ): Promise<{
    fundamentals: CapabilityInventory;
    news: CapabilityInventory;
    sentiment: CapabilityInventory;
    corporateEvents: CapabilityInventory;
    macro: CapabilityInventory;
  }> {
    if (denom === 0) {
      return {
        fundamentals: emptyInventory(0),
        news: emptyInventory(0),
        sentiment: emptyInventory(0),
        corporateEvents: emptyInventory(0),
        macro: emptyInventory(0),
      };
    }

    const asOfDate = new Date(asOf);
    const newsWindowStart = new Date(asOfDate.getTime() - newsLookbackDays * 86_400_000);
    let pitExcluded = 0;

    try {
      const prisma = getPrismaClient();

      const fundFacts = await prisma.marketIntelligenceFact.findMany({
        where: {
          symbol: { in: symbols },
          metric: { in: ['revenue', 'pat', 'roe'] },
        },
        select: { symbol: true, metric: true, availableAt: true, publishedAt: true },
      });

      const fundBySym = new Map<string, Set<string>>();
      let fundLatest: string | null = null;
      for (const f of fundFacts) {
        if (!isPitEligible(f.publishedAt, f.availableAt, asOfDate)) {
          pitExcluded += 1;
          continue;
        }
        const set = fundBySym.get(f.symbol) ?? new Set();
        set.add(f.metric);
        fundBySym.set(f.symbol, set);
        const iso = f.availableAt.toISOString();
        if (!fundLatest || iso > fundLatest) fundLatest = iso;
      }
      let fundAvailable = 0;
      const fundPerInstrument: NonNullable<CapabilityInventory['perInstrument']> = {};
      for (const sym of symbols) {
        const m = fundBySym.get(sym);
        if (m && m.size >= 2) {
          fundAvailable += 1;
          fundPerInstrument[sym] = { ok: true };
        } else {
          fundPerInstrument[sym] = { ok: false, reason: 'FUNDAMENTALS_INCOMPLETE' };
        }
      }

      const corpEvents = await prisma.marketIntelligenceEvent.findMany({
        where: {
          symbol: { in: symbols },
          NOT: { category: 'NEWS' },
        },
        select: { symbol: true, availableAt: true, publishedAt: true },
      });
      const corpSet = new Set<string>();
      let corpLatest: string | null = null;
      for (const e of corpEvents) {
        if (!isPitEligible(e.publishedAt, e.availableAt, asOfDate)) {
          pitExcluded += 1;
          continue;
        }
        corpSet.add(e.symbol);
        const iso = e.availableAt.toISOString();
        if (!corpLatest || iso > corpLatest) corpLatest = iso;
      }

      const newsEvents = await prisma.marketIntelligenceEvent.findMany({
        where: {
          symbol: { in: symbols },
          category: 'NEWS',
          publishedAt: { gte: newsWindowStart, lte: asOfDate },
        },
        select: {
          symbol: true,
          availableAt: true,
          publishedAt: true,
          sentimentScore: true,
        },
      });

      const newsBy = new Map<
        string,
        { hasNews: boolean; scored: boolean; failedSentiment: boolean }
      >();
      let newsLatest: string | null = null;
      for (const n of newsEvents) {
        if (!isPitEligible(n.publishedAt, n.availableAt, asOfDate)) {
          pitExcluded += 1;
          continue;
        }
        const prev = newsBy.get(n.symbol) ?? {
          hasNews: false,
          scored: false,
          failedSentiment: false,
        };
        prev.hasNews = true;
        if (n.sentimentScore != null) prev.scored = true;
        else prev.failedSentiment = true;
        newsBy.set(n.symbol, prev);
        const iso = n.availableAt.toISOString();
        if (!newsLatest || iso > newsLatest) newsLatest = iso;
      }

      let newsAvailable = 0;
      let sentimentAvailable = 0;
      let sentimentDenom = 0;
      let sentimentFail = 0;
      for (const sym of symbols) {
        const row = newsBy.get(sym);
        if (!row?.hasNews) continue;
        newsAvailable += 1;
        sentimentDenom += 1;
        if (row.scored) sentimentAvailable += 1;
        else if (row.failedSentiment) sentimentFail += 1;
      }

      // Sentiment: N/A when no news (denom = instruments with news only).
      // FinBERT failure → SENTIMENT_UNAVAILABLE inventory reason when any failed.
      const sentimentReasons = sentimentFail > 0 ? (['SENTIMENT_UNAVAILABLE'] as const) : [];

      const macroDoc = await prisma.marketIntelligenceDocument.findFirst({
        where: { symbol: '__BATCH_MACRO__' },
        orderBy: { availableAt: 'desc' },
        select: { availableAt: true, publishedAt: true },
      });
      const macroOk =
        macroDoc != null && isPitEligible(macroDoc.publishedAt, macroDoc.availableAt, asOfDate);
      if (macroDoc && !macroOk) pitExcluded += 1;

      const pitReasons = pitExcluded > 0 ? (['PIT_DATA_EXCLUDED'] as const) : [];

      return {
        fundamentals: {
          available: fundAvailable,
          requiredCount: denom,
          latestTimestamp: fundLatest,
          freshnessApplicable: Boolean(fundLatest),
          inventoryReasons: [...pitReasons],
          perInstrument: fundPerInstrument,
        },
        news: {
          available: newsAvailable,
          requiredCount: denom,
          latestTimestamp: newsLatest,
          freshnessApplicable: Boolean(newsLatest),
          inventoryReasons: [...pitReasons],
        },
        sentiment: {
          available: sentimentAvailable,
          // Locked: no qualifying news → N/A (requiredCount 0 for those without news).
          // When news exists, sentiment denom = instruments with news.
          requiredCount: sentimentDenom,
          latestTimestamp: newsLatest,
          freshnessApplicable: Boolean(newsLatest),
          inventoryReasons: [...sentimentReasons, ...pitReasons],
        },
        corporateEvents: {
          available: corpSet.size,
          requiredCount: denom,
          latestTimestamp: corpLatest,
          freshnessApplicable: Boolean(corpLatest),
          inventoryReasons: [...pitReasons],
        },
        macro: {
          available: macroOk ? 1 : 0,
          requiredCount: 1,
          latestTimestamp: macroOk && macroDoc ? macroDoc.availableAt.toISOString() : null,
          freshnessApplicable: macroOk,
          inventoryReasons: [...pitReasons],
        },
      };
    } catch (err) {
      console.warn(
        `[mi-preflight] MI inventory unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        fundamentals: { ...emptyInventory(denom), readFailed: true },
        news: { ...emptyInventory(denom), readFailed: true },
        sentiment: { ...emptyInventory(0), readFailed: true },
        corporateEvents: { ...emptyInventory(denom), readFailed: true },
        macro: { ...emptyInventory(1), readFailed: true },
      };
    }
  }
}
