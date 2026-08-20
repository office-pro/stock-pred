import { getPrismaClient } from '@stockpred/database';
import { EARNINGS_EVENTS, scoreHeadline } from './news-nlp';
import {
  dedupeHeadlines,
  fetchGdelt,
  fetchGoogleNews,
  fetchYahooNews,
  filterGdeltByAliases,
  type Headline,
} from './news-fetch';
import { fetchReddit, type SocialPost } from './social-fetch';
import { parseUniverse, resolveUniverseSymbols, type AltUniverseId } from './universe';
import { fetchFredSeries, fetchYahooMacroSeries, type MacroPoint } from './yahoo-macro';
import { isIstSessionAsOf, istSessionUtcDay } from './ingest-freshness';

const DAY_MS = 86_400_000;

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, item) => sum + (item - avg) ** 2, 0) / values.length);
}

function clip(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function lookup(
  series: MacroPoint[],
  id: string,
): Map<number, { value: number; availableAt: Date }> {
  const map = new Map<number, { value: number; availableAt: Date }>();
  for (const point of series.filter((row) => row.seriesId === id)) {
    map.set(point.asOfDate.getTime(), { value: point.value, availableAt: point.availableAt });
  }
  return map;
}

let aliasWarm: Promise<number> | null = null;

export async function ensureAliases(): Promise<number> {
  if (!aliasWarm) {
    aliasWarm = (async () => {
      const prisma = getPrismaClient();
      const stocks = await prisma.stock.findMany({ select: { symbol: true, name: true } });
      let written = 0;
      for (const stock of stocks) {
        const aliases = [stock.symbol, stock.name, stock.symbol.replace(/&/g, 'AND')];
        for (const alias of aliases) {
          const cleaned = alias.trim().toUpperCase();
          if (cleaned.length < 2) continue;
          await prisma.symbolAlias.upsert({
            where: { alias_symbol: { alias: cleaned, symbol: stock.symbol } },
            create: { alias: cleaned, symbol: stock.symbol },
            update: {},
          });
          written += 1;
        }
      }
      console.log(`[news] warmed ${written} symbol aliases`);
      return written;
    })();
  }
  return aliasWarm;
}

async function aliasesFor(symbol: string): Promise<string[]> {
  const prisma = getPrismaClient();
  const aliases = new Set<string>([symbol.toUpperCase()]);
  const rows = await prisma.symbolAlias.findMany({ where: { symbol } });
  for (const row of rows) aliases.add(row.alias.toUpperCase());
  const stock = await prisma.stock.findUnique({ where: { symbol }, select: { name: true } });
  if (stock?.name) aliases.add(stock.name.trim().toUpperCase());
  return [...aliases];
}

function headlineScore(item: Headline) {
  if (item.score) return item.score;
  return scoreHeadline(item.title);
}

export async function upsertNews(
  symbol: string,
  headlines: Headline[],
): Promise<{ articles: number; mentions: number; daily: number }> {
  const prisma = getPrismaClient();
  const aliases = await aliasesFor(symbol);
  const unique = filterGdeltByAliases(dedupeHeadlines(headlines), aliases);
  let articles = 0;
  let mentions = 0;
  for (const item of unique) {
    const score = headlineScore(item);
    const article = await prisma.newsArticle.upsert({
      where: { url: item.url },
      create: {
        source: item.source,
        url: item.url,
        title: item.title.slice(0, 500),
        publishedAt: item.publishedAt,
        availableAt: item.publishedAt,
      },
      update: {
        title: item.title.slice(0, 500),
        publishedAt: item.publishedAt,
        availableAt: item.publishedAt,
      },
    });
    articles += 1;
    await prisma.newsMention.upsert({
      where: { articleId_symbol: { articleId: article.id, symbol } },
      create: {
        articleId: article.id,
        symbol,
        sentiment: score.sentiment,
        pos: score.pos,
        neg: score.neg,
        neu: score.neu,
        eventType: score.eventType,
        eventStrength: score.eventStrength,
        confidence: score.confidence,
      },
      update: {
        sentiment: score.sentiment,
        pos: score.pos,
        neg: score.neg,
        neu: score.neu,
        eventType: score.eventType,
        eventStrength: score.eventStrength,
        confidence: score.confidence,
      },
    });
    mentions += 1;
  }
  const stored = await prisma.newsMention.findMany({
    where: { symbol },
    include: { article: true },
  });
  const daily = await rollNewsDaily(
    symbol,
    stored.map((row) => ({
      availableAt: row.article.availableAt,
      sentiment: row.sentiment,
      eventType: row.eventType,
      eventStrength: row.eventStrength,
    })),
  );
  return { articles, mentions, daily };
}

async function rollNewsDaily(
  symbol: string,
  rows: Array<{ availableAt: Date; sentiment: number; eventType: string; eventStrength: number }>,
): Promise<number> {
  const prisma = getPrismaClient();
  const days = [...new Set(rows.map((row) => utcDay(row.availableAt).getTime()))].sort(
    (a, b) => a - b,
  );
  let written = 0;
  for (const dayMs of days) {
    const day = new Date(dayMs);
    const inWindow = (back: number) =>
      rows.filter((row) => {
        const t = utcDay(row.availableAt).getTime();
        return t >= dayMs - (back - 1) * DAY_MS && t <= dayMs;
      });
    const d1 = inWindow(1);
    const d7 = inWindow(7);
    const d30 = inWindow(30);
    const sent1 = d1.map((row) => row.sentiment);
    const sent7 = d7.map((row) => row.sentiment);
    const sent30 = d30.map((row) => row.sentiment);
    const earn = d7.filter((row) => EARNINGS_EVENTS.has(row.eventType)).map((row) => row.sentiment);
    await prisma.newsDailyFeature.upsert({
      where: { symbol_asOfDate: { symbol, asOfDate: day } },
      create: {
        symbol,
        asOfDate: day,
        availableAt: day,
        newsCount1d: d1.length,
        newsCount7d: d7.length,
        newsCount30d: d30.length,
        newsSent1d: mean(sent1),
        newsSent7d: mean(sent7),
        newsSent30d: mean(sent30),
        newsSentStd7d: stdev(sent7),
        newsSentChange7d: mean(sent1) - mean(sent7),
        newsSentTrend30d: mean(sent7) - mean(sent30),
        newsPos7d: d7.filter((row) => row.sentiment > 0.15).length,
        newsNeg7d: d7.filter((row) => row.sentiment < -0.15).length,
        newsHighImpact7d: d7.filter((row) => row.eventStrength >= 0.7).length,
        newsEventMomentum7d: clip(
          d7.reduce((sum, row) => sum + row.eventStrength * (row.sentiment >= 0 ? 1 : -1), 0),
          -50,
          50,
        ),
        earningsSentiment: mean(earn),
      },
      update: {
        availableAt: day,
        newsCount1d: d1.length,
        newsCount7d: d7.length,
        newsCount30d: d30.length,
        newsSent1d: mean(sent1),
        newsSent7d: mean(sent7),
        newsSent30d: mean(sent30),
        newsSentStd7d: stdev(sent7),
        newsSentChange7d: mean(sent1) - mean(sent7),
        newsSentTrend30d: mean(sent7) - mean(sent30),
        newsPos7d: d7.filter((row) => row.sentiment > 0.15).length,
        newsNeg7d: d7.filter((row) => row.sentiment < -0.15).length,
        newsHighImpact7d: d7.filter((row) => row.eventStrength >= 0.7).length,
        newsEventMomentum7d: clip(
          d7.reduce((sum, row) => sum + row.eventStrength * (row.sentiment >= 0 ? 1 : -1), 0),
          -50,
          50,
        ),
        earningsSentiment: mean(earn),
      },
    });
    written += 1;
  }
  return written;
}

export async function ingestNewsSymbol(
  symbol: string,
  options?: { full?: boolean },
): Promise<{
  symbol: string;
  snapshots: number;
  skipped?: boolean;
  reason?: string;
  cached?: boolean;
}> {
  const prisma = getPrismaClient();
  try {
    if (!options?.full) {
      const today = istSessionUtcDay();
      const existing = await prisma.newsDailyFeature.findUnique({
        where: { symbol_asOfDate: { symbol, asOfDate: today } },
      });
      if (existing && isIstSessionAsOf(existing.asOfDate)) {
        console.log(`[news] ${symbol}: cached`);
        return { symbol, snapshots: 0, cached: true };
      }
    }
    const stock = await prisma.stock.findUnique({ where: { symbol } });
    const aliases = await aliasesFor(symbol);
    const [google, yahoo, gdelt] = await Promise.all([
      fetchGoogleNews(symbol, stock?.name),
      stock?.yahooSymbol ? fetchYahooNews(stock.yahooSymbol) : fetchYahooNews(`${symbol}.NS`),
      fetchGdelt(stock?.name || symbol).then((rows) => filterGdeltByAliases(rows, aliases)),
    ]);
    const headlines = [...google, ...yahoo, ...gdelt];
    const result = await upsertNews(symbol, headlines);
    return { symbol, snapshots: result.daily };
  } catch (error) {
    return {
      symbol,
      snapshots: 0,
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ingestNewsUniverse(
  universe: string,
  options?: { full?: boolean },
): Promise<{ universe: AltUniverseId; symbols: number; daily: number; cached?: number }> {
  const requested = parseUniverse(universe);
  const basket = requested === 'all' ? 'nifty500' : requested;
  if (requested === 'all') {
    console.log('[news] universe all: using nifty500 (RSS timeouts on full listed book)');
  }
  if (options?.full) await ensureAliases();
  const symbols = await resolveUniverseSymbols(basket);
  let daily = 0;
  let cached = 0;
  for (const symbol of symbols) {
    const result = await ingestNewsSymbol(symbol, options);
    daily += result.snapshots;
    if (result.cached) cached += 1;
  }
  return { universe: basket, symbols: symbols.length, daily, cached };
}

export async function ingestSocialSymbol(
  symbol: string,
  options?: { full?: boolean },
): Promise<{
  symbol: string;
  snapshots: number;
  skipped?: boolean;
  reason?: string;
  cached?: boolean;
}> {
  try {
    if (!options?.full) {
      const prisma = getPrismaClient();
      const today = istSessionUtcDay();
      const existing = await prisma.socialDailyFeature.findUnique({
        where: { symbol_asOfDate: { symbol, asOfDate: today } },
      });
      if (existing && isIstSessionAsOf(existing.asOfDate)) {
        console.log(`[social] ${symbol}: cached`);
        return { symbol, snapshots: 0, cached: true };
      }
    }
    const posts = await fetchReddit(symbol);
    const daily = await rollSocialDaily(symbol, posts);
    return { symbol, snapshots: daily };
  } catch (error) {
    return {
      symbol,
      snapshots: 0,
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ingestSocialUniverse(
  universe: string,
  options?: { full?: boolean },
): Promise<{ universe: AltUniverseId; symbols: number; daily: number; cached?: number }> {
  const requested = parseUniverse(universe);
  const basket = requested === 'all' ? 'nifty500' : requested;
  if (requested === 'all') {
    console.log('[social] universe all: using nifty500 (Reddit timeouts on full listed book)');
  }
  const symbols = await resolveUniverseSymbols(basket);
  let daily = 0;
  let cached = 0;
  for (const symbol of symbols) {
    const result = await ingestSocialSymbol(symbol, options);
    daily += result.snapshots;
    if (result.cached) cached += 1;
  }
  return { universe: basket, symbols: symbols.length, daily, cached };
}

export async function upsertSocialDaily(
  symbol: string,
  rows: Array<{
    asOfDate: string | Date;
    availableAt: string | Date;
    mentions1d: number;
    mentions7d: number;
    mentionGrowth: number;
    attentionSpike: number;
    uniqueAuthors1d: number;
    sentiment1d: number;
    sentimentChange: number;
    bullRatio7d: number;
    bearRatio7d: number;
    coordination: number;
    trendsScore7d: number;
    trendsChange7d: number;
  }>,
): Promise<number> {
  const prisma = getPrismaClient();
  let written = 0;
  for (const row of rows) {
    const asOfDate = utcDay(new Date(row.asOfDate));
    const availableAt = new Date(row.availableAt);
    await prisma.socialDailyFeature.upsert({
      where: { symbol_asOfDate: { symbol, asOfDate } },
      create: {
        symbol,
        asOfDate,
        availableAt,
        mentions1d: row.mentions1d,
        mentions7d: row.mentions7d,
        mentionGrowth: row.mentionGrowth,
        attentionSpike: row.attentionSpike,
        uniqueAuthors1d: row.uniqueAuthors1d,
        sentiment1d: row.sentiment1d,
        sentimentChange: row.sentimentChange,
        bullRatio7d: row.bullRatio7d,
        bearRatio7d: row.bearRatio7d,
        coordination: row.coordination,
        trendsScore7d: row.trendsScore7d,
        trendsChange7d: row.trendsChange7d,
      },
      update: {
        availableAt,
        mentions1d: row.mentions1d,
        mentions7d: row.mentions7d,
        mentionGrowth: row.mentionGrowth,
        attentionSpike: row.attentionSpike,
        uniqueAuthors1d: row.uniqueAuthors1d,
        sentiment1d: row.sentiment1d,
        sentimentChange: row.sentimentChange,
        bullRatio7d: row.bullRatio7d,
        bearRatio7d: row.bearRatio7d,
        coordination: row.coordination,
        trendsScore7d: row.trendsScore7d,
        trendsChange7d: row.trendsChange7d,
      },
    });
    written += 1;
  }
  return written;
}

async function rollSocialDaily(symbol: string, posts: SocialPost[]): Promise<number> {
  const days = [...new Set(posts.map((post) => utcDay(post.createdAt).getTime()))].sort(
    (a, b) => a - b,
  );
  const packed = days.map((dayMs) => {
    const day = new Date(dayMs);
    const inWindow = (back: number) =>
      posts.filter((post) => {
        const t = utcDay(post.createdAt).getTime();
        return t >= dayMs - (back - 1) * DAY_MS && t <= dayMs;
      });
    const d1 = inWindow(1);
    const d7 = inWindow(7);
    const d20 = inWindow(20);
    const baseline = Math.max(d20.length / 20, 0.05);
    const texts = d1.map((post) => post.text.slice(0, 80).toLowerCase());
    const unique = new Set(texts.filter(Boolean)).size;
    return {
      asOfDate: day,
      availableAt: day,
      mentions1d: d1.length,
      mentions7d: d7.length,
      mentionGrowth: clip((d1.length - baseline) / baseline, -50, 50),
      attentionSpike: clip(d1.length / baseline, 0, 50),
      uniqueAuthors1d: new Set(d1.map((post) => post.author)).size,
      sentiment1d: mean(d1.map((post) => post.sentiment)),
      sentimentChange:
        mean(d1.map((post) => post.sentiment)) - mean(d7.map((post) => post.sentiment)),
      bullRatio7d: d7.filter((post) => post.sentiment > 0.15).length / Math.max(d7.length, 1),
      bearRatio7d: d7.filter((post) => post.sentiment < -0.15).length / Math.max(d7.length, 1),
      coordination: d1.length >= 4 ? clip(1 - unique / Math.max(d1.length, 1), 0, 1) : 0,
      trendsScore7d: 0,
      trendsChange7d: 0,
    };
  });
  return upsertSocialDaily(symbol, packed);
}

export async function ingestMacro(options?: {
  full?: boolean;
}): Promise<{ observations: number; daily: number; cached?: boolean }> {
  const prisma = getPrismaClient();
  try {
    if (!options?.full) {
      const today = istSessionUtcDay();
      const existing = await prisma.macroDailyFeature.findUnique({
        where: { asOfDate: today },
      });
      if (existing && isIstSessionAsOf(existing.asOfDate)) {
        console.log(`[macro] cached asOf=${today.toISOString().slice(0, 10)}`);
        return { observations: 0, daily: 0, cached: true };
      }
    }
    const points = [...(await fetchYahooMacroSeries()), ...(await fetchFredSeries())];
    for (const point of points) {
      await prisma.macroObservation.upsert({
        where: { seriesId_asOfDate: { seriesId: point.seriesId, asOfDate: point.asOfDate } },
        create: point,
        update: { value: point.value, availableAt: point.availableAt, source: point.source },
      });
    }
    const daily = await rollMacroDaily(points);
    return { observations: points.length, daily };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('does not exist')) {
      throw new Error(
        'Alt-data tables are missing. Stop the stack, run `npm run prisma:migrate`, then retry ingest macro.',
      );
    }
    throw error;
  }
}

function lastAvailable(
  series: Map<number, { value: number; availableAt: Date }>,
  when: number,
): { time: number; value: number } | null {
  let found: { time: number; value: number } | null = null;
  for (const [time, row] of [...series.entries()].sort((a, b) => a[0] - b[0])) {
    if (row.availableAt.getTime() <= when) found = { time, value: row.value };
  }
  return found;
}

function changeFrom(
  series: Map<number, { value: number; availableAt: Date }>,
  when: number,
  days: number,
): number | null {
  const current = lastAvailable(series, when);
  if (!current) return null;
  const prior = lastAvailable(series, when - days * DAY_MS);
  if (!prior || prior.value === 0 || prior.time === current.time) return null;
  return current.value / prior.value - 1;
}

async function rollMacroDaily(points: MacroPoint[]): Promise<number> {
  const prisma = getPrismaClient();
  const usdinr = lookup(points, 'usdinr');
  const brent = lookup(points, 'brent');
  const gold = lookup(points, 'gold');
  const us10y = lookup(points, 'us10y');
  const spx = lookup(points, 'spx');
  const nasdaq = lookup(points, 'nasdaq');
  const dxy = lookup(points, 'dxy');
  const cpi = lookup(points, 'india_cpi');
  const repo = lookup(points, 'repo_rate');
  const backbone = usdinr.size ? [...usdinr.keys()] : [...spx.keys()];
  const days = [...new Set(backbone)].sort((a, b) => a - b);
  let written = 0;
  for (const time of days) {
    const asOfDate = new Date(time);
    const availableAt = usdinr.get(time)?.availableAt ?? asOfDate;
    const row = {
      asOfDate,
      availableAt,
      usdinr: lastAvailable(usdinr, time)?.value ?? null,
      usdinrChg20d: changeFrom(usdinr, time, 20),
      usdinrChg60d: changeFrom(usdinr, time, 60),
      brent: lastAvailable(brent, time)?.value ?? null,
      brentChg20d: changeFrom(brent, time, 20),
      goldChg20d: changeFrom(gold, time, 20),
      us10y: lastAvailable(us10y, time)?.value ?? null,
      us10yChg20d: changeFrom(us10y, time, 20),
      spxChg20d: changeFrom(spx, time, 20),
      nasdaqChg20d: changeFrom(nasdaq, time, 20),
      dxyChg20d: changeFrom(dxy, time, 20),
      indiaCpi: lastAvailable(cpi, time)?.value ?? null,
      indiaCpiChg: changeFrom(cpi, time, 365),
      repoRate: lastAvailable(repo, time)?.value ?? null,
      repoChg90d: changeFrom(repo, time, 90),
      fiiFlow20d: null as number | null,
      diiFlow20d: null as number | null,
    };
    await prisma.macroDailyFeature.upsert({
      where: { asOfDate },
      create: row,
      update: row,
    });
    written += 1;
  }
  return written;
}

export async function upsertNewsFromPayload(
  symbol: string,
  headlines: Array<{
    source: string;
    url: string;
    title: string;
    publishedAt: string;
    sentiment?: number;
    pos?: number;
    neg?: number;
    neu?: number;
    eventType?: string;
    eventStrength?: number;
    confidence?: number;
  }>,
): Promise<{ articles: number; daily: number }> {
  const mapped: Headline[] = headlines.map((row) => ({
    source: row.source,
    url: row.url,
    title: row.title,
    publishedAt: new Date(row.publishedAt),
    score:
      row.sentiment == null
        ? undefined
        : {
            sentiment: row.sentiment,
            pos: row.pos ?? 0,
            neg: row.neg ?? 0,
            neu: row.neu ?? 1,
            eventType: row.eventType ?? 'OTHER',
            eventStrength: row.eventStrength ?? 0.2,
            confidence: row.confidence ?? 0.4,
          },
  }));
  const result = await upsertNews(symbol, mapped);
  return { articles: result.articles, daily: result.daily };
}
