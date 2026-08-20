import axios from 'axios';
import { scoreHeadline, USER_AGENT } from './news-nlp';

export interface SocialPost {
  symbol: string;
  author: string;
  text: string;
  createdAt: Date;
  sentiment: number;
}

const SUBS = ['IndiaInvestments', 'IndianStreetBets', 'stocks'];

interface RedditChild {
  data?: {
    author?: string;
    title?: string;
    selftext?: string;
    created_utc?: number;
  };
}

export async function fetchReddit(symbol: string): Promise<SocialPost[]> {
  const searches = SUBS.map(async (sub) => {
    try {
      const response = await axios.get(`https://www.reddit.com/r/${sub}/search.json`, {
        params: { q: symbol, restrict_sr: 1, sort: 'new', limit: 25, t: 'month' },
        timeout: 5_000,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        validateStatus: () => true,
      });
      if (response.status >= 400) return [] as SocialPost[];
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
        });
      }
      return out;
    } catch {
      return [] as SocialPost[];
    }
  });
  return (await Promise.all(searches)).flat();
}
