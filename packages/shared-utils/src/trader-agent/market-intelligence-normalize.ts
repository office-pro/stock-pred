/**
 * Market Intelligence normalization — source-native + canonical values.
 * Never silently overwrite; conflicts are recorded explicitly.
 */

import type {
  EvidenceSourceType,
  InstrumentRef,
  NormalizedFundamentalFact,
  NormalizedNewsItem,
  RawFundamentalRecord,
  RawNewsArticle,
} from '@stockpred/shared-types';
import { createHash } from 'crypto';

const NORMALIZED_VERSION = 'mi-normalize.v1';

export function contentHashOf(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Merge same-metric fundamentals from multiple sources; flag conflict when values disagree. */
export function normalizeFundamentalFacts(
  instrument: InstrumentRef,
  records: RawFundamentalRecord[],
): NormalizedFundamentalFact[] {
  const byMetric = new Map<string, RawFundamentalRecord[]>();
  for (const row of records) {
    const key = row.metric.trim().toUpperCase();
    if (!key) continue;
    const list = byMetric.get(key) ?? [];
    list.push(row);
    byMetric.set(key, list);
  }

  const out: NormalizedFundamentalFact[] = [];
  for (const [metric, rows] of byMetric) {
    const values = rows.map((r) => ({
      source: r.provenance.sourceType,
      value: toNumber(r.valueNative),
      unit: r.unitNative,
    }));
    const numeric = values.map((v) => v.value).filter((v): v is number => v != null);
    const unique = [...new Set(numeric.map((n) => Number(n.toFixed(6))))];
    const conflict = unique.length > 1;
    const preferred = rows[0]!;
    out.push({
      instrument,
      metric,
      value: conflict ? null : (numeric[0] ?? null),
      unit: preferred.unitNative ?? 'unknown',
      periodStart: preferred.periodStart,
      periodEnd: preferred.periodEnd,
      availableAt: preferred.provenance.availableAt,
      publishedAt: preferred.provenance.publishedAt,
      sourceDocumentId: preferred.provenance.sourceDocumentId,
      sources: [...new Set(rows.map((r) => r.provenance.sourceType))] as EvidenceSourceType[],
      conflict,
      values: conflict || values.length > 1 ? values : undefined,
    });
  }
  return out;
}

export function normalizeNewsArticle(
  instrument: InstrumentRef,
  article: RawNewsArticle,
): NormalizedNewsItem {
  const publishedAt = article.provenance.publishedAt ?? article.provenance.availableAt;
  return {
    instrument,
    articleId: article.articleId,
    headline: article.title,
    summary: article.summary,
    category: article.category,
    publishedAt,
    availableAt: article.provenance.availableAt,
    sourceDocumentId: article.provenance.sourceDocumentId,
    sources: [article.provenance.sourceType],
    eventId: contentHashOf([
      article.title.toLowerCase().trim(),
      instrument.symbol,
      publishedAt.slice(0, 10),
    ]),
  };
}

/** Deduplicate news by eventId / articleId — one logical event, multiple sources. */
export function dedupeNormalizedNews(items: NormalizedNewsItem[]): NormalizedNewsItem[] {
  const byKey = new Map<string, NormalizedNewsItem>();
  for (const item of items) {
    const key = item.eventId ?? item.articleId;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const sources = [...new Set([...existing.sources, ...item.sources])];
    byKey.set(key, { ...existing, sources });
  }
  return [...byKey.values()];
}

export { NORMALIZED_VERSION as MI_NORMALIZED_VERSION };
