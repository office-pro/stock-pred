#!/usr/bin/env node
/**
 * Ops recovery: trim stocks table to match STOCK_UNIVERSE_MODE configured universe.
 * MDS loadUniverse() merges ALL DB rows, so a prior full-universe seed saturates quick-start boots.
 *
 * Usage: STOCK_UNIVERSE_MODE=quick-start DATABASE_URL=... node scripts/mds-recover-trim.mjs
 */
import { getPrismaClient, disconnectPrisma } from '../packages/database/dist/index.js';
import { getStockUniverse } from '../packages/database/dist/universe-config.js';

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const prisma = getPrismaClient();
  const allowed = new Set(getStockUniverse().map((s) => s.symbol));
  const all = await prisma.stock.findMany({ select: { symbol: true } });
  const extra = all.filter((r) => !allowed.has(r.symbol)).map((r) => r.symbol);

  console.log(`[mds-recover] mode=${process.env.STOCK_UNIVERSE_MODE || 'default'}`);
  console.log(`[mds-recover] allowed=${allowed.size} db=${all.length} extra=${extra.length}`);

  if (extra.length === 0) {
    console.log('[mds-recover] nothing to trim');
    return;
  }

  for (const batch of chunk(extra, 500)) {
    await prisma.predictionOutcome.deleteMany({ where: { symbol: { in: batch } } });
    await prisma.patternOccurrence.deleteMany({ where: { symbol: { in: batch } } });
    await prisma.pattern.deleteMany({ where: { symbol: { in: batch } } });
    await prisma.signal.deleteMany({ where: { symbol: { in: batch } } });
    await prisma.prediction.deleteMany({ where: { symbol: { in: batch } } });
    await prisma.trade.deleteMany({ where: { symbol: { in: batch } } });
    const r = await prisma.stock.deleteMany({ where: { symbol: { in: batch } } });
    console.log(`[mds-recover] deleted batch ${r.count}`);
  }

  const remaining = await prisma.stock.count();
  console.log(`[mds-recover] stocks remaining ${remaining}`);
}

main()
  .catch((e) => {
    console.error('[mds-recover] failed:', e);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
