/**
 * MI-7.2 — Catalyst engine from frozen MarketIntelligenceBatchSnapshot only.
 * PIT: publishedAt <= asOf AND availableAt <= asOf.
 * No BUY/SELL/TRADE scores. Candidate-order independent. Deterministic dedupe.
 */
import { createHash } from 'crypto';
import type {
  AdvancedCatalystItem,
  AdvancedCatalystPayload,
  AdvancedEvidenceRef,
  AdvancedIntelligenceSection,
  InstrumentMiNewsItem,
  InstrumentRef,
  MarketIntelligenceBatchSnapshot,
  TiCatalystDirection,
  TiCatalystType,
  TiEventRisk,
} from '@stockpred/shared-types';
import { emptySectionProvenance, unavailableSection } from './mi-advanced-contract';

export const MI_7_CATALYST_FEATURE_VERSION = 'mi-7-catalyst.v1';
export const MI_7_CATALYST_METHOD = 'frozen-mi-news-corporate.v1';

function toMs(ts: string | undefined): number | null {
  if (!ts) return null;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
}

/** PIT gate: both publishedAt and availableAt must be <= asOf. */
export function isCatalystPitSafe(
  item: Pick<InstrumentMiNewsItem, 'publishedAt' | 'availableAt'>,
  asOf: string,
): boolean {
  const asOfMs = toMs(asOf);
  const pub = toMs(item.publishedAt);
  const avail = toMs(item.availableAt);
  if (asOfMs == null || pub == null || avail == null) return false;
  return pub <= asOfMs && avail <= asOfMs;
}

function mapCategoryToType(category?: string): TiCatalystType {
  const c = (category ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const table: Record<string, TiCatalystType> = {
    EARNINGS: 'EARNINGS',
    GUIDANCE: 'GUIDANCE',
    DIVIDEND: 'DIVIDEND',
    CORPORATE_ACTION: 'CORPORATE_ACTION',
    BUYBACK: 'CORPORATE_ACTION',
    BONUS: 'CORPORATE_ACTION',
    SPLIT: 'CORPORATE_ACTION',
    MERGER: 'CORPORATE_ACTION',
    MERGER_ACQUISITION: 'CORPORATE_ACTION',
    REGULATORY: 'REGULATORY',
    MANAGEMENT: 'MANAGEMENT_EVENT',
    MANAGEMENT_CHANGE: 'MANAGEMENT_EVENT',
    MANAGEMENT_EVENT: 'MANAGEMENT_EVENT',
    ORDER: 'ORDER_WIN',
    ORDER_WIN: 'ORDER_WIN',
    ORDER_CONTRACT: 'ORDER_WIN',
    MACRO: 'MACRO',
    SECTOR: 'SECTOR_EVENT',
    SECTOR_EVENT: 'SECTOR_EVENT',
    NEWS: 'NEWS',
  };
  return table[c] ?? (c ? 'OTHER' : 'NEWS');
}

function directionFromSentiment(score?: number | null, label?: string | null): TiCatalystDirection {
  if (score != null && Number.isFinite(score)) {
    if (score >= 0.35) return 'BULLISH';
    if (score <= -0.35) return 'BEARISH';
    if (Math.abs(score) < 0.1) return 'NEUTRAL';
    return 'UNKNOWN';
  }
  const l = (label ?? '').toUpperCase();
  if (l.includes('BULL') || l.includes('POS')) return 'BULLISH';
  if (l.includes('BEAR') || l.includes('NEG')) return 'BEARISH';
  if (l.includes('NEUT')) return 'NEUTRAL';
  return 'UNKNOWN';
}

function evidenceIdFor(kind: string, item: InstrumentMiNewsItem, symbol: string): string {
  const base =
    item.eventId?.trim() ||
    `${kind}|${item.publishedAt}|${(item.headline ?? '').slice(0, 64)}|${symbol}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 24);
}

function itemToCatalyst(
  item: InstrumentMiNewsItem,
  kind: 'news' | 'corporate',
  symbol: string,
): AdvancedCatalystItem {
  const evidenceId = evidenceIdFor(kind, item, symbol);
  return {
    type:
      kind === 'corporate'
        ? mapCategoryToType(item.category || 'CORPORATE_ACTION')
        : mapCategoryToType(item.category),
    direction: directionFromSentiment(item.sentimentScore, item.sentimentLabel),
    materiality: 'MED',
    eventDate: item.publishedAt,
    publishedAt: item.publishedAt,
    availableAt: item.availableAt,
    confidence: item.sentimentScore != null ? 'MED' : 'LOW',
    evidenceIds: [evidenceId],
    title: item.headline,
  };
}

/** Deterministic sort + evidenceId dedupe (first wins after sort). */
export function dedupeCatalystItems(items: AdvancedCatalystItem[]): AdvancedCatalystItem[] {
  const sorted = [...items].sort((a, b) => {
    if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? -1 : 1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    const ta = a.title ?? '';
    const tb = b.title ?? '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ea = a.evidenceIds[0] ?? '';
    const eb = b.evidenceIds[0] ?? '';
    return ea < eb ? -1 : ea > eb ? 1 : 0;
  });
  const seen = new Set<string>();
  const out: AdvancedCatalystItem[] = [];
  for (const c of sorted) {
    const key = c.evidenceIds.slice().sort().join(',') || `${c.type}|${c.publishedAt}|${c.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...c,
      evidenceIds: [...c.evidenceIds].sort(),
    });
  }
  return out;
}

