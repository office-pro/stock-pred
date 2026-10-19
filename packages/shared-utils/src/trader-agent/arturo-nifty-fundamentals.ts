import type { BatchPreflightConfiguration } from '@stockpred/shared-types';

/**
 * Universes gated by feat_nifty_all_stock_prequirement_fundamentals.
 * Covers Nifty baskets and NSE_ALL / NSE_EQUITY_ALL.
 */
export function isNiftyAllStockUniverse(universeType: string): boolean {
  const id = universeType.trim().toUpperCase();
  return (
    id === 'NIFTY50' ||
    id === 'NIFTY100' ||
    id === 'NIFTY150' ||
    id === 'NIFTY200' ||
    id === 'NIFTY500' ||
    id === 'NSE_ALL' ||
    id === 'NSE_EQUITY_ALL'
  );
}

/**
 * When ARTURO flag is ON: force fundamentals REQUIRED (real datasource params must be present).
 * When OFF: mark fundamentals NOT_APPLICABLE so missing fields do not block (no "fake" complete).
 * Non-Nifty universes are unchanged.
 */
export function applyArturoNiftyFundamentalsRequirement(
  config: BatchPreflightConfiguration,
  requireRealFundamentals: boolean,
): BatchPreflightConfiguration {
  if (!isNiftyAllStockUniverse(config.universeType)) return config;
  return {
    ...config,
    intelligence: {
      ...config.intelligence,
      fundamentals: requireRealFundamentals,
    },
  };
}
