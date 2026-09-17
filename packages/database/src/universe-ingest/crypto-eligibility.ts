/**
 * Crypto universe eligibility — membership only.
 * Market-data/history capability is a later intersection, never this filter's job.
 */

export type CryptoUniverseProvider = 'binance' | 'coingecko';

export const CRYPTO_SUPPORTED_QUOTES = new Set(['USDT', 'USDC']);
export const COINGECKO_QUOTE = 'USD';

export interface CryptoEligibilityInput {
  provider: CryptoUniverseProvider;
  providerAssetId?: string;
  symbol?: string;
  status?: string;
  tradable?: boolean;
  quoteAsset?: string;
  baseAsset?: string;
  marketCap?: number | null;
  price?: number | null;
  listedAt?: string | null;
}

export function configuredCryptoUniverseProvider(
  raw = process.env.CRYPTO_UNIVERSE_PROVIDER,
): CryptoUniverseProvider {
  const value = String(raw ?? 'binance')
    .trim()
    .toLowerCase();
  if (value === 'coingecko') return 'coingecko';
  return 'binance';
}

export function classifyCryptoEligibility(row: CryptoEligibilityInput): {
  status: 'ELIGIBLE' | 'EXCLUDED' | 'DELISTED' | 'INVALID_IDENTITY';
  reason?: string;
} {
  const id = String(row.providerAssetId ?? row.symbol ?? '')
    .trim()
    .toUpperCase();
  if (!id) return { status: 'INVALID_IDENTITY', reason: 'empty_provider_asset_id' };
  if (row.provider === 'binance') {
    const quote = String(row.quoteAsset ?? '').toUpperCase();
    if (!row.baseAsset) return { status: 'INVALID_IDENTITY', reason: 'missing_base_asset' };
    if (!CRYPTO_SUPPORTED_QUOTES.has(quote)) {
      return { status: 'EXCLUDED', reason: `unsupported_quote_${quote || 'unknown'}` };
    }
    if (String(row.status ?? '').toUpperCase() === 'BREAK') {
      return { status: 'DELISTED', reason: 'binance_break' };
    }
    if (String(row.status ?? '').toUpperCase() !== 'TRADING' || row.tradable === false) {
      return { status: 'EXCLUDED', reason: 'not_actively_tradable' };
    }
    return { status: 'ELIGIBLE', reason: 'ACTIVE|HAS_MARKET_DATA|SUPPORTED_QUOTE_CURRENCY' };
  }
  if (!row.providerAssetId) return { status: 'INVALID_IDENTITY', reason: 'missing_coingecko_id' };
  if (row.price == null || !Number.isFinite(row.price) || row.price <= 0) {
    return { status: 'EXCLUDED', reason: 'NO_MARKET_DATA' };
  }
  if (row.marketCap == null || row.marketCap <= 0) {
    return { status: 'EXCLUDED', reason: 'NO_MARKET_CAP' };
  }
  if (row.listedAt) {
    const listed = Date.parse(row.listedAt);
    const minHistoryMs = 30 * 24 * 60 * 60 * 1000;
    if (Number.isFinite(listed) && Date.now() - listed < minHistoryMs) {
      return { status: 'EXCLUDED', reason: 'MIN_HISTORY' };
    }
  }
  return { status: 'ELIGIBLE', reason: 'ACTIVE|HAS_MARKET_DATA|SUPPORTED_QUOTE_CURRENCY' };
}
