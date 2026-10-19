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
export {
  assertMembershipNotFromMdsCache,
  classifyNseEligibility,
  ensureNseAllSnapshot,
  evaluateCompletenessGuard,
  gatedUniverseUnavailableDetail,
  isPublishableUniverseSnapshot,
  loadActiveUniverseSnapshot,
  membershipIdentity,
  normalizeCanonicalUniverseId,
  publishCanonicalUniverseSnapshot,
  publishNseAllFromEquityMaster,
  resolveGatedCanonicalUniverse,
  resolveNseAllMembership,
} from './canonical-universe-registry';
export type {
  CanonicalUniverseId,
  CanonicalUniverseInstrument,
  CanonicalUniverseSnapshot,
  SnapshotLifecycle,
} from './canonical-universe-registry';
export {
  classifyCryptoEligibility,
  configuredCryptoUniverseProvider,
} from './universe-ingest/crypto-eligibility';
export type { CryptoUniverseProvider } from './universe-ingest/crypto-eligibility';
export {
  normalizeBinanceExchangeInfo,
  normalizeCoinGeckoMarkets,
  fetchCryptoUniverse,
} from './universe-ingest/crypto-providers';
export {
  fetchCryptoFuturesUniverse,
  mapBinanceFuturesContractType,
  normalizeBinanceFuturesExchangeInfo,
} from './universe-ingest/crypto-futures';
export {
  ALPHA_VANTAGE_COMMODITY_FUNCTIONS,
  EIA_ENERGY_SERIES,
  commodityProductsFromAvCatalog,
  isAvCommodityProbeOk,
  probeAndPublishCommodityUniverse,
} from './universe-ingest/alpha-vantage-commodities';
export {
  commodityUniverseGate,
  futuresContractIdentity,
  nseEquityIsNotCommodity,
} from './universe-ingest/commodity-futures';
export {
  parseApprovedFuturesFeed,
  fetchApprovedFuturesFeed,
} from './universe-ingest/mcx-approved-feed';
export {
  fetchUsEquityUniverse,
  mergeUsListings,
  normalizeNasdaqListed,
} from './universe-ingest/nasdaq-trader-us';
export {
  fetchForexUniverse,
  normalizeTwelveDataForexPairs,
} from './universe-ingest/twelve-data-forex';
export { ingestForexAllUniverse } from './ingest-forex-universe';
export { canonicalInstrumentExists, searchCanonicalInstruments } from './instrument-search';
export { DEMO_USERS, ensureDemoUsers } from './demo-users';
