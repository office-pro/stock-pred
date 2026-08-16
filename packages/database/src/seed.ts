import { getPrismaClient, disconnectPrisma } from './index';
import { getStockUniverse, getUniverseStats } from './universe-config';
import { deletePlaceholderStocks } from './listings';
import { ensureDemoUsers } from './demo-users';

/**
 * Seed: stock universe + demo users (one per role).
 * Demo passwords are for local development ONLY - rotate in any shared env.
 *
 * Usage:
 *   npm run prisma:seed
 *   STOCK_UNIVERSE_MODE=quick-start npm run prisma:seed
 *   npm run ingest:listings   # official NSE/BSE master, then re-seed or upserts itself
 */
async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const usersOnly = process.argv.includes('--users-only');
  if (usersOnly) {
    const count = await ensureDemoUsers(prisma);
    console.log(`Seeded ${count} demo users.`);
    return;
  }

  const STOCK_UNIVERSE = getStockUniverse();
  const stats = getUniverseStats();

  console.log(`\nSeeding ${stats.mode} universe...`);
  console.log(`   Total stocks: ${stats.totalStocks}`);
  console.log(`   Sectors: ${Array.from(stats.sectors).length}\n`);

  const removed = await deletePlaceholderStocks();
  if (removed > 0) {
    console.log(`Removed ${removed} placeholder NOM*/BSE#### symbols.`);
  }

  for (const stock of STOCK_UNIVERSE) {
    await prisma.stock.upsert({
      where: { symbol: stock.symbol },
      update: {
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        indices: stock.indices,
        listed: true,
      },
      create: {
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        sector: stock.sector,
        indices: stock.indices,
        listed: true,
      },
    });
  }
  console.log(`Seeded ${STOCK_UNIVERSE.length} stocks.`);

  const demoCount = await ensureDemoUsers(prisma);
  console.log(`Seeded ${demoCount} demo users.`);

  await prisma.auditLog.create({
    data: {
      actor: 'seed-script',
      action: 'DATABASE_SEEDED',
      details: { stocks: STOCK_UNIVERSE.length, users: demoCount, mode: stats.mode },
    },
  });
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
