/**
 * BATCH UNIVERSE RULE helpers (pure — no MDS / database).
 * Membership resolution lives in Canonical Universe Registry (@stockpred/database).
 */

/** Predefined universes must never require FE symbol entry. */
export const PREDEFINED_BATCH_UNIVERSES = new Set([
  'NIFTY50',
  'NIFTY100',
  'NIFTY150',
  'NIFTY500',
  'ALL',
  'NSE_ALL',
  'US_SP500',
  'US_ALL',
  'CRYPTO_ALL',
  'CRYPTO_SPOT_ALL',
  'CRYPTO_FUTURES_ALL',
  'COMMODITY_ALL',
  'FUTURES_ALL',
  'MCX_FUTURES_ALL',
  'CME_FUTURES_ALL',
  'FOREX_ALL',
  'SECTOR',
]);

export function universeRequiresManualInstruments(universeId: string): boolean {
  const u = String(universeId ?? '')
    .trim()
    .toUpperCase();
  if (!u) return true;
  if (PREDEFINED_BATCH_UNIVERSES.has(u)) return false;
  return u === 'CUSTOM' || u === 'SINGLE_STOCK' || u.endsWith('_CUSTOM');
}
