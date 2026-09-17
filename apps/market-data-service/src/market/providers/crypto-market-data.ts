/**
 * Free crypto market-data normalizers.
 * Universe membership is never taken from these payloads.
 * Binance and CoinGecko are never merged.
 */

export interface CryptoQuotePrint {
  providerAssetId: string;
  price: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  listedAt: number;
  provider: 'binance' | 'coingecko' | 'binance-futures';
  providerSelectionReason: string;
}

export interface CryptoKlineRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function configuredCryptoMarketDataProvider(
  raw = process.env.CRYPTO_MARKET_DATA_PROVIDER,
): 'binance' | 'coingecko' {
  const value = String(raw ?? 'binance')
    .trim()
    .toLowerCase();
  return value === 'coingecko' ? 'coingecko' : 'binance';
}

export function normalizeBinanceTicker24hr(
  rows: Array<{
    symbol?: string;
    lastPrice?: string;
    volume?: string;
    highPrice?: string;
    lowPrice?: string;
    openPrice?: string;
    closeTime?: number;
  }>,
  eligibleIds: Set<string>,
): CryptoQuotePrint[] {
  const out: CryptoQuotePrint[] = [];
  for (const row of rows) {
    const id = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    if (!id || !eligibleIds.has(id)) continue;
    const price = Number(row.lastPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      providerAssetId: id,
      price,
      volume: Number(row.volume) || 0,
      high: Number(row.highPrice) || price,
      low: Number(row.lowPrice) || price,
      open: Number(row.openPrice) || price,
      listedAt: Number(row.closeTime) || Date.now(),
      provider: 'binance',
      providerSelectionReason: 'CRYPTO_MARKET_DATA_PROVIDER=binance',
    });
  }
  return out;
}

export function normalizeCoinGeckoSimplePrice(
  payload: Record<string, { usd?: number; usd_24h_vol?: number }>,
  eligibleIds: Set<string>,
  now = Date.now(),
): CryptoQuotePrint[] {
  const out: CryptoQuotePrint[] = [];
  for (const [id, row] of Object.entries(payload ?? {})) {
    if (!eligibleIds.has(id)) continue;
    const price = Number(row?.usd);
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      providerAssetId: id,
      price,
      volume: Number(row.usd_24h_vol) || 0,
      high: price,
      low: price,
      open: price,
      listedAt: now,
      provider: 'coingecko',
      providerSelectionReason: 'CRYPTO_MARKET_DATA_PROVIDER=coingecko',
    });
  }
  return out;
}

export function normalizeBinanceKlines(rows: unknown[]): CryptoKlineRow[] {
  const out: CryptoKlineRow[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (![time, open, high, low, close].every((n) => Number.isFinite(n))) continue;
    out.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return out;
}

export function normalizeCoinGeckoMarketChart(payload: {
  prices?: Array<[number, number]>;
  total_volumes?: Array<[number, number]>;
}): CryptoKlineRow[] {
  const prices = payload?.prices ?? [];
  const volumes = new Map((payload?.total_volumes ?? []).map(([t, v]) => [t, v]));
  const out: CryptoKlineRow[] = [];
  for (const [time, close] of prices) {
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    out.push({
      time,
      open: close,
      high: close,
      low: close,
      close,
      volume: Number(volumes.get(time)) || 0,
    });
  }
  return out;
}

/** Spot prints never fill futures rows (and vice versa). Join on membership identity, not ticker. */
export function resolveCryptoPrintKeys(
  print: Pick<CryptoQuotePrint, 'providerAssetId' | 'provider'>,
  rows: Iterable<[string, { assetClass?: string; symbol: string; providerAssetId?: string }]>,
): string[] {
  const futures = print.provider === 'binance-futures';
  const keys: string[] = [];
  for (const [key, row] of rows) {
    const isFutures = row.assetClass === 'CRYPTO_FUTURE';
    if (futures !== isFutures) continue;
    if (key === print.providerAssetId || row.providerAssetId === print.providerAssetId) {
      keys.push(key);
      continue;
    }
    if (futures && row.symbol === print.providerAssetId) keys.push(key);
  }
  return keys;
}

export function remapBinanceFuturesPrints(
  prints: CryptoQuotePrint[],
  rows: Array<{ assetClass?: string; symbol: string; providerAssetId?: string }>,
): CryptoQuotePrint[] {
  const bySymbol = new Map(
    rows
      .filter((row) => row.assetClass === 'CRYPTO_FUTURE' && row.providerAssetId)
      .map((row) => [row.symbol, row.providerAssetId as string]),
  );
  return prints.flatMap((print) => {
    const id = bySymbol.get(print.providerAssetId);
    if (!id) return [];
    return [{ ...print, providerAssetId: id, provider: 'binance-futures' as const }];
  });
}

export function cryptoUniverseMatchesMarketData(
  universeProvider: string | null | undefined,
  marketDataProvider: 'binance' | 'coingecko',
): boolean {
  if (!universeProvider) return true;
  if (marketDataProvider === 'binance') return universeProvider === 'binance';
  return universeProvider === 'coingecko';
}
