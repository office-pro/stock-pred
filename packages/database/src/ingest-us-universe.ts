/**
 * Fetch NASDAQ Trader symbol directories, then publish US_ALL.
 *
 *   node packages/database/dist/ingest-us-universe.js
 */
import { publishCanonicalUniverseSnapshot } from './canonical-universe-registry';
import { fetchUsEquityUniverse } from './universe-ingest/nasdaq-trader-us';

export async function ingestUsAllUniverse(): Promise<string> {
  const fetched = await fetchUsEquityUniverse();
  const result = publishCanonicalUniverseSnapshot({
    universeId: 'US_ALL',
    source: fetched.source,
    sourceUrl: fetched.sourceUrl,
    provider: 'nasdaq-trader',
    instruments: fetched.instruments,
    sourceCount: fetched.rawRecordCount,
    rawRecordCount: fetched.rawRecordCount,
    rejectedCount: fetched.rejectedCount,
    duplicateCount: fetched.duplicateCount,
    excludedCount: fetched.excludedCount,
    warnings: fetched.warnings,
    receivedTotal: fetched.rawRecordCount,
    providerReportedTotal: fetched.rawRecordCount,
  });
  if (!result.published) {
    throw new Error(result.reason ?? 'US_ALL publish rejected');
  }
  return `published US_ALL version=${result.snapshot?.version} eligible=${result.snapshot?.eligibleRecordCount}`;
}

async function main(): Promise<void> {
  console.log('[us-universe] provider=nasdaq-trader (nasdaqlisted + otherlisted)');
  const detail = await ingestUsAllUniverse();
  console.log(`[us-universe] ${detail}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[us-universe] failed:', error);
    process.exitCode = 1;
  });
}
