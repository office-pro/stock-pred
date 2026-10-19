/**
 * MI-5: build + persist MarketIntelligenceBatchSnapshot from Prisma (dual PIT).
 */

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { getPrismaClient } from '@stockpred/database';
import type {
  BatchDataSnapshot,
  InstrumentMiBundle,
  InstrumentRef,
  MarketIntelligenceBatchSnapshot,
  ReadinessPolicy,
} from '@stockpred/shared-types';
import {
  isPitEligible,
  miSentimentFromScore,
  nseEquityInstrumentRef,
  technicalFromFrozenRow,
  withMiSnapshotReadinessPolicy,
} from '@stockpred/shared-utils';
import {
  readMarketIntelligenceBatchSnapshot,
  writeMarketIntelligenceBatchSnapshot,
} from './intelligence-batch-store';

/** Cap FinBERT backfill calls per MI snapshot build (bounded, never fabricates 0/NEUTRAL). */
const FINBERT_BACKFILL_MAX = 40;

export type MiHeadlineScorer = (text: string) => Promise<number | null>;

function sameReadinessPolicy(
  a: ReadinessPolicy | undefined,
  b: ReadinessPolicy | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

@Injectable()
export class MiBatchSnapshotService {
  async buildAndPersist(input: {
    batchId: string;
    dataSnapshot: BatchDataSnapshot;
    asOf: string;
    universeType: string;
    newsLookbackDays?: number;
    /** Optional observe-only FinBERT scorer for unscored PIT news (bounded). */
    scoreHeadline?: MiHeadlineScorer;
    /** ES-10 — frozen create-time policy; omitted when create used STRICT_ALL default. */
    readinessPolicy?: ReadinessPolicy;
  }): Promise<MarketIntelligenceBatchSnapshot> {
    const existing = readMarketIntelligenceBatchSnapshot(input.batchId);
    if (
      existing &&
      existing.dataSnapshotVersion === input.dataSnapshot.dataSnapshotVersion &&
      existing.asOf === input.asOf
    ) {
      // Reuse MI facts; stamp policy if create supplied one and it was missing/stale.
      if (
        !input.readinessPolicy ||
        sameReadinessPolicy(existing.readinessPolicy, input.readinessPolicy)
      ) {
        return existing;
      }
      const stamped = withMiSnapshotReadinessPolicy(existing, input.readinessPolicy);
      writeMarketIntelligenceBatchSnapshot(stamped);
      return stamped;
    }

    const asOf = input.asOf;
    const asOfDate = new Date(asOf);
    const lookbackDays = input.newsLookbackDays ?? 30;
    const newsWindowStart = new Date(asOfDate.getTime() - lookbackDays * 86_400_000);
    const instruments: InstrumentRef[] = input.dataSnapshot.instruments.map((r) => {
      if (r.instrumentRef) return r.instrumentRef;
      return nseEquityInstrumentRef('');
    });
    const symbols = instruments.map((i) => i.symbol.toUpperCase());
    const rowBySym = new Map(
      input.dataSnapshot.instruments.map((r) => [r.instrumentRef.symbol.toUpperCase(), r] as const),
    );

    const bySymbol: Record<string, InstrumentMiBundle> = {};
    let fundamentalsAvailable = 0;
    let newsAvailable = 0;
    let sentimentAvailable = 0;
    let corporateAvailable = 0;
    let technicalAvailable = 0;

    try {
      const prisma = getPrismaClient();
      const fundFacts = await prisma.marketIntelligenceFact.findMany({
        where: {
          symbol: { in: symbols },
          metric: { in: ['revenue', 'pat', 'roe', 'pe', 'pb', 'netIncome'] },
        },
        select: {
          id: true,
          symbol: true,
          metric: true,
          value: true,
          unit: true,
          availableAt: true,
          publishedAt: true,
        },
      });
      const fundBy = new Map<string, typeof fundFacts>();
      for (const f of fundFacts) {
        if (!isPitEligible(f.publishedAt, f.availableAt, asOfDate)) continue;
        const list = fundBy.get(f.symbol) ?? [];
        list.push(f);
        fundBy.set(f.symbol, list);
      }

      const events = await prisma.marketIntelligenceEvent.findMany({
        where: {
          symbol: { in: symbols },
          publishedAt: { lte: asOfDate },
        },
        select: {
          id: true,
          symbol: true,
          eventId: true,
          headline: true,
          category: true,
          publishedAt: true,
          availableAt: true,
          sentimentScore: true,
          sentimentLabel: true,
        },
      });

      const newsBy = new Map<string, typeof events>();
      const corpBy = new Map<string, typeof events>();
      for (const e of events) {
        if (!isPitEligible(e.publishedAt, e.availableAt, asOfDate)) continue;
        if (e.category === 'NEWS') {
          if (e.publishedAt < newsWindowStart) continue;
          const list = newsBy.get(e.symbol) ?? [];
          list.push(e);
          newsBy.set(e.symbol, list);
        } else {
          const list = corpBy.get(e.symbol) ?? [];
          list.push(e);
          corpBy.set(e.symbol, list);
        }
      }

      // Bounded FinBERT backfill for unscored news headlines (in-memory + best-effort Prisma write).
      const scoreCache = new Map<string, number | null>();
      let backfillCalls = 0;
      if (input.scoreHeadline) {
        const unscored: Array<{ id: string; headline: string }> = [];
        for (const list of newsBy.values()) {
          for (const n of list) {
            if (n.sentimentScore != null || !n.headline?.trim()) continue;
            unscored.push({ id: n.id, headline: n.headline.trim() });
          }
        }
        for (const item of unscored.slice(0, FINBERT_BACKFILL_MAX)) {
          const key = item.headline.toLowerCase();
          if (!scoreCache.has(key)) {
            if (backfillCalls >= FINBERT_BACKFILL_MAX) break;
            backfillCalls += 1;
            try {
              scoreCache.set(key, await input.scoreHeadline(item.headline));
            } catch {
              scoreCache.set(key, null);
            }
          }
          const score = scoreCache.get(key) ?? null;
          if (score == null || !Number.isFinite(score)) continue;
          // Mutate in-memory event row used below.
          for (const list of newsBy.values()) {
            const row = list.find((e) => e.id === item.id);
            if (row) {
              (row as { sentimentScore: number | null }).sentimentScore = score;
              break;
            }
          }
          try {
            await prisma.marketIntelligenceEvent.update({
              where: { id: item.id },
              data: { sentimentScore: score },
            });
          } catch {
            /* observe-only persist; ignore write failures */
          }
        }
      }

      const macroDoc = await prisma.marketIntelligenceDocument.findFirst({
        where: { symbol: '__BATCH_MACRO__' },
        orderBy: { availableAt: 'desc' },
        select: { availableAt: true, publishedAt: true },
      });
      const macroOk =
        macroDoc != null && isPitEligible(macroDoc.publishedAt, macroDoc.availableAt, asOfDate);

      for (const inst of instruments) {
        const sym = inst.symbol.toUpperCase();
        const facts = fundBy.get(sym) ?? [];
        const metrics = new Set(facts.map((f) => f.metric));
        const fundStatus =
          metrics.size >= 2 ? 'AVAILABLE' : metrics.size === 1 ? 'PARTIAL' : 'UNAVAILABLE';
        if (fundStatus === 'AVAILABLE' || fundStatus === 'PARTIAL') fundamentalsAvailable += 1;

        const newsItems = (newsBy.get(sym) ?? []).map((n) => ({
          eventId: n.eventId ?? n.id,
          headline: n.headline ?? undefined,
          publishedAt: n.publishedAt.toISOString(),
          availableAt: n.availableAt.toISOString(),
          sentimentScore: n.sentimentScore,
          sentimentLabel: n.sentimentLabel,
          category: n.category ?? undefined,
        }));
        const corpItems = (corpBy.get(sym) ?? []).map((n) => ({
          eventId: n.eventId ?? n.id,
          headline: n.headline ?? undefined,
          publishedAt: n.publishedAt.toISOString(),
          availableAt: n.availableAt.toISOString(),
          category: n.category ?? undefined,
        }));

        const newsStatus = newsItems.length > 0 ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const);
        if (newsStatus === 'AVAILABLE') newsAvailable += 1;
        if (corpItems.length > 0) corporateAvailable += 1;

        let sentiment: InstrumentMiBundle['sentiment'];
        if (newsItems.length === 0) {
          sentiment = { availability: 'NOT_APPLICABLE' };
        } else {
          const scored = newsItems.find((n) => n.sentimentScore != null);
          if (scored) {
            const derived = miSentimentFromScore(scored.sentimentScore, 'finbert');
            if (derived.status === 'scored') {
              sentiment = {
                availability: 'AVAILABLE',
                score: derived.score,
                label: derived.label,
                modelVersion: derived.modelVersion,
                confidence: derived.confidence,
              };
              sentimentAvailable += 1;
            } else {
              sentiment = { availability: 'UNAVAILABLE' };
            }
          } else {
            sentiment = { availability: 'UNAVAILABLE' };
          }
        }

        const technical = technicalFromFrozenRow(rowBySym.get(sym));
        if (technical?.status === 'AVAILABLE') technicalAvailable += 1;

        bySymbol[sym] = {
          instrument: inst,
          fundamentals: {
            status: fundStatus,
            facts: facts.map((f) => ({
              factId: f.id,
              metric: f.metric,
              value: f.value,
              unit: f.unit,
              availableAt: f.availableAt.toISOString(),
              publishedAt: f.publishedAt?.toISOString() ?? null,
            })),
          },
          news: { status: newsStatus, items: newsItems },
          corporateEvents: {
            status: corpItems.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
            items: corpItems,
          },
          sentiment,
          technical,
        };
      }

      const snapshot = withMiSnapshotReadinessPolicy(
        {
          schemaVersion: 'mi-batch-snapshot.v1' as const,
          snapshotId: `MI-${input.batchId}-${randomUUID().slice(0, 8)}`,
          batchId: input.batchId,
          dataSnapshotVersion: input.dataSnapshot.dataSnapshotVersion,
          asOf,
          universeType: input.universeType,
          instruments,
          bySymbol,
          macro: {
            available: macroOk,
            availableAt: macroOk && macroDoc ? macroDoc.availableAt.toISOString() : undefined,
            publishedAt: macroOk && macroDoc ? (macroDoc.publishedAt?.toISOString() ?? null) : null,
          },
          coverage: {
            fundamentalsAvailable,
            newsAvailable,
            sentimentAvailable,
            corporateAvailable,
            technicalAvailable,
            eligible: symbols.length,
          },
          generatedAt: new Date().toISOString(),
        },
        input.readinessPolicy,
      );
      writeMarketIntelligenceBatchSnapshot(snapshot);
      return snapshot;
    } catch {
      // Empty snapshot — Generate gate will decide GENERATION_INPUT_INCOMPLETE
      const empty = withMiSnapshotReadinessPolicy(
        {
          schemaVersion: 'mi-batch-snapshot.v1' as const,
          snapshotId: `MI-${input.batchId}-empty`,
          batchId: input.batchId,
          dataSnapshotVersion: input.dataSnapshot.dataSnapshotVersion,
          asOf,
          universeType: input.universeType,
          instruments,
          bySymbol: Object.fromEntries(
            instruments.map((inst) => {
              const sym = inst.symbol.toUpperCase();
              const technical = technicalFromFrozenRow(rowBySym.get(sym));
              if (technical?.status === 'AVAILABLE') technicalAvailable += 1;
              return [
                sym,
                {
                  instrument: inst,
                  fundamentals: { status: 'UNAVAILABLE' as const, facts: [] },
                  news: { status: 'UNAVAILABLE' as const, items: [] },
                  corporateEvents: { status: 'UNAVAILABLE' as const, items: [] },
                  sentiment: { availability: 'NOT_APPLICABLE' as const },
                  technical,
                } satisfies InstrumentMiBundle,
              ];
            }),
          ),
          coverage: {
            fundamentalsAvailable: 0,
            newsAvailable: 0,
            sentimentAvailable: 0,
            corporateAvailable: 0,
            technicalAvailable,
            eligible: symbols.length,
          },
          generatedAt: new Date().toISOString(),
        },
        input.readinessPolicy,
      );
      writeMarketIntelligenceBatchSnapshot(empty);
      return empty;
    }
  }
}
