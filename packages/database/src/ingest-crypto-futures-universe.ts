/**
 * Fetch Binance USD-M futures contracts, then publish CRYPTO_FUTURES_ALL.
 *
 *   node packages/database/dist/ingest-crypto-futures-universe.js
 */
import { publishCanonicalUniverseSnapshot } from './canonical-universe-registry';
import { fetchCryptoFuturesUniverse } from './universe-ingest/crypto-futures';

async function main(): Promise<void> {
  console.log('[crypto-futures] provider=binance-futures (spot universe is never merged)');
  const fetched = await fetchCryptoFuturesUniverse();
  console.log(
    `[crypto-futures] received=${fetched.receivedTotal} eligible=${fetched.instruments.length} rejected=${fetched.rejectedCount} excluded=${fetched.excludedCount}`,
  );
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
  if (!result.published) {
    console.error(`[crypto-futures] publish rejected: ${result.reason}`);
    process.exitCode = 2;
    return;
  }
  console.log(
    `[crypto-futures] published CRYPTO_FUTURES_ALL version=${result.snapshot?.version} eligible=${result.snapshot?.eligibleRecordCount}`,
  );
}

main().catch((error) => {
  console.error('[crypto-futures] failed:', error);
  process.exitCode = 1;
});
