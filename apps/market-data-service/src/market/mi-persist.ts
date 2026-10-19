/**
 * Additive MI persistence into MarketIntelligence* tables.
 * Never wipes legacy fundamentalSnapshot / newsArticle / macroDailyFeature.
 * Provider miss → skip write (keep prior MI rows).
 */

import { createHash } from 'crypto';
import { getPrismaClient } from '@stockpred/database';
import {
  classifyMiCorporateEventType,
  isAvailableAtAllowed,
  miContentHash,
  nseEquityInstrumentRef,
} from '@stockpred/shared-utils';
import type { FundamentalSnapshotInput } from './providers/yahoo-fundamentals';
import type { NseCorporatePanelRow } from './providers/nse-corporate';

function hash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function asDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Persist fundamental snapshots as MI documents + facts (additive). */
export async function persistMiFundamentalsFromSnapshots(
  rows: FundamentalSnapshotInput[],
  opts?: { asOf?: string },
): Promise<{ written: number; skippedFuture: number }> {
  if (!rows.length) return { written: 0, skippedFuture: 0 };
  const prisma = getPrismaClient();
  const asOf = opts?.asOf ?? new Date().toISOString();
  let written = 0;
  let skippedFuture = 0;

  for (const row of rows) {
    const availableAt =
      row.availableAt instanceof Date ? row.availableAt : new Date(row.availableAt);
    if (!isAvailableAtAllowed(availableAt.toISOString(), asOf)) {
      skippedFuture += 1;
      continue;
    }
    const instrument = nseEquityInstrumentRef(row.symbol);
    const contentHash = hash([
      row.symbol,
      row.asOfDate.toISOString(),
      row.source,
      row.revenue,
      row.pat,
      row.roe,
    ]);
    const existing = await prisma.marketIntelligenceDocument.findFirst({
      where: { contentHash, symbol: row.symbol },
    });
    if (existing) continue;

    const doc = await prisma.marketIntelligenceDocument.create({
      data: {
        symbol: row.symbol,
        venue: 'NSE',
        assetClass: 'EQUITY',
        sourceType: String(row.source ?? 'nse')
          .toLowerCase()
          .includes('yahoo')
          ? 'YAHOO'
          : 'NSE',
        evidenceKind: 'FUNDAMENTAL',
        title: `${row.symbol} fundamentals ${row.asOfDate.toISOString().slice(0, 10)}`,
        publishedAt: row.asOfDate,
        availableAt,
        retrievedAt: new Date(),
        contentHash,
        parserVersion: 'mi-persist.v1',
        metadata: {
          symbol: instrument.symbol,
          venue: instrument.venue,
          assetClass: instrument.assetClass,
        },
      },
    });

    const metrics: Array<{ metric: string; value: number | null | undefined; unit: string }> = [
      { metric: 'revenue', value: row.revenue, unit: 'INR' },
      { metric: 'pat', value: row.pat, unit: 'INR' },
      { metric: 'eps', value: row.eps, unit: 'INR' },
      { metric: 'ebitda', value: row.ebitda, unit: 'INR' },
      { metric: 'cash', value: row.cash, unit: 'INR' },
      { metric: 'fcf', value: row.fcf, unit: 'INR' },
      { metric: 'total_debt', value: row.totalDebt, unit: 'INR' },
      { metric: 'roe', value: row.roe, unit: 'pct' },
      { metric: 'roce', value: row.roce, unit: 'pct' },
      { metric: 'op_margin', value: row.opMargin, unit: 'pct' },
      { metric: 'net_margin', value: row.netMargin, unit: 'pct' },
      { metric: 'trailing_pe', value: row.trailingPe, unit: 'ratio' },
      { metric: 'price_to_book', value: row.priceToBook, unit: 'ratio' },
      { metric: 'promoter_holding', value: row.promoterHolding, unit: 'pct' },
      { metric: 'institution_holding', value: row.institutionHolding, unit: 'pct' },
    ];

    for (const m of metrics) {
      if (m.value == null || !Number.isFinite(m.value)) continue;
      await prisma.marketIntelligenceFact.create({
        data: {
          documentId: doc.id,
          symbol: row.symbol,
          venue: 'NSE',
          metric: m.metric,
          value: m.value,
          unit: m.unit,
          periodEnd: row.asOfDate,
          availableAt,
          publishedAt: row.asOfDate,
          conflict: false,
          sourcesJson: [row.source ?? 'nse'],
        },
      });
    }
    await prisma.marketIntelligenceSourceLink.create({
      data: {
        documentId: doc.id,
        sourceType: String(row.source ?? 'nse')
          .toUpperCase()
          .includes('YAHOO')
          ? 'YAHOO'
          : 'NSE',
        sourceDocId: contentHash,
      },
    });
    written += 1;
  }
  return { written, skippedFuture };
}

