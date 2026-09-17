/**
 * Startup universe ingest for `npm run start:all`.
 * Publishes NSE_ALL, US_ALL, CRYPTO_SPOT_ALL, CRYPTO_FUTURES_ALL.
 * MCX/CME stay NOT_READY unless MCX_APPROVED_FEED_URL / CME_APPROVED_FEED_URL is set.
 * Failures are recorded; the process exits 0 so platform start continues.
 */
import {
  deletePlaceholderStocks,
  downloadBseEquityList,
  downloadNseEquityList,
  mergeListings,
  saveEquityMaster,
  upsertListings,
} from './listings';
import { disconnectPrisma } from './index';
import {
  publishCanonicalUniverseSnapshot,
  publishNseAllFromEquityMaster,
} from './canonical-universe-registry';
import { fetchCryptoUniverse } from './universe-ingest/crypto-providers';
import { configuredCryptoUniverseProvider } from './universe-ingest/crypto-eligibility';
import { fetchCryptoFuturesUniverse } from './universe-ingest/crypto-futures';
import { probeAndPublishCommodityUniverse } from './universe-ingest/alpha-vantage-commodities';
import { fetchApprovedFuturesFeed } from './universe-ingest/mcx-approved-feed';
import { ingestUsAllUniverse } from './ingest-us-universe';
import { ingestForexAllUniverse } from './ingest-forex-universe';

export interface UniverseIngestStep {
  id: string;
  ok: boolean;
  detail: string;
}

