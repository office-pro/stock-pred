import axios from 'axios';
import { USER_AGENT } from './news-nlp';

export interface HeadlineScorePayload {
  sentiment: number;
  pos: number;
  neg: number;
  neu: number;
  eventType: string;
  eventStrength: number;
  confidence: number;
}

export interface Headline {
  source: string;
  url: string;
  title: string;
  publishedAt: Date;
  /** When set (ml-engine FinBERT/lexicon), Nest stores these instead of re-scoring. */
  score?: HeadlineScorePayload;
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

export function filterGdeltByAliases(rows: Headline[], aliases: string[]): Headline[] {
  if (aliases.length === 0) return [];
  return rows.filter((row) => row.source !== 'gdelt' || titleMatchesAliases(row.title, aliases));
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseRss(xml: string, source: string): Headline[] {
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  const out: Headline[] = [];
  for (const chunk of chunks) {
    const title = decodeXml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '');
    const link = decodeXml((chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) ?? [])[1] ?? '');
    const guid = decodeXml((chunk.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) ?? [])[1] ?? '');
    const pub = decodeXml((chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ?? [])[1] ?? '');
    const url = link || guid;
    if (!title || !url) continue;
    const publishedAt = pub ? new Date(pub) : new Date();
    if (Number.isNaN(publishedAt.getTime())) continue;
    out.push({ source, url, title, publishedAt });
  }
  return out;
}

async function getText(url: string): Promise<string> {
  try {
    const response = await axios.get<string>(url, {
      timeout: 5_000,
      signal: AbortSignal.timeout(5_000),
      responseType: 'text',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      validateStatus: (status) => status < 500,
    });
    if (response.status >= 400) return '';
    return typeof response.data === 'string' ? response.data : '';
  } catch {
    return '';
  }
}

export async function fetchGoogleNews(symbol: string, name?: string | null): Promise<Headline[]> {
  const query = encodeURIComponent(`${symbol} ${name ?? ''} NSE stock`.trim());
  const xml = await getText(
    `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`,
  );
  return parseRss(xml, 'google-news');
}

async function fetchGoogleNewsTagged(query: string, source: string): Promise<Headline[]> {
  const xml = await getText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
  );
  return parseRss(xml, source);
}

/** Moneycontrol / ET / Business Standard / Reuters via Google News site filters. */
export async function fetchIndiaPressNews(
  symbol: string,
  name?: string | null,
): Promise<Headline[]> {
  const tip = `${symbol} ${name ?? ''}`.trim();
  const sites: Array<{ source: string; site: string }> = [
    { source: 'moneycontrol', site: 'moneycontrol.com' },
    { source: 'economic-times', site: 'economictimes.indiatimes.com' },
    { source: 'business-standard', site: 'business-standard.com' },
    { source: 'reuters-india', site: 'reuters.com' },
    { source: 'livemint', site: 'livemint.com' },
  ];
  const batches = await Promise.all(
    sites.map(({ source, site }) =>
      fetchGoogleNewsTagged(`"${symbol}" OR "${name ?? symbol}" stock site:${site}`, source).then(
        (rows) =>
          rows.filter((row) =>
            titleMatchesAliases(row.title, [symbol, name ?? '', tip].filter(Boolean)),
          ),
      ),
    ),
  );
  return batches.flat();
}

export async function fetchYahooNews(ticker: string): Promise<Headline[]> {
  const xml = await getText(
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`,
  );
  return parseRss(xml, 'yahoo-news');
}

/**
 * Per-symbol fan-out across Google News, India press sites, Yahoo, and GDELT.
 * Failures are empty arrays so one dead source does not block the rest.
 */
export async function fetchMultiSourceNews(input: {
  symbol: string;
  name?: string | null;
  yahooTicker?: string | null;
  aliases?: string[];
}): Promise<{ headlines: Headline[]; sources: string[]; counts: Record<string, number> }> {
  const { symbol, name, yahooTicker, aliases = [] } = input;
  const yahoo = yahooTicker || `${symbol}.NS`;
  const aliasList = [
    ...new Set([symbol, name ?? '', ...aliases].map((a) => a.trim()).filter(Boolean)),
  ];

  const [google, press, yahooRows, gdeltRaw] = await Promise.all([
    fetchGoogleNews(symbol, name),
    fetchIndiaPressNews(symbol, name),
    fetchYahooNews(yahoo),
    fetchGdelt(name || symbol).then((rows) => filterGdeltByAliases(rows, aliasList)),
  ]);

  const buckets: Record<string, Headline[]> = {
    'google-news': google,
    press,
    'yahoo-news': yahooRows,
    gdelt: gdeltRaw,
  };
  const counts: Record<string, number> = {};
  for (const [key, rows] of Object.entries(buckets)) {
    counts[key] = rows.length;
  }
  // Flatten press into individual outlet tags already set on each headline.
  const headlines = dedupeHeadlines([...google, ...press, ...yahooRows, ...gdeltRaw]);
  const sources = [...new Set(headlines.map((row) => row.source))].sort();
  return { headlines, sources, counts };
}

interface GdeltDoc {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
}

export async function fetchGdelt(query: string): Promise<Headline[]> {
  const q = encodeURIComponent(`${query} sourcelang:eng`);
  try {
    const response = await axios.get(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=40&format=json&timespan=3months`,
      {
        timeout: 6_000,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        validateStatus: () => true,
      },
    );
    if (response.status >= 400) return [];
    const payload = response.data as { articles?: GdeltDoc[] } | string;
    const articles = typeof payload === 'string' ? [] : (payload.articles ?? []);
    const out: Headline[] = [];
    for (const article of articles) {
      if (!article.url || !article.title) continue;
      const raw = article.seendate ?? '';
      const publishedAt = raw
        ? new Date(
            `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11) || '00'}:${raw.slice(11, 13) || '00'}:00Z`,
          )
        : new Date();
      if (Number.isNaN(publishedAt.getTime())) continue;
      out.push({ source: 'gdelt', url: article.url, title: article.title, publishedAt });
    }
    return out;
  } catch {
    return [];
  }
}

export function dedupeHeadlines(rows: Headline[]): Headline[] {
  const seen = new Set<string>();
  const out: Headline[] = [];
  for (const row of rows) {
    const key = row.url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
