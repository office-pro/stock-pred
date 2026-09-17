/**
 * Validate Alpha Vantage commodity catalog with one probe, then publish COMMODITY_ALL.
 * Does not invent tickers. Requires ALPHA_VANTAGE_API_KEY. 25 req/day — no HF polling.
 *
 *   node packages/database/dist/ingest-commodity-universe.js
 */
import { commodityUniverseGate } from './universe-ingest/commodity-futures';
import { probeAndPublishCommodityUniverse } from './universe-ingest/alpha-vantage-commodities';

async function main(): Promise<void> {
  if (
    process.argv.includes('--futures') ||
    process.argv.includes('--mcx') ||
    process.argv.includes('--cme')
  ) {
    const kind = process.argv.includes('--mcx')
      ? 'MCX_FUTURES_ALL'
      : process.argv.includes('--cme')
        ? 'CME_FUTURES_ALL'
        : 'FUTURES_ALL';
    const gate = commodityUniverseGate(kind);
    console.error(`[commodity-universe] ${gate.reasonCode}: ${gate.detail}`);
    process.exitCode = 2;
    return;
  }

  const apiKey = String(process.env.ALPHA_VANTAGE_API_KEY ?? '').trim();
  if (!apiKey) {
    const gate = commodityUniverseGate('COMMODITY_ALL');
    console.error(`[commodity-universe] ${gate.reasonCode}: ${gate.detail}`);
    process.exitCode = 2;
    return;
  }

  const result = await probeAndPublishCommodityUniverse(apiKey);
  if (!result.published) {
    console.error(`[commodity-universe] publish rejected: ${result.reason}`);
    process.exitCode = 2;
    return;
  }
  console.log(
    `[commodity-universe] published COMMODITY_ALL version=${result.snapshot?.version} eligible=${result.snapshot?.eligibleRecordCount}`,
  );
}

main().catch((error) => {
  console.error('[commodity-universe] failed:', error);
  process.exitCode = 1;
});
