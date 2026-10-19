/**
 * GDELT entity link: keep an article only if the title mentions a frozen alias.
 * Unmatched rows are dropped — never guessed onto a symbol.
 */

export interface GdeltHeadline {
  source: string;
  url?: string;
  title: string;
  publishedAt?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GDELT entity link: keep the article only if the title mentions a known alias. */
export function titleMatchesAliases(title: string, aliases: string[]): boolean {
  const hay = title.toUpperCase();
  for (const raw of aliases) {
    const alias = raw.trim().toUpperCase();
    if (alias.length < 2) continue;
    if (alias.length <= 6 && !/\s/.test(alias)) {
      const re = new RegExp(`(?:^|[^A-Z0-9])${escapeRegExp(alias)}(?:$|[^A-Z0-9])`, 'i');
      if (re.test(title)) return true;
    } else if (hay.includes(alias)) {
      return true;
    }
  }
  return false;
}

export function filterGdeltByAliases(rows: GdeltHeadline[], aliases: string[]): GdeltHeadline[] {
  if (aliases.length === 0) return [];
  return rows.filter((row) => row.source !== 'gdelt' || titleMatchesAliases(row.title, aliases));
}

export function frozenAliasesForRef(input: {
  symbol: string;
  canonicalSymbol?: string;
  name?: string;
}): string[] {
  return [
    ...new Set(
      [input.symbol, input.canonicalSymbol, input.name]
        .map((value) =>
          String(value ?? '')
            .replace(/[.,;:]+$/g, '')
            .trim(),
        )
        .filter((value) => value.length >= 2),
    ),
  ];
}

export const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export function gdeltDocUrl(query: string): string {
  const q = encodeURIComponent(`${query} sourcelang:eng`);
  return `${GDELT_DOC_URL}?query=${q}&mode=ArtList&maxrecords=20&format=json&timespan=7d`;
}

export function parseGdeltArticles(raw: unknown): GdeltHeadline[] {
  if (!raw || typeof raw !== 'object') return [];
  const articles = (
    raw as { articles?: Array<{ url?: string; title?: string; seendate?: string }> }
  ).articles;
  if (!Array.isArray(articles)) return [];
  const out: GdeltHeadline[] = [];
  for (const article of articles) {
    const title = String(article.title ?? '').trim();
    if (!title) continue;
    const rawDate = String(article.seendate ?? '');
    const publishedAt = rawDate
      ? Date.parse(
          `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}T${rawDate.slice(9, 11) || '00'}:${rawDate.slice(11, 13) || '00'}:00Z`,
        )
      : undefined;
    out.push({
      source: 'gdelt',
      url: article.url,
      title,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
    });
  }
  return out;
}