/** Persist corporate panel rows as MI events (not news). */
export async function persistMiCorporateRows(
  rows: NseCorporatePanelRow[],
  opts?: { asOf?: string },
): Promise<{ written: number; skippedFuture: number }> {
  if (!rows.length) return { written: 0, skippedFuture: 0 };
  const prisma = getPrismaClient();
  const asOf = opts?.asOf ?? new Date().toISOString();
  let written = 0;
  let skippedFuture = 0;

  for (const row of rows) {
    const availableAt = asDate(row.available_at) ?? new Date();
    if (!isAvailableAtAllowed(availableAt.toISOString(), asOf)) {
      skippedFuture += 1;
      continue;
    }
    const publishedAt = asDate(row.published_at) ?? availableAt;
    const eventType = classifyMiCorporateEventType(row.event_type || row.headline || row.kind);
    const contentHash = miContentHash([
      row.symbol,
      eventType,
      row.headline,
      publishedAt.toISOString().slice(0, 10),
    ]);
    const existing = await prisma.marketIntelligenceDocument.findFirst({
      where: { contentHash, symbol: row.symbol },
    });
    if (existing) continue;

    const evidenceKind =
      row.kind === 'SHAREHOLDING'
        ? 'SHAREHOLDING'
        : row.kind === 'CORPORATE_ACTION'
          ? 'CORPORATE_ACTION'
          : 'FILING';

    const doc = await prisma.marketIntelligenceDocument.create({
      data: {
        symbol: row.symbol,
        venue: 'NSE',
        assetClass: 'EQUITY',
        sourceType: 'NSE',
        evidenceKind,
        title: row.headline,
        url: row.url,
        publishedAt,
        availableAt,
        retrievedAt: new Date(),
        contentHash,
        parserVersion: 'mi-persist.v1',
      },
    });
    await prisma.marketIntelligenceEvent.create({
      data: {
        documentId: doc.id,
        eventId: contentHash,
        symbol: row.symbol,
        venue: 'NSE',
        eventType,
        headline: row.headline,
        category: row.kind,
        publishedAt,
        availableAt,
      },
    });
    written += 1;
  }
  return { written, skippedFuture };
}

export async function persistMiNewsArticles(
  rows: Array<{
    symbol: string;
    articleId: string;
    title: string;
    source: string;
    url?: string;
    publishedAt: Date | string;
    summary?: string;
    sentimentScore?: number | null;
    sentimentLabel?: string | null;
    modelVersion?: string;
  }>,
  opts?: { asOf?: string },
): Promise<{ written: number; skippedFuture: number }> {
  if (!rows.length) return { written: 0, skippedFuture: 0 };
  const prisma = getPrismaClient();
  const asOf = opts?.asOf ?? new Date().toISOString();
  let written = 0;
  let skippedFuture = 0;

  for (const row of rows) {
    const publishedAt = asDate(row.publishedAt) ?? new Date();
    if (!isAvailableAtAllowed(publishedAt.toISOString(), asOf)) {
      skippedFuture += 1;
      continue;
    }
    const contentHash = miContentHash([row.symbol, row.title.toLowerCase().trim(), row.articleId]);
    const existing = await prisma.marketIntelligenceDocument.findFirst({
      where: { contentHash, symbol: row.symbol },
    });
    if (existing) continue;

    const sourceType = row.source.toLowerCase().includes('gdelt')
      ? 'OTHER'
      : row.source.toLowerCase().includes('nse')
        ? 'NSE'
        : 'OTHER';

    const doc = await prisma.marketIntelligenceDocument.create({
      data: {
        symbol: row.symbol,
        venue: 'NSE',
        assetClass: 'EQUITY',
        sourceType,
        evidenceKind: 'NEWS',
        title: row.title,
        url: row.url,
        publishedAt,
        availableAt: publishedAt,
        retrievedAt: new Date(),
        contentHash,
        parserVersion: 'mi-persist.v1',
        rawReference: row.summary,
      },
    });

    const sentimentScore =
      row.sentimentScore != null && Number.isFinite(row.sentimentScore) ? row.sentimentScore : null;

    await prisma.marketIntelligenceEvent.create({
      data: {
        documentId: doc.id,
        eventId: row.articleId || contentHash,
        symbol: row.symbol,
        venue: 'NSE',
        eventType: 'OTHER',
        headline: row.title,
        category: 'NEWS',
        sentimentLabel: sentimentScore == null ? null : row.sentimentLabel,
        sentimentScore,
        publishedAt,
        availableAt: publishedAt,
      },
    });
    written += 1;
  }
  return { written, skippedFuture };
}

