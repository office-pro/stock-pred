/**
 * Fetch Twelve Data /forex_pairs, then publish FOREX_ALL.
 *
 *   node packages/database/dist/ingest-forex-universe.js
 */
import { publishCanonicalUniverseSnapshot } from './canonical-universe-registry';
import { fetchForexUniverse } from './universe-ingest/twelve-data-forex';

export async function ingestForexAllUniverse(): Promise<string> {
  const apiKey = String(process.env.TWELVE_DATA_API_KEY ?? '').trim();
  if (!apiKey) {
    return 'SKIPPED (TWELVE_DATA_API_KEY unset — FOREX_ALL stays NOT_READY)';
  }
  const fetched = await fetchForexUniverse(apiKey);
  const result = publishCanonicalUniverseSnapshot({
    universeId: 'FOREX_ALL',
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
    receivedTotal: fetched.rawRecordCount,
    providerReportedTotal: fetched.rawRecordCount,
  });
  if (!result.published) {
    throw new Error(result.reason ?? 'FOREX_ALL publish rejected');
  }
  return `published FOREX_ALL version=${result.snapshot?.version} eligible=${result.snapshot?.eligibleRecordCount}`;
}

async function main(): Promise<void> {
  console.log('[forex-universe] provider=twelve-data (/forex_pairs)');
  const detail = await ingestForexAllUniverse();
  console.log(`[forex-universe] ${detail}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[forex-universe] failed:', error);
    process.exitCode = 1;
  });
}
