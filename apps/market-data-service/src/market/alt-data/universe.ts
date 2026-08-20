import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { getPrismaClient } from '@stockpred/database';

const UNIVERSE_IDS = ['nifty50', 'nifty100', 'nifty500', 'smallcap', 'all'] as const;
export type AltUniverseId = (typeof UNIVERSE_IDS)[number];

function isAltUniverseId(value: string): value is AltUniverseId {
  return (UNIVERSE_IDS as readonly string[]).includes(value);
}

function universeJsonPath(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'ml-engine', 'app', 'data', 'index_universes.json'),
    resolve(process.cwd(), 'apps/ml-engine/app/data/index_universes.json'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) return file;
  }
  throw new Error(`index_universes.json not found (tried ${candidates.join(', ')})`);
}

function basketSymbols(universe: Exclude<AltUniverseId, 'all'>): string[] {
  const payload = JSON.parse(readFileSync(universeJsonPath(), 'utf8')) as Record<string, string[]>;
  return (payload[universe] ?? []).map((row) => row.toUpperCase());
}

export function parseUniverse(raw?: string): AltUniverseId {
  const key = String(raw ?? 'nifty50')
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, '');
  const aliases: Record<string, AltUniverseId> = {
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
  const mapped = aliases[key] ?? 'nifty50';
  return isAltUniverseId(mapped) ? mapped : 'nifty50';
}

export async function resolveUniverseSymbols(universe: AltUniverseId): Promise<string[]> {
  const prisma = getPrismaClient();
  const wanted = universe === 'all' ? null : new Set(basketSymbols(universe));
  const rows = await prisma.stock.findMany({
    where: { listed: true },
    select: { symbol: true },
    orderBy: { symbol: 'asc' },
  });
  let picked = rows
    .map((row) => row.symbol.toUpperCase())
    .filter((symbol) => (wanted ? wanted.has(symbol) : true));
  if (wanted && picked.length === 0) {
    picked = [...wanted];
  }
  return picked;
}
