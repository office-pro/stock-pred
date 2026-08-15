import { hashSync } from 'bcryptjs';
import { UserRole } from '@stockpred/shared-types';
import { getPrismaClient, disconnectPrisma } from './index';
import { getStockUniverse, getUniverseStats } from './universe-config';
import { deletePlaceholderStocks } from './listings';

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

  const demoUsers = [
    {
      email: 'admin@stockpred.local',
      name: 'Demo Admin',
      role: UserRole.ADMIN,
      password: 'Admin@12345',
    },
    {
      email: 'trader@stockpred.local',
      name: 'Demo Trader',
      role: UserRole.TRADER,
      password: 'Trader@12345',
    },
    {
      email: 'viewer@stockpred.local',
      name: 'Demo Viewer',
      role: UserRole.VIEWER,
      password: 'Viewer@12345',
    },
  ];

  for (const user of demoUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { role: user.role },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash: hashSync(user.password, 10),
      },
    });
  }
  console.log(`Seeded ${demoUsers.length} demo users.`);

  await prisma.auditLog.create({
    data: {
      actor: 'seed-script',
      action: 'DATABASE_SEEDED',
      details: { stocks: STOCK_UNIVERSE.length, users: demoUsers.length, mode: stats.mode },
    },
  });
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
