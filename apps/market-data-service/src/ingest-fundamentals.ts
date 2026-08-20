/**
 * Yahoo quoteSummary ingest into fundamental_snapshots (point-in-time).
 *
 *   node apps/market-data-service/dist/ingest-fundamentals.js --universe nifty50
 *   node apps/market-data-service/dist/ingest-fundamentals.js --universe nifty100
 *   node apps/market-data-service/dist/ingest-fundamentals.js --symbol RELIANCE
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getPrismaClient, disconnectPrisma } from '@stockpred/database';
import type { YahooSymbolHint } from './market/providers/yahoo.provider';
import { ingestSymbol, refreshSectorMedians } from './market/fundamentals-write';

const UNIVERSE_IDS = ['nifty50', 'nifty100', 'nifty500', 'smallcap', 'all'] as const;
type UniverseId = (typeof UNIVERSE_IDS)[number];

function isUniverseId(value: string): value is UniverseId {
  return (UNIVERSE_IDS as readonly string[]).includes(value);
}

function loadRootEnv(): void {
  const candidates = [
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cut = line.indexOf('=');
      if (cut <= 0) continue;
      const key = line.slice(0, cut).trim();
      if (process.env[key]) continue;
      let value = line.slice(cut + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    break;
  }
}

function parseArgs(argv: string[]): {
  universe: UniverseId;
  symbol: string | null;
  limit: number;
  full: boolean;
} {
  let universe: UniverseId = 'nifty50';
  let symbol: string | null = null;
  let limit = 0;
  let full = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--full') full = true;
    if (argv[i] === '--universe') {
      const raw = String(argv[i + 1] ?? 'nifty50')
        .trim()
        .toLowerCase()
        .replace(/[-_]/g, '');
      const aliases: Record<string, UniverseId> = {
        nifty50: 'nifty50',
        n50: 'nifty50',
        nifty100: 'nifty100',
        n100: 'nifty100',
        nifty500: 'nifty500',
        n500: 'nifty500',
        smallcap: 'smallcap',
        small: 'smallcap',
        all: 'all',
        listed: 'all',
      };
      universe = (() => {
        const mapped = aliases[raw] ?? 'nifty50';
        return isUniverseId(mapped) ? mapped : 'nifty50';
      })();
    }
    if (argv[i] === '--symbol')
      symbol =
        String(argv[i + 1] ?? '')
          .trim()
          .toUpperCase() || null;
    if (argv[i] === '--limit') limit = Math.max(0, Number(argv[i + 1] ?? 0));
  }
  return { universe, symbol, limit, full };
}

function universeJsonPath(): string {
  const candidates = [
    join(dirname(__dirname), '..', 'ml-engine', 'app', 'data', 'index_universes.json'),
    join(__dirname, '..', '..', 'ml-engine', 'app', 'data', 'index_universes.json'),
    resolve(process.cwd(), 'apps/ml-engine/app/data/index_universes.json'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return file;
  }
  throw new Error(`index_universes.json not found (tried ${candidates.join(', ')})`);
}

function basketSymbols(universe: Exclude<UniverseId, 'all'>): string[] {
  const path = universeJsonPath();
  const payload = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string[]>;
  return (payload[universe] ?? []).map((row) => row.toUpperCase());
}

async function resolveSymbols(
  universe: UniverseId,
  symbol: string | null,
  limit: number,
): Promise<Array<{ symbol: string; hint: YahooSymbolHint }>> {
  const prisma = getPrismaClient();
  if (symbol) {
    const row = await prisma.stock.findUnique({ where: { symbol } });
    return [
      {
        symbol,
        hint: {
          exchange: row?.exchange,
          bseCode: row?.bseCode,
          yahooSymbol: row?.yahooSymbol,
        },
      },
    ];
  }
  const wanted = universe === 'all' ? null : new Set(basketSymbols(universe));
  const rows = await prisma.stock.findMany({
    where: { listed: true },
    select: { symbol: true, exchange: true, bseCode: true, yahooSymbol: true },
    orderBy: { symbol: 'asc' },
  });
  let picked = rows.filter((row) => (wanted ? wanted.has(row.symbol.toUpperCase()) : true));
  if (wanted && picked.length === 0) {
    picked = [...wanted].map((name) => ({
      symbol: name,
      exchange: 'NSE',
      bseCode: null,
      yahooSymbol: `${name}.NS`,
    }));
  }
  if (limit > 0) picked = picked.slice(0, limit);
  return picked.map((row) => ({
    symbol: row.symbol.toUpperCase(),
    hint: { exchange: row.exchange, bseCode: row.bseCode, yahooSymbol: row.yahooSymbol },
  }));
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const targets = await resolveSymbols(args.universe, args.symbol, args.limit);
  console.log(
    `[fundamentals] universe=${args.universe} symbols=${targets.length}` +
      (args.symbol ? ` symbol=${args.symbol}` : '') +
      (args.full ? ' full=1' : ''),
  );
  let ok = 0;
  let failed = 0;
  let snapshots = 0;
  let cached = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const { symbol, hint } = targets[i];
    try {
      const result = await ingestSymbol(symbol, hint, { full: args.full });
      snapshots += result.snapshots;
      ok += 1;
      if (result.cached) {
        cached += 1;
        console.log(`[fundamentals] ${i + 1}/${targets.length} ${symbol}: cached`);
      } else {
        console.log(
          `[fundamentals] ${i + 1}/${targets.length} ${symbol}: ${result.snapshots} snapshots`,
        );
      }
    } catch (error) {
      failed += 1;
      console.warn(`[fundamentals] ${symbol} skipped: ${(error as Error).message}`);
    }
  }
  await refreshSectorMedians();
  console.log(`[fundamentals] done ok=${ok} failed=${failed} rows=${snapshots} cached=${cached}`);
}

main()
  .catch((error) => {
    console.error('[fundamentals] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
