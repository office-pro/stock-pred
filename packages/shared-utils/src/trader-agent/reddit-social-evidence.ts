/**
 * F6 — Reddit social evidence, not truth.
 * Ingest JSON → frozen-alias entity resolution → spam/dedupe → timestamps →
 * MODEL_DERIVED sentiment (injected scorer only) → IntelligenceSnapshot.
 * Unmatched posts are dropped. Missing → UNAVAILABLE, never numeric 0.
 * Volume is not a BUY/SELL. Never Risk / Gate / execution.
 */
import type { InstrumentRef, IntelligenceSocialBlock } from '@stockpred/shared-types';
import { looksLikeHtml } from './approved-futures-feed';
import { frozenAliasesForRef, titleMatchesAliases } from './gdelt-match';

export const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';
export const SOCIAL_UNAVAILABLE = 'SOCIAL_UNAVAILABLE';
export const SOCIAL_SCRAPE_FORBIDDEN = 'SOCIAL_SCRAPE_FORBIDDEN';
export const SOCIAL_NO_ALIAS = 'SOCIAL_NO_ALIAS';

export type SocialHeadlineScorer = (text: string) => Promise<number | null> | number | null;

export interface RedditSocialPost {
  id: string;
  title: string;
  selftext?: string;
  author?: string;
  createdUtc: number;
  subreddit?: string;
}

const SPAM_AUTHORS = new Set(['[deleted]', '[removed]', 'automoderator']);

export function frozenAliasesForInstrument(ref: InstrumentRef): string[] {
  return frozenAliasesForRef({
    symbol: ref.symbol,
    canonicalSymbol: ref.canonicalSymbol ?? ref.underlying,
  });
}

