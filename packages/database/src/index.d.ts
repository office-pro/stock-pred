import { PrismaClient } from '@prisma/client';
/** Process-wide Prisma singleton (avoids connection-pool exhaustion). */
export declare function getPrismaClient(): PrismaClient;
export declare function disconnectPrisma(): Promise<void>;
export { PrismaClient } from '@prisma/client';
export type { Prisma } from '@prisma/client';
export { STOCK_UNIVERSE } from './universe';
export type { UniverseStock } from './universe';
//# sourceMappingURL=index.d.ts.map