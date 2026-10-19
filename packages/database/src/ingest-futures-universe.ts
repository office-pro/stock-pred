/**
 * Futures ingest gate. Generic FUTURES_ALL is unsupported.
 * MCX/CME publish only from an approved machine-readable feed URL.
 *
 *   node packages/database/dist/ingest-futures-universe.js
 *   node packages/database/dist/ingest-futures-universe.js --mcx
 *   node packages/database/dist/ingest-futures-universe.js --cme
 */
import { publishCanonicalUniverseSnapshot } from './canonical-universe-registry';
import { commodityUniverseGate } from './universe-ingest/commodity-futures';
import { fetchApprovedFuturesFeed } from './universe-ingest/mcx-approved-feed';

async function main(): Promise<void> {
  const kind = process.argv.includes('--mcx')
    ? 'MCX_FUTURES_ALL'
    : process.argv.includes('--cme')
      ? 'CME_FUTURES_ALL'
      : 'FUTURES_ALL';
  if (kind === 'FUTURES_ALL') {
    const gate = commodityUniverseGate(kind);
    console.error(`[futures-universe] ${gate.reasonCode}: ${gate.detail}`);
    process.exitCode = 2;
    return;
  }
  const fetched = await fetchApprovedFuturesFeed(kind);
  if (!fetched.ok) {
    console.error(`[futures-universe] ${fetched.reasonCode}: ${fetched.detail}`);
    process.exitCode = 2;
    return;
  }
  const result = publishCanonicalUniverseSnapshot({
    universeId: kind,
    source: `${kind.toLowerCase()}-approved-feed`,
    sourceUrl:
      kind === 'MCX_FUTURES_ALL'
        ? process.env.MCX_APPROVED_FEED_URL
        : process.env.CME_APPROVED_FEED_URL,
    provider: kind === 'MCX_FUTURES_ALL' ? 'mcx' : 'cme',
    instruments: fetched.instruments,
    sourceCount: fetched.rawRecordCount,
    rawRecordCount: fetched.rawRecordCount,
    rejectedCount: fetched.rejectedCount,
    duplicateCount: 0,
    excludedCount: fetched.excludedCount,
    receivedTotal: fetched.rawRecordCount,
  });
  if (!result.published) {
    console.error(`[futures-universe] publish rejected: ${result.reason}`);
    process.exitCode = 2;
    return;
  }
  console.log(
    `[futures-universe] published ${kind} version=${result.snapshot?.version} eligible=${result.snapshot?.eligibleRecordCount}`,
  );
}

main().catch((error) => {
  console.error('[futures-universe] failed:', error);
  process.exitCode = 1;
});
