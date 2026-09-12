import axios from 'axios';
import { scoreHeadline, USER_AGENT } from './news-nlp';

export interface SocialPost {
  symbol: string;
  author: string;
  text: string;
  createdAt: Date;
  sentiment: number;
  source: string;
}

const SUBS = [
  'IndiaInvestments',
  'IndianStreetBets',
  'DalalStreetTalks',
  'IndianStockMarket',
  'stocks',
  'StockMarket',
];

interface RedditChild {
  data?: {
    author?: string;
    title?: string;
    selftext?: string;
    created_utc?: number;
  };
}

async function searchRedditSub(sub: string, query: string, symbol: string): Promise<SocialPost[]> {
  try {
    const response = await axios.get(`https://www.reddit.com/r/${sub}/search.json`, {
      params: { q: query, restrict_sr: 1, sort: 'new', limit: 25, t: 'month' },
      timeout: 5_000,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      validateStatus: () => true,
    });
    if (response.status >= 400) return [];
    const children = (response.data?.data?.children ?? []) as RedditChild[];
    const out: SocialPost[] = [];
    for (const child of children) {
      const data = child.data;
      if (!data?.title) continue;
      const text = `${data.title} ${data.selftext ?? ''}`.trim();
      const createdAt = new Date((data.created_utc ?? 0) * 1000);
      if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() <= 0) continue;
      const score = scoreHeadline(text);
      out.push({
        symbol,
        author: data.author ?? 'unknown',
        text,
        createdAt,
        sentiment: score.sentiment,
        source: `reddit:${sub}`,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchReddit(symbol: string, name?: string | null): Promise<SocialPost[]> {
  const queries = [...new Set([symbol, name?.trim()].filter(Boolean))] as string[];
  const searches = SUBS.flatMap((sub) =>
    queries.map((query) => searchRedditSub(sub, query, symbol)),
  );
  return (await Promise.all(searches)).flat();
}

interface StockTwitsMessage {
  body?: string;
  created_at?: string;
  user?: { username?: string };
}

/** Public StockTwits stream (best-effort; many NSE tickers are sparse). */
export async function fetchStockTwits(symbol: string): Promise<SocialPost[]> {
  const tickers = [`${symbol}.NS`, symbol];
  const batches = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const response = await axios.get(
          `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(ticker)}.json`,
          {
            timeout: 5_000,
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            validateStatus: () => true,
          },
        );
        if (response.status >= 400) return [] as SocialPost[];
        const messages = (response.data?.messages ?? []) as StockTwitsMessage[];
        return messages
          .map((msg) => {
            const text = (msg.body ?? '').trim();
            if (!text) return null;
            const createdAt = msg.created_at ? new Date(msg.created_at) : new Date();
            if (Number.isNaN(createdAt.getTime())) return null;
            const score = scoreHeadline(text);
            return {
              symbol,
              author: msg.user?.username ?? 'stocktwits',
              text,
              createdAt,
              sentiment: score.sentiment,
              source: 'stocktwits',
            } satisfies SocialPost;
          })
          .filter((row): row is SocialPost => row != null);
      } catch {
        return [] as SocialPost[];
      }
    }),
  );
  return batches.flat();
}

/**
 * Per-symbol social fan-out: multiple Reddit subs (symbol + company name) and StockTwits.
 */
export async function fetchMultiSourceSocial(
  symbol: string,
  name?: string | null,
): Promise<{ posts: SocialPost[]; sources: string[]; counts: Record<string, number> }> {
  const [reddit, stocktwits] = await Promise.all([
    fetchReddit(symbol, name),
    fetchStockTwits(symbol),
  ]);
  const posts = [...reddit, ...stocktwits];
  const counts: Record<string, number> = {};
  for (const post of posts) {
    counts[post.source] = (counts[post.source] ?? 0) + 1;
  }
  const sources = Object.keys(counts).sort();
  return { posts, sources, counts };
}