async function step(id: string, fn: () => Promise<string>): Promise<UniverseIngestStep> {
  try {
    const detail = await fn();
    console.log(`[universe-ingest] ${id}: ${detail}`);
    return { id, ok: true, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[universe-ingest] ${id}: FAILED ${detail}`);
    return { id, ok: false, detail };
  }
}

async function ingestNseAll(): Promise<string> {
  console.log('[universe-ingest] downloading NSE EQUITY_L.csv...');
  const nse = await downloadNseEquityList();
  let bse: Awaited<ReturnType<typeof downloadBseEquityList>> = [];
  try {
    bse = await downloadBseEquityList();
  } catch (error) {
    console.warn(`[universe-ingest] BSE list skipped: ${(error as Error).message}`);
  }
  const merged = mergeListings(nse, bse);
  saveEquityMaster(merged, 'NSE EQUITY_L.csv + BSE ListofScripData (ISIN-deduped)');
  try {
    const upserted = await upsertListings(merged);
    const removed = await deletePlaceholderStocks();
    console.log(`[universe-ingest] stocks upserted=${upserted} placeholders_removed=${removed}`);
  } catch (error) {
    console.warn(`[universe-ingest] listings DB upsert skipped: ${(error as Error).message}`);
  }
  const published = publishNseAllFromEquityMaster();
  if (!published.published) {
    throw new Error(published.reason ?? 'NSE_ALL publish rejected');
  }
  return `NSE EQ=${nse.length} merged=${merged.length} eligible=${published.snapshot?.eligibleRecordCount} version=${published.snapshot?.version}`;
}

async function ingestCryptoSpot(): Promise<string> {
  const provider = configuredCryptoUniverseProvider();
  const fetched = await fetchCryptoUniverse(provider);
  const result = publishCanonicalUniverseSnapshot({
    universeId: 'CRYPTO_SPOT_ALL',
    source: fetched.source,
    sourceUrl: fetched.sourceUrl,
    provider: fetched.provider,
    instruments: fetched.instruments,
    sourceCount: fetched.rawRecordCount,
    rawRecordCount: fetched.rawRecordCount,
    rejectedCount: fetched.rejectedCount,
    duplicateCount: fetched.duplicateCount,
    excludedCount: fetched.excludedCount,
    warnings: fetched.warnings,
    providerReportedTotal: fetched.providerReportedTotal ?? fetched.receivedTotal,
    receivedTotal: fetched.receivedTotal,
    pageCount: fetched.pageCount,
  });
  if (!result.published) throw new Error(result.reason ?? 'CRYPTO_SPOT_ALL publish rejected');
  return `provider=${provider} eligible=${result.snapshot?.eligibleRecordCount} version=${result.snapshot?.version}`;
}

async function ingestCryptoFutures(): Promise<string> {
  const fetched = await fetchCryptoFuturesUniverse();
  const result = publishCanonicalUniverseSnapshot({
    universeId: 'CRYPTO_FUTURES_ALL',
    source: fetched.source,
    sourceUrl: fetched.sourceUrl,
    provider: fetched.provider,
    instruments: fetched.instruments,
    sourceCount: fetched.rawRecordCount,
    rawRecordCount: fetched.rawRecordCount,
    rejectedCount: fetched.rejectedCount,
    duplicateCount: fetched.duplicateCount,
    excludedCount: fetched.excludedCount,
    warnings: fetched.warnings,
    providerReportedTotal: fetched.providerReportedTotal ?? fetched.receivedTotal,
    receivedTotal: fetched.receivedTotal,
    pageCount: fetched.pageCount,
  });
  if (!result.published) throw new Error(result.reason ?? 'CRYPTO_FUTURES_ALL publish rejected');
  return `eligible=${result.snapshot?.eligibleRecordCount} version=${result.snapshot?.version}`;
}

async function ingestApprovedFutures(
  universeId: 'MCX_FUTURES_ALL' | 'CME_FUTURES_ALL',
): Promise<string> {
  const fetched = await fetchApprovedFuturesFeed(universeId);
  if (!fetched.ok) {
    return `NOT_READY ${fetched.reasonCode}: ${fetched.detail}`;
  }
  const result = publishCanonicalUniverseSnapshot({
    universeId,
    source: `${universeId.toLowerCase()}-approved-feed`,
    sourceUrl:
      universeId === 'MCX_FUTURES_ALL'
        ? process.env.MCX_APPROVED_FEED_URL
        : process.env.CME_APPROVED_FEED_URL,
    provider: universeId === 'MCX_FUTURES_ALL' ? 'mcx' : 'cme',
    instruments: fetched.instruments,
    sourceCount: fetched.rawRecordCount,
    rawRecordCount: fetched.rawRecordCount,
    rejectedCount: fetched.rejectedCount,
    duplicateCount: 0,
    excludedCount: fetched.excludedCount,
    receivedTotal: fetched.rawRecordCount,
  });
  if (!result.published) throw new Error(result.reason ?? `${universeId} publish rejected`);
  return result.snapshot
    ? `eligible=${result.snapshot.eligibleRecordCount} version=${result.snapshot.version}`
    : fetched.detail;
}

async function ingestCommoditiesIfKeyed(): Promise<string> {
  const apiKey = String(process.env.ALPHA_VANTAGE_API_KEY ?? '').trim();
  if (!apiKey) {
    return 'SKIPPED (ALPHA_VANTAGE_API_KEY unset — COMMODITY_ALL stays NOT_READY)';
  }
  const result = await probeAndPublishCommodityUniverse(apiKey);
  if (!result.published) throw new Error(result.reason ?? 'COMMODITY_ALL publish rejected');
  return `eligible=${result.snapshot?.eligibleRecordCount} version=${result.snapshot?.version}`;
}

export async function ingestUniversesOnStart(): Promise<UniverseIngestStep[]> {
  const steps: UniverseIngestStep[] = [];
  steps.push(await step('NSE_ALL', ingestNseAll));
  steps.push(await step('US_ALL', ingestUsAllUniverse));
  steps.push(await step('FOREX_ALL', ingestForexAllUniverse));
  steps.push(await step('CRYPTO_SPOT_ALL', ingestCryptoSpot));
  steps.push(await step('CRYPTO_FUTURES_ALL', ingestCryptoFutures));
  steps.push(await step('MCX_FUTURES_ALL', () => ingestApprovedFutures('MCX_FUTURES_ALL')));
  steps.push(await step('CME_FUTURES_ALL', () => ingestApprovedFutures('CME_FUTURES_ALL')));
  steps.push(await step('COMMODITY_ALL', ingestCommoditiesIfKeyed));
  const failed = steps.filter((row) => !row.ok);
  console.log(
    `[universe-ingest] done ok=${steps.length - failed.length}/${steps.length}` +
      (failed.length ? ` failed=${failed.map((row) => row.id).join(',')}` : ''),
  );
  return steps;
}

async function main(): Promise<void> {
  await ingestUniversesOnStart();
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[universe-ingest] failed:', error);
      process.exitCode = 0;
    })
    .finally(() => disconnectPrisma());
}
