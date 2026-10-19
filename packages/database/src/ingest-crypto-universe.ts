/**
 * Fetch one configured crypto universe provider, then publish CRYPTO_ALL.
 *
 *   CRYPTO_UNIVERSE_PROVIDER=binance|coingecko
 *   node packages/database/dist/ingest-crypto-universe.js
 *
 * CoinGecko and Binance are different universes and are never merged.
 * This script writes membership only — it does not download candles.
 */
import { publishCanonicalUniverseSnapshot } from './canonical-universe-registry';
import { configuredCryptoUniverseProvider } from './universe-ingest/crypto-eligibility';
import { fetchCryptoUniverse } from './universe-ingest/crypto-providers';

async function main(): Promise<void> {
  const provider = configuredCryptoUniverseProvider();
  console.log(`[crypto-universe] provider=${provider} (CRYPTO_UNIVERSE_PROVIDER; never merged)`);
  const fetched = await fetchCryptoUniverse(provider);
  console.log(
    `[crypto-universe] received=${fetched.receivedTotal} eligible=${fetched.instruments.length} rejected=${fetched.rejectedCount} excluded=${fetched.excludedCount} dup=${fetched.duplicateCount}`,
  );
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
  if (!result.published) {
    console.error(`[crypto-universe] publish rejected: ${result.reason}`);
    process.exitCode = 2;
    return;
  }
  console.log(
    `[crypto-universe] published CRYPTO_SPOT_ALL (alias CRYPTO_ALL) version=${result.snapshot?.version} eligible=${result.snapshot?.eligibleRecordCount}`,
  );
}

main().catch((error) => {
  console.error('[crypto-universe] failed:', error);
  process.exitCode = 1;
});
