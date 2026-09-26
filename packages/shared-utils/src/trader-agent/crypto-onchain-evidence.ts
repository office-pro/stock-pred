/**
 * F5 — crypto on-chain analytics, separate from Binance/CoinGecko/TD spot price.
 * DefiLlama chain TVL is SOURCE_REPORTED. Missing → UNAVAILABLE, never numeric 0.
 * Never authorizes BUY/SELL / Risk / Gate.
 */
import type { InstrumentRef, IntelligenceOnchainBlock } from '@stockpred/shared-types';

export const DEFILLAMA_CHAINS_URL = 'https://api.llama.fi/v2/chains';
export const ONCHAIN_UNAVAILABLE = 'ONCHAIN_UNAVAILABLE';
export const ONCHAIN_NOT_CRYPTO = 'ONCHAIN_NOT_CRYPTO';

const BINANCE_TO_GECKO: Record<string, string> = {
  BTC: 'bitcoin',
  BTCUSDT: 'bitcoin',
  BTCUSDC: 'bitcoin',
  ETH: 'ethereum',
  ETHUSDT: 'ethereum',
  ETHUSDC: 'ethereum',
  SOL: 'solana',
  SOLUSDT: 'solana',
  SOLUSDC: 'solana',
};

export function isCryptoOnchainAsset(ref: InstrumentRef): boolean {
  return ref.assetClass === 'CRYPTO_SPOT' || ref.assetClass === 'CRYPTO_FUTURE';
}

export function geckoIdForOnchain(ref: InstrumentRef): string | null {
  const pid = String(ref.providerAssetId ?? '').trim();
  const symbol = String(ref.symbol ?? '')
    .trim()
    .toUpperCase();
  const underlying = String(ref.underlying ?? '')
    .trim()
    .toUpperCase();
  if (BINANCE_TO_GECKO[pid.toUpperCase()]) return BINANCE_TO_GECKO[pid.toUpperCase()];
  if (BINANCE_TO_GECKO[symbol]) return BINANCE_TO_GECKO[symbol];
  if (BINANCE_TO_GECKO[underlying]) return BINANCE_TO_GECKO[underlying];
  const gecko = pid.toLowerCase();
  if (/^[a-z][a-z0-9-]+$/.test(gecko) && !gecko.endsWith('usdt') && !gecko.endsWith('usdc')) {
    return gecko;
  }
  return null;
}

function asPositive(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseDefiLlamaChains(raw: unknown): Map<string, { tvlUsd: number; chain: string }> {
  const rows = Array.isArray(raw) ? raw : [];
  const out = new Map<string, { tvlUsd: number; chain: string }>();
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const gecko = String(rec.gecko_id ?? rec.geckoId ?? '')
      .trim()
      .toLowerCase();
    const tvlUsd = asPositive(rec.tvl);
    const chain = String(rec.name ?? rec.chain ?? gecko).trim();
    if (!gecko || tvlUsd == null) continue;
    out.set(gecko, { tvlUsd, chain });
  }
  return out;
}

export function unavailableOnchain(
  ref: InstrumentRef,
  reasonCode: string,
  now = Date.now(),
): IntelligenceOnchainBlock {
  return {
    status: 'UNAVAILABLE',
    source: 'SOURCE_REPORTED',
    provider: 'defillama',
    geckoId: geckoIdForOnchain(ref) ?? undefined,
    asOf: now,
    reasonCode,
  };
}

export function onchainFromChainMap(
  ref: InstrumentRef,
  chains: Map<string, { tvlUsd: number; chain: string }>,
  now = Date.now(),
): IntelligenceOnchainBlock {
  if (!isCryptoOnchainAsset(ref)) {
    return unavailableOnchain(ref, ONCHAIN_NOT_CRYPTO, now);
  }
  const geckoId = geckoIdForOnchain(ref);
  if (!geckoId) return unavailableOnchain(ref, ONCHAIN_UNAVAILABLE, now);
  const hit = chains.get(geckoId);
  if (!hit) return unavailableOnchain(ref, ONCHAIN_UNAVAILABLE, now);
  return {
    status: 'AVAILABLE',
    source: 'SOURCE_REPORTED',
    provider: 'defillama',
    chain: hit.chain,
    geckoId,
    tvlUsd: hit.tvlUsd,
    asOf: now,
  };
}

export async function loadDefiLlamaChains(deps: {
  onchainBody?: string;
  onchainFetchJson?: (url: string) => Promise<unknown>;
}): Promise<Map<string, { tvlUsd: number; chain: string }>> {
  if (deps.onchainBody != null) {
    try {
      return parseDefiLlamaChains(JSON.parse(deps.onchainBody));
    } catch {
      return new Map();
    }
  }
  const fetchJson =
    deps.onchainFetchJson ??
    (async (url: string) => {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'stockpred-onchain/1.0' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  try {
    return parseDefiLlamaChains(await fetchJson(DEFILLAMA_CHAINS_URL));
  } catch {
    return new Map();
  }
}

export function shouldAttachOnchain(deps: {
  skipOnchain?: boolean;
  onchainBody?: string;
  onchainFetchJson?: unknown;
  fetchJson?: unknown;
  twelveDataClient?: unknown;
}): boolean {
  if (deps.skipOnchain) return false;
  if (deps.onchainBody != null || deps.onchainFetchJson) return true;
  // Production omits quote/TD test doubles. Injected fetchJson / twelveDataClient stay isolated.
  return !deps.fetchJson && !deps.twelveDataClient;
}