export function parseRedditListing(raw: unknown): RedditSocialPost[] | { scrapeForbidden: true } {
  if (typeof raw === 'string') {
    if (looksLikeHtml(raw)) return { scrapeForbidden: true };
    try {
      return parseRedditListing(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (raw && typeof raw === 'object' && 'scrapeForbidden' in (raw as object)) {
    return { scrapeForbidden: true };
  }
  const rows = listingChildren(raw);
  const out: RedditSocialPost[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const data =
      rec.data && typeof rec.data === 'object' ? (rec.data as Record<string, unknown>) : rec;
    const title = String(data.title ?? data.text ?? '').trim();
    const id = String(data.id ?? data.name ?? title).trim();
    const createdUtc = createdUtcOf(data.created_utc ?? data.createdUtc ?? data.createdAt);
    if (!id || !title || createdUtc == null) continue;
    out.push({
      id,
      title,
      selftext: String(data.selftext ?? data.body ?? '').trim() || undefined,
      author: String(data.author ?? '').trim() || undefined,
      createdUtc,
      subreddit:
        String(data.subreddit ?? data.subreddit_name_prefixed ?? '')
          .replace(/^r\//, '')
          .trim() || undefined,
    });
  }
  return out;
}

function listingChildren(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const rec = raw as Record<string, unknown>;
  if (Array.isArray(rec.posts)) return rec.posts;
  const data = rec.data as Record<string, unknown> | undefined;
  if (Array.isArray(data?.children)) return data.children;
  if (Array.isArray(rec.children)) return rec.children;
  return [];
}

function createdUtcOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n > 10_000_000_000 ? Math.floor(n / 1000) : n;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
  }
  return null;
}

export function isSocialSpam(post: RedditSocialPost): boolean {
  const title = post.title.trim();
  if (title.length < 4) return true;
  const lowered = title.toLowerCase();
  if (lowered === '[removed]' || lowered === '[deleted]') return true;
  const author = String(post.author ?? '')
    .trim()
    .toLowerCase();
  if (author && SPAM_AUTHORS.has(author)) return true;
  if (!(post.createdUtc > 0) || !Number.isFinite(post.createdUtc)) return true;
  return false;
}

export function dedupeSocialPosts(posts: RedditSocialPost[]): RedditSocialPost[] {
  const byId = new Set<string>();
  const byTitle = new Set<string>();
  const out: RedditSocialPost[] = [];
  for (const post of posts) {
    const idKey = post.id.trim().toLowerCase();
    const titleKey = post.title.replace(/\s+/g, ' ').trim().toLowerCase();
    if (byId.has(idKey) || byTitle.has(titleKey)) continue;
    byId.add(idKey);
    byTitle.add(titleKey);
    out.push(post);
  }
  return out;
}

export function resolveSocialPostsForRef(
  posts: RedditSocialPost[],
  ref: InstrumentRef,
): RedditSocialPost[] {
  const aliases = frozenAliasesForInstrument(ref);
  if (aliases.length === 0) return [];
  return posts.filter((post) =>
    titleMatchesAliases(`${post.title} ${post.selftext ?? ''}`, aliases),
  );
}

export function unavailableSocial(reasonCode: string, now = Date.now()): IntelligenceSocialBlock {
  return {
    status: 'UNAVAILABLE',
    source: 'SOURCE_REPORTED',
    provider: 'reddit',
    asOf: now,
    reasonCode,
  };
}

export async function socialFromPosts(
  ref: InstrumentRef,
  posts: RedditSocialPost[],
  scoreHeadline?: SocialHeadlineScorer,
  now = Date.now(),
): Promise<IntelligenceSocialBlock> {
  if (frozenAliasesForInstrument(ref).length === 0) {
    return unavailableSocial(SOCIAL_NO_ALIAS, now);
  }
  const matched = dedupeSocialPosts(
    resolveSocialPostsForRef(posts, ref).filter((p) => !isSocialSpam(p)),
  );
  if (matched.length === 0) return unavailableSocial(SOCIAL_UNAVAILABLE, now);

  const scores: number[] = [];
  if (scoreHeadline) {
    for (const post of matched) {
      const raw = await scoreHeadline(post.title);
      if (typeof raw === 'number' && Number.isFinite(raw)) scores.push(raw);
    }
  }
  const asOf = Math.max(...matched.map((p) => p.createdUtc)) * 1000;
  const scored = scores.length > 0;
  return {
    status: scored ? 'AVAILABLE' : 'PARTIAL',
    source: scored ? 'MODEL_DERIVED' : 'SOURCE_REPORTED',
    provider: 'reddit',
    mentionCount: matched.length,
    ...(scored ? { score: scores.reduce((sum, n) => sum + n, 0) / scores.length } : {}),
    asOf: Number.isFinite(asOf) && asOf > 0 ? asOf : now,
  };
}

export async function loadRedditPosts(deps: {
  socialBody?: string;
  socialFetchJson?: (url: string) => Promise<unknown>;
  query?: string;
}): Promise<{ posts: RedditSocialPost[]; scrapeForbidden?: boolean }> {
  let raw: unknown;
  if (deps.socialBody != null) {
    if (looksLikeHtml(deps.socialBody)) return { posts: [], scrapeForbidden: true };
    raw = deps.socialBody;
  } else {
    const fetchJson =
      deps.socialFetchJson ??
      (async (url: string) => {
        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'stockpred-social/1.0' },
          signal: AbortSignal.timeout(8_000),
        });
        const text = await res.text();
        if (looksLikeHtml(text)) throw new Error(SOCIAL_SCRAPE_FORBIDDEN);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return JSON.parse(text);
      });
    const q = encodeURIComponent(String(deps.query ?? '').trim());
    const url = q
      ? `${REDDIT_SEARCH_URL}?q=${q}&sort=new&limit=25&t=week`
      : `${REDDIT_SEARCH_URL}?sort=new&limit=25&t=week`;
    try {
      raw = await fetchJson(url);
    } catch (err) {
      if (String((err as Error)?.message ?? '').includes(SOCIAL_SCRAPE_FORBIDDEN)) {
        return { posts: [], scrapeForbidden: true };
      }
      return { posts: [] };
    }
  }
  const parsed = parseRedditListing(raw);
  if ('scrapeForbidden' in parsed) return { posts: [], scrapeForbidden: true };
  return { posts: parsed };
}

export function shouldAttachSocial(deps: {
  skipSocial?: boolean;
  socialBody?: string;
  socialFetchJson?: unknown;
  fetchJson?: unknown;
  twelveDataClient?: unknown;
}): boolean {
  if (deps.skipSocial) return false;
  if (deps.socialBody != null || deps.socialFetchJson) return true;
  return !deps.fetchJson && !deps.twelveDataClient;
}
