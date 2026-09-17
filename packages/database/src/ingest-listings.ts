/**
 * Download official NSE EQ + BSE equity lists (free), merge by ISIN,
 * write packages/database/data/equity-master.json, upsert into Postgres,
 * and delete placeholder NOM#### / BSE#### tickers.
 *
 *   node packages/database/dist/ingest-listings.js
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
import { publishNseAllFromEquityMaster } from './canonical-universe-registry';

async function main(): Promise<void> {
  console.log('[listings] downloading NSE EQUITY_L.csv (EQ series only)...');
  const nse = await downloadNseEquityList();
  console.log(`[listings] NSE EQ: ${nse.length}`);

  let bse: Awaited<ReturnType<typeof downloadBseEquityList>> = [];
  try {
    console.log('[listings] downloading BSE active equity scrips...');
    bse = await downloadBseEquityList();
    console.log(`[listings] BSE equity: ${bse.length}`);
  } catch (error) {
    console.warn(`[listings] BSE list skipped: ${(error as Error).message}`);
  }

  const merged = mergeListings(nse, bse);
  const path = saveEquityMaster(merged, 'NSE EQUITY_L.csv + BSE ListofScripData (ISIN-deduped)');
  console.log(`[listings] wrote ${merged.length} unique companies to ${path}`);

  try {
    const upserted = await upsertListings(merged);
    const removed = await deletePlaceholderStocks();
    console.log(`[listings] upserted ${upserted} stocks, removed ${removed} placeholder symbols`);
  } catch (error) {
    console.warn(
      `[listings] database upsert skipped (${(error as Error).message}). JSON snapshot is still saved.`,
    );
  }
  const published = publishNseAllFromEquityMaster();
  if (published.published) {
    console.log(
      `[listings] published NSE_ALL version=${published.snapshot?.version} eligible=${published.snapshot?.eligibleRecordCount}`,
    );
  } else {
    console.warn(`[listings] NSE_ALL publish skipped: ${published.reason}`);
  }
}

main()
  .catch((error) => {
    console.error('[listings] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