function resolveEventRisk(catalysts: AdvancedCatalystItem[]): TiEventRisk {
  if (catalysts.length === 0) return 'NONE';
  const binary = new Set<TiCatalystType>([
    'EARNINGS',
    'GUIDANCE',
    'REGULATORY',
    'MANAGEMENT_EVENT',
    'CORPORATE_ACTION',
  ]);
  if (catalysts.some((c) => binary.has(c.type) && c.direction === 'UNKNOWN')) return 'HIGH';
  if (catalysts.some((c) => c.materiality === 'HIGH')) return 'MED';
  if (catalysts.length >= 3) return 'MED';
  return 'LOW';
}

export function assessAdvancedCatalystSection(input: {
  instrument: InstrumentRef;
  miSnapshot: MarketIntelligenceBatchSnapshot;
  asOf?: string;
  calculatedAt?: string;
}): AdvancedIntelligenceSection<AdvancedCatalystPayload> {
  const symbol = input.instrument.symbol.trim().toUpperCase();
  const asOf = input.asOf ?? input.miSnapshot.asOf;
  const calculatedAt = input.calculatedAt ?? asOf;
  const sourceId = input.miSnapshot.snapshotId;
  const bundle = input.miSnapshot.bySymbol[symbol];

  if (!bundle) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_CATALYST_METHOD,
      reason: 'SYMBOL_NOT_IN_MI_SNAPSHOT',
      status: 'UNAVAILABLE',
    }) as AdvancedIntelligenceSection<AdvancedCatalystPayload>;
  }

  const newsStatus = bundle.news.status;
  const corpStatus = bundle.corporateEvents.status;
  if (
    newsStatus === 'NOT_APPLICABLE' &&
    (corpStatus === 'NOT_APPLICABLE' || corpStatus === 'UNAVAILABLE')
  ) {
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_CATALYST_METHOD,
      reason: 'NEWS_NOT_APPLICABLE',
      status: 'NOT_APPLICABLE',
    }) as AdvancedIntelligenceSection<AdvancedCatalystPayload>;
  }

  const rawNews = [...(bundle.news.items ?? [])];
  const rawCorp = [...(bundle.corporateEvents.items ?? [])];
  // Shuffle-proof: sort inputs before mapping
  rawNews.sort((a, b) =>
    a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : 0,
  );
  rawCorp.sort((a, b) =>
    a.publishedAt < b.publishedAt ? -1 : a.publishedAt > b.publishedAt ? 1 : 0,
  );

  const pitNews = rawNews.filter((i) => isCatalystPitSafe(i, asOf));
  const pitCorp = rawCorp.filter((i) => isCatalystPitSafe(i, asOf));
  const excluded = rawNews.length + rawCorp.length - pitNews.length - pitCorp.length;

  const mapped = [
    ...pitNews.map((i) => itemToCatalyst(i, 'news', symbol)),
    ...pitCorp.map((i) => itemToCatalyst(i, 'corporate', symbol)),
  ];
  const catalysts = dedupeCatalystItems(mapped);

  if (catalysts.length === 0) {
    const status =
      rawNews.length + rawCorp.length > 0 && excluded > 0
        ? 'UNAVAILABLE'
        : newsStatus === 'UNAVAILABLE' && corpStatus === 'UNAVAILABLE'
          ? 'UNAVAILABLE'
          : 'DATA_INCOMPLETE';
    return unavailableSection({
      asOf,
      sourceSnapshotId: sourceId,
      method: MI_7_CATALYST_METHOD,
      reason:
        excluded > 0
          ? 'ALL_EVENTS_FAILED_PIT_OR_EMPTY_AFTER_DEDUPE'
          : 'NO_QUALIFYING_CATALYST_EVIDENCE',
      status,
    }) as AdvancedIntelligenceSection<AdvancedCatalystPayload>;
  }

  const evidenceIds = [...new Set(catalysts.flatMap((c) => c.evidenceIds))].sort();
  const evidence: AdvancedEvidenceRef[] = evidenceIds.map((evidenceId) => ({
    evidenceId,
    kind: 'catalyst',
    sourceSnapshotId: sourceId,
  }));

  const payload: AdvancedCatalystPayload = {
    catalysts,
    eventRisk: resolveEventRisk(catalysts),
  };

  const partial =
    excluded > 0 ||
    newsStatus === 'UNAVAILABLE' ||
    corpStatus === 'UNAVAILABLE' ||
    (pitNews.length === 0 && pitCorp.length > 0);

  return {
    status: partial ? 'PARTIAL' : 'AVAILABLE',
    provenance: emptySectionProvenance({
      asOf,
      calculatedAt,
      method: MI_7_CATALYST_METHOD,
      featureVersion: MI_7_CATALYST_FEATURE_VERSION,
      sourceSnapshotId: sourceId,
      sourceSnapshotIds: [sourceId, input.miSnapshot.dataSnapshotVersion],
      status: partial ? 'PARTIAL' : 'AVAILABLE',
      inputsUsed: [
        'mi.news',
        'mi.corporateEvents',
        `pitExcluded=${excluded}`,
        `candidateCount=${rawNews.length + rawCorp.length}`,
      ],
      evidenceIds,
    }),
    evidence,
    payload,
  };
}
