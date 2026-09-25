/**
 * CRYPTO-BATCH-EVIDENCE-INTEGRATION — NETWORK_PROJECT fundamentals.
 * Mempool = Bitcoin rows only. DefiLlama protocol/chain = ETH/DeFi where covered.
 * Distinct from F5 onchain. Missing → UNAVAILABLE, never PE/ROE or numeric 0 fill.
 */
import type {
  FundamentalPayload,
  InstrumentRef,
  NetworkProjectPayload,
} from '@stockpred/shared-types';
import { geckoIdForOnchain } from './crypto-onchain-evidence';

export const MEMPOOL_DIFFICULTY_URL = 'https://mempool.space/api/v1/difficulty-adjustment';
export const MEMPOOL_FEES_URL = 'https://mempool.space/api/v1/fees/recommended';
export const DEFILLAMA_PROTOCOLS_URL = 'https://api.llama.fi/protocols';
export const NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE';
export const NETWORK_NOT_BITCOIN = 'NETWORK_NOT_BITCOIN';

export function isBitcoinNetworkRef(ref: InstrumentRef): boolean {
  const gecko = geckoIdForOnchain(ref);
  if (gecko === 'bitcoin') return true;
  const symbol = String(ref.symbol ?? '')
    .trim()
    .toUpperCase();
  const underlying = String(ref.underlying ?? '')
    .trim()
    .toUpperCase();
  return (
    symbol === 'BTC' ||
    symbol === 'BTCUSDT' ||
    symbol === 'BTCUSDC' ||
    underlying === 'BTC' ||
    underlying === 'BITCOIN'
  );
}

function asPositive(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function unavailableNetwork(reasonCode = NETWORK_UNAVAILABLE): FundamentalPayload {
  return {
    kind: 'UNAVAILABLE',
    reasonCode,
    message: 'No supported network/fundamental source for this crypto asset',
  };
}

export interface MempoolBtcSnapshot {
  difficulty?: number;
  hashrate?: number;
  fees24h?: number;
  asOf: number;
}

export function parseMempoolDifficulty(raw: unknown): { difficulty?: number; hashrate?: number } {
  if (!raw || typeof raw !== 'object') return {};
  const rec = raw as Record<string, unknown>;
  return {
    difficulty: asPositive(rec.difficultyChange ?? rec.difficulty ?? rec.currentAdjustedHashrate),
    hashrate: asPositive(
      rec.currentAdjustedHashrate ??
        rec.estimatedHashrate ??
        rec.hashrate ??
        rec.nextRetargetHeight,
    ),
  };
}

export function parseMempoolFees(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  return asPositive(rec.fastestFee ?? rec.hourFee ?? rec.economyFee);
}

export async function loadMempoolBtc(deps: {
  fetchJson?: (url: string) => Promise<unknown>;
  now?: number;
}): Promise<MempoolBtcSnapshot | null> {
  const fetchJson =
    deps.fetchJson ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'stockpred-network/1.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  try {
    const [diffRaw, feesRaw] = await Promise.all([
      fetchJson(MEMPOOL_DIFFICULTY_URL),
      fetchJson(MEMPOOL_FEES_URL),
    ]);
    const diff = parseMempoolDifficulty(diffRaw);
    const fees24h = parseMempoolFees(feesRaw);
    if (diff.difficulty == null && diff.hashrate == null && fees24h == null) return null;
    return {
      ...diff,
      ...(fees24h != null ? { fees24h } : {}),
      asOf: deps.now ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export interface LlamaProtocolRow {
  geckoId: string;
  chain?: string;
  tvlUsd?: number;
  fees24h?: number;
}

export function parseDefiLlamaProtocols(raw: unknown): Map<string, LlamaProtocolRow> {
  const rows = Array.isArray(raw) ? raw : [];
  const out = new Map<string, LlamaProtocolRow>();
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const geckoId = String(rec.gecko_id ?? rec.geckoId ?? '')
      .trim()
      .toLowerCase();
    if (!geckoId) continue;
    const tvlUsd = asPositive(rec.tvl);
    const fees24h = asPositive(rec.fees24h ?? rec.fees_24h);
    const chain = String(rec.chain ?? rec.category ?? '').trim() || undefined;
    if (tvlUsd == null && fees24h == null) continue;
    out.set(geckoId, { geckoId, chain, tvlUsd, fees24h });
  }
  return out;
}

export async function loadDefiLlamaProtocols(deps: {
  fetchJson?: (url: string) => Promise<unknown>;
  body?: string;
}): Promise<Map<string, LlamaProtocolRow>> {
  if (deps.body != null) {
    try {
      return parseDefiLlamaProtocols(JSON.parse(deps.body));
    } catch {
      return new Map();
    }
  }
  const fetchJson =
    deps.fetchJson ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'stockpred-network/1.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  try {
    return parseDefiLlamaProtocols(await fetchJson(DEFILLAMA_PROTOCOLS_URL));
  } catch {
    return new Map();
  }
}

export function networkProjectForRef(
  ref: InstrumentRef,
  deps: {
    mempool?: MempoolBtcSnapshot | null;
    chains?: Map<string, { tvlUsd: number; chain: string }>;
    protocols?: Map<string, LlamaProtocolRow>;
    now?: number;
  },
): FundamentalPayload {
  const now = deps.now ?? Date.now();
  if (isBitcoinNetworkRef(ref)) {
    if (!deps.mempool) return unavailableNetwork(NETWORK_UNAVAILABLE);
    const payload: NetworkProjectPayload = {
      kind: 'NETWORK_PROJECT',
      provider: 'mempool',
      asOf: deps.mempool.asOf ?? now,
      ...(deps.mempool.difficulty != null ? { difficulty: deps.mempool.difficulty } : {}),
      ...(deps.mempool.hashrate != null ? { hashrate: deps.mempool.hashrate } : {}),
      ...(deps.mempool.fees24h != null ? { fees24h: deps.mempool.fees24h } : {}),
    };
    return payload;
  }
  const geckoId = geckoIdForOnchain(ref);
  if (!geckoId) return unavailableNetwork(NETWORK_UNAVAILABLE);
  const protocol = deps.protocols?.get(geckoId);
  if (protocol && (protocol.tvlUsd != null || protocol.fees24h != null)) {
    return {
      kind: 'NETWORK_PROJECT',
      provider: 'defillama',
      asOf: now,
      ...(protocol.chain ? { chain: protocol.chain } : {}),
      ...(protocol.tvlUsd != null ? { tvlUsd: protocol.tvlUsd } : {}),
      ...(protocol.fees24h != null ? { fees24h: protocol.fees24h } : {}),
    };
  }
  const chain = deps.chains?.get(geckoId);
  if (chain?.tvlUsd != null) {
    return {
      kind: 'NETWORK_PROJECT',
      provider: 'defillama',
      chain: chain.chain,
      tvlUsd: chain.tvlUsd,
      asOf: now,
    };
  }
  return unavailableNetwork(NETWORK_UNAVAILABLE);
}
