/**
 * Phase C evidence attach — SEC / press_releases / GDELT / FinBERT / batch macro.
 * Must run before TwelveDataClient.freeze() and snapshot.frozen.
 */

import type {
  BatchInstrumentData,
  BatchMacroSnapshot,
  BatchSentiment,
  FundamentalPayload,
  InstrumentRef,
  IntelligenceNewsBlock,
} from '@stockpred/shared-types';
import { sanitizeFundamentalPayload } from '@stockpred/shared-types';
import {
  filterGdeltByAliases,
  frozenAliasesForRef,
  gdeltDocUrl,
  parseGdeltArticles,
  type GdeltHeadline,
} from './gdelt-match';
import { fetchBatchMacroSnapshot, type MacroFetch } from './batch-macro-client';
import {
  isUsListedEquity,
  SEC_EDGAR_USER_AGENT,
  SecEdgarClient,
  unavailableEquityFacts,
  type SecFetchJson,
} from './sec-edgar-client';
import {
  mapToTwelveDataSymbol,
  parseTwelveDataPressReleases,
  TD_CREDIT_EXHAUSTED,
  type TwelveDataClient,
} from './twelve-data-client';
import { missingNewsSentiment } from './sector-fundamentals-news';
import { mapPool } from './throughput-scale';

export async function defaultEvidenceFetchJson(url: string): Promise<unknown> {
  const csv = url.includes('fredgraph.csv');
  const res = await fetch(url, {
    headers: {
      Accept: csv ? 'text/csv' : 'application/json',
      'User-Agent': SEC_EDGAR_USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (csv) return res.text();
  return res.json();
}

export type EvidenceFetchJson = (url: string) => Promise<unknown>;

export type HeadlineScorer = (text: string) => Promise<number | null> | number | null;

export interface BatchEvidenceDeps {
  twelveDataClient?: TwelveDataClient | null;
  evidenceFetchJson?: EvidenceFetchJson;
  scoreHeadline?: HeadlineScorer;
  macroSnapshot?: BatchMacroSnapshot;
  concurrency?: number;
  now?: number;
}

export function shouldAttachPhaseCEvidence(deps: {
  fetchJson?: unknown;
  twelveDataClient?: unknown;
  evidenceFetchJson?: unknown;
  scoreHeadline?: unknown;
  macroSnapshot?: unknown;
  skipEvidence?: boolean;
}): boolean {
  if (deps.skipEvidence) return false;
  if (deps.evidenceFetchJson || deps.scoreHeadline || deps.macroSnapshot) return true;
  return !deps.fetchJson && !deps.twelveDataClient;
}

function listingSymbol(ref: InstrumentRef): string {
  return String(ref.symbol ?? '')
    .trim()
    .toUpperCase();
}

async function scoreMatchedHeadlines(
  titles: string[],
  scoreHeadline: HeadlineScorer | undefined,
): Promise<BatchSentiment> {
  if (!scoreHeadline || titles.length === 0) {
    return missingNewsSentiment().sentiment;
  }
  const scores: number[] = [];
  for (const title of titles) {
    const raw = await scoreHeadline(title);
    if (typeof raw === 'number' && Number.isFinite(raw)) scores.push(raw);
  }
  if (!scores.length) return null;
  const score = scores.reduce((sum, n) => sum + n, 0) / scores.length;
  return { source: 'MODEL_DERIVED', score };
}

function newsBlock(
  headlines: Array<{ title: string }>,
  now: number,
  reasonCode?: string,
): IntelligenceNewsBlock {
  return {
    source: 'SOURCE_REPORTED',
    headlineCount: headlines.length,
    asOf: now,
    ...(reasonCode ? { reasonCode } : {}),
  };
}

async function fetchGdeltMatched(
  fetchJson: EvidenceFetchJson,
  aliases: string[],
  query: string,
): Promise<GdeltHeadline[]> {
  if (!aliases.length) return [];
  try {
    const raw = await fetchJson(gdeltDocUrl(query));
    const articles = parseGdeltArticles(raw);
    return filterGdeltByAliases(articles, aliases);
  } catch {
    return [];
  }
}

export async function attachBatchEvidence(
  rows: BatchInstrumentData[],
  deps: BatchEvidenceDeps,
): Promise<{ rows: BatchInstrumentData[]; macro: BatchMacroSnapshot | undefined }> {
  const now = deps.now ?? Date.now();
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const fetchJson = deps.evidenceFetchJson;
  const sec = fetchJson ? new SecEdgarClient({ fetchJson: fetchJson as SecFetchJson }) : null;
  const entityNames = new Map<string, string>();

  let withSec = rows;
  if (sec) {
    withSec = await mapPool(rows, concurrency, async (row) => {
      const ref = row.instrumentRef;
      if (!isUsListedEquity(ref)) return row;
      try {
        const result = await sec.companyFactsForTicker(listingSymbol(ref));
        if (result.entityName) entityNames.set(listingSymbol(ref), result.entityName);
        let fundamentals: FundamentalPayload;
        if (!result.match) {
          fundamentals = unavailableEquityFacts(
            'MISSING_CIK',
            'Ticker not in SEC company_tickers.json',
          );
        } else if (!result.payload) {
          fundamentals = unavailableEquityFacts(
            'SEC_FACTS_UNAVAILABLE',
            'SEC companyfacts returned no usable tags',
          );
        } else {
          fundamentals = result.payload;
        }
        return {
          ...row,
          fundamentals: sanitizeFundamentalPayload(ref.assetClass, fundamentals),
        };
      } catch {
        return {
          ...row,
          fundamentals: sanitizeFundamentalPayload(
            ref.assetClass,
            unavailableEquityFacts('SEC_FACTS_UNAVAILABLE', 'SEC companyfacts fetch failed'),
          ),
        };
      }
    });
  }

  const withNews = await mapPool(withSec, concurrency, async (row) => {
    const ref = row.instrumentRef;
    const aliases = frozenAliasesForRef({
      symbol: ref.symbol,
      canonicalSymbol: ref.canonicalSymbol,
      name: entityNames.get(listingSymbol(ref)),
    });
    const headlines: Array<{ title: string }> = [];
    let newsReason: string | undefined;

    if (deps.twelveDataClient) {
      try {
        const tdSymbol = mapToTwelveDataSymbol(ref);
        const raw = await deps.twelveDataClient.pressReleases(tdSymbol);
        for (const item of parseTwelveDataPressReleases(raw)) {
          if (item.title) headlines.push({ title: item.title });
        }
      } catch (error) {
        const code = error instanceof Error ? error.name || error.message : String(error);
        if (
          code === TD_CREDIT_EXHAUSTED ||
          String((error as Error)?.message) === TD_CREDIT_EXHAUSTED
        ) {
          newsReason = TD_CREDIT_EXHAUSTED;
        }
      }
    }

    if (fetchJson) {
      const matched = await fetchGdeltMatched(fetchJson, aliases, listingSymbol(ref));
      for (const item of matched) headlines.push({ title: item.title });
      if (!headlines.length && !newsReason) {
        newsReason = matched.length === 0 ? 'GDELT_UNMATCHED' : 'NO_NEWS';
      }
    } else if (!headlines.length && !newsReason) {
      newsReason = 'NO_NEWS';
    }

    const unique = [...new Map(headlines.map((h) => [h.title, h])).values()];
    if (!unique.length && !newsReason) newsReason = 'NO_NEWS';
    const sentiment = await scoreMatchedHeadlines(
      unique.map((h) => h.title),
      deps.scoreHeadline,
    );
    return {
      ...row,
      news: newsBlock(unique, now, unique.length ? undefined : newsReason),
      sentiment,
    };
  });

  let macro: BatchMacroSnapshot | undefined = deps.macroSnapshot;
  if (!macro && fetchJson) {
    try {
      macro = await fetchBatchMacroSnapshot(fetchJson as MacroFetch);
    } catch {
      macro = undefined;
    }
  }

  return { rows: withNews, macro };
}
