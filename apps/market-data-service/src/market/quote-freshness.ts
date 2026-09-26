/** Redis quote/candle TTL (seconds). */
export const MDS_QUOTE_REDIS_TTL_SECONDS = 60;
/** In-process quote freshness window. Matches Redis TTL. */
export const MDS_QUOTE_MEMORY_TTL_MS = 60_000;
/** Hot-path Yahoo last-trade / live-quote wait. */
export const MDS_HOT_PATH_TIMEOUT_MS = 1_500;

export function redisQuoteKey(symbol: string): string {
  return `stockpred:quote:${symbol}`;
}

export function redisCandleKey(symbol: string, timeframe: string, limit: number): string {
  return `stockpred:candles:${symbol}:${timeframe}:${limit}`;
}

export function isFreshMemoryQuote(input: {
  hasUsablePrice: boolean;
  lastLiveRefreshMs?: number | null;
  lastTickTimeMs?: number | null;
  /** When false (NSE/BSE cash closed), a usable in-memory price is served without Yahoo. */
  sessionOpen: boolean;
  nowMs?: number;
  ttlMs?: number;
}): boolean {
  if (!input.hasUsablePrice) return false;
  const now = input.nowMs ?? Date.now();
  const ttl = input.ttlMs ?? MDS_QUOTE_MEMORY_TTL_MS;
  if (input.lastLiveRefreshMs != null && now - input.lastLiveRefreshMs < ttl) {
    return true;
  }
  if (!input.sessionOpen) return true;
  const tickAt = input.lastTickTimeMs ?? 0;
  if (tickAt <= 0) return false;
  return now - tickAt < ttl;
}