/** One batch-level macro snapshot as MI facts (symbol = __BATCH_MACRO__). */
export async function persistMiMacroSnapshot(input: {
  asOf: Date;
  series: Array<{ metric: string; value: number; source: string; availableAt?: Date }>;
}): Promise<{ written: number }> {
  if (!input.series.length) return { written: 0 };
  const prisma = getPrismaClient();
  const contentHash = miContentHash([
    'BATCH_MACRO',
    input.asOf.toISOString().slice(0, 10),
    input.series.map((s) => [s.metric, s.value, s.source]),
  ]);
  const existing = await prisma.marketIntelligenceDocument.findFirst({
    where: { contentHash, symbol: '__BATCH_MACRO__' },
  });
  if (existing) return { written: 0 };

  const doc = await prisma.marketIntelligenceDocument.create({
    data: {
      symbol: '__BATCH_MACRO__',
      venue: 'NSE',
      assetClass: 'EQUITY',
      sourceType: 'OTHER',
      evidenceKind: 'OTHER',
      title: `India macro ${input.asOf.toISOString().slice(0, 10)}`,
      publishedAt: input.asOf,
      availableAt: input.asOf,
      retrievedAt: new Date(),
      contentHash,
      parserVersion: 'mi-persist.v1',
      metadata: { snapshotType: 'INDIA_MACRO' },
    },
  });

  let written = 0;
  for (const s of input.series) {
    await prisma.marketIntelligenceFact.create({
      data: {
        documentId: doc.id,
        symbol: '__BATCH_MACRO__',
        venue: 'NSE',
        metric: s.metric,
        value: s.value,
        unit: 'level',
        periodEnd: input.asOf,
        availableAt: s.availableAt ?? input.asOf,
        publishedAt: input.asOf,
        sourcesJson: [s.source],
      },
    });
    written += 1;
  }
  return { written };
}

export async function queryMiCoverageInventory(symbols: string[]): Promise<{
  fundSymbols: Set<string>;
  fundPartial: Set<string>;
  corpSymbols: Set<string>;
  newsSymbols: Set<string>;
  sentimentScored: Set<string>;
  macroAvailable: boolean;
}> {
  const prisma = getPrismaClient();
  const upper = symbols.map((s) => s.toUpperCase());
  const fundFacts = await prisma.marketIntelligenceFact.findMany({
    where: {
      symbol: { in: upper },
      metric: { in: ['revenue', 'pat', 'roe'] },
    },
    select: { symbol: true, metric: true },
  });
  const bySym = new Map<string, Set<string>>();
  for (const f of fundFacts) {
    const set = bySym.get(f.symbol) ?? new Set();
    set.add(f.metric);
    bySym.set(f.symbol, set);
  }
  const fundSymbols = new Set<string>();
  const fundPartial = new Set<string>();
  for (const [sym, metrics] of bySym) {
    if (metrics.size >= 2) fundSymbols.add(sym);
    else fundPartial.add(sym);
  }

  const corpEvents = await prisma.marketIntelligenceEvent.findMany({
    where: {
      symbol: { in: upper },
      NOT: { category: 'NEWS' },
    },
    select: { symbol: true },
    distinct: ['symbol'],
  });
  const newsEvents = await prisma.marketIntelligenceEvent.findMany({
    where: { symbol: { in: upper }, category: 'NEWS' },
    select: { symbol: true, sentimentScore: true },
  });
  const corpSymbols = new Set(corpEvents.map((e) => e.symbol));
  const newsSymbols = new Set(newsEvents.map((e) => e.symbol));
  const sentimentScored = new Set(
    newsEvents.filter((e) => e.sentimentScore != null).map((e) => e.symbol),
  );
  const macro = await prisma.marketIntelligenceDocument.findFirst({
    where: { symbol: '__BATCH_MACRO__' },
    orderBy: { availableAt: 'desc' },
  });
  return {
    fundSymbols,
    fundPartial,
    corpSymbols,
    newsSymbols,
    sentimentScored,
    macroAvailable: Boolean(macro),
  };
}
