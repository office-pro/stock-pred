import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/** Process-wide Prisma singleton (avoids connection-pool exhaustion). */
export function getPrismaClient(): PrismaClient {
  if (!client) {
    const url = process.env.DATABASE_URL;
    client = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

export { PrismaClient } from '@prisma/client';
export type { Prisma } from '@prisma/client';
export { STOCK_UNIVERSE } from './universe';
export type { UniverseStock } from './universe';
export { getStockUniverse, getUniverseStats, getUniverseMode } from './universe-config';
export type { UniverseMode } from './universe-config';
export { isPlaceholderSymbol, loadEquityMaster, listedToUniverse } from './listings';
export type { ListedEquity } from './listings';
export { DEMO_USERS, ensureDemoUsers } from './demo-users';
