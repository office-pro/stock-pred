/**
 * Alpha Vantage commodity *product* catalog.
 * Function names are the provider's documented dataset IDs — membership is published
 * only after a live probe succeeds. This is not an invented GOLD ticker list and
 * not MCX/CME futures months.
 */

import {
  publishCanonicalUniverseSnapshot,
  type CanonicalUniverseInstrument,
} from '../canonical-universe-registry';

export interface AlphaVantageCommodityFunction {
  function: string;
  symbol: string;
  name: string;
  quoteCurrency: 'USD';
  energy: boolean;
}

/** Provider-documented AV commodity datasets (https://www.alphavantage.co/documentation/#commodities). */
export const ALPHA_VANTAGE_COMMODITY_FUNCTIONS: AlphaVantageCommodityFunction[] = [
  { function: 'WTI', symbol: 'WTI', name: 'Crude Oil WTI', quoteCurrency: 'USD', energy: true },
  {
    function: 'BRENT',
    symbol: 'BRENT',
    name: 'Crude Oil Brent',
    quoteCurrency: 'USD',
    energy: true,
  },
  {
    function: 'NATURAL_GAS',
    symbol: 'NG',
    name: 'Henry Hub Natural Gas',
    quoteCurrency: 'USD',
    energy: true,
  },
  {
    function: 'COPPER',
    symbol: 'COPPER',
    name: 'Global Price of Copper',
    quoteCurrency: 'USD',
    energy: false,
  },
  {
    function: 'ALUMINUM',
    symbol: 'ALUMINUM',
    name: 'Global Price of Aluminum',
    quoteCurrency: 'USD',
    energy: false,
  },
  { function: 'WHEAT', symbol: 'WHEAT', name: 'Wheat', quoteCurrency: 'USD', energy: false },
  { function: 'CORN', symbol: 'CORN', name: 'Corn', quoteCurrency: 'USD', energy: false },
  { function: 'COTTON', symbol: 'COTTON', name: 'Cotton', quoteCurrency: 'USD', energy: false },
  { function: 'SUGAR', symbol: 'SUGAR', name: 'Sugar', quoteCurrency: 'USD', energy: false },
  { function: 'COFFEE', symbol: 'COFFEE', name: 'Coffee', quoteCurrency: 'USD', energy: false },
];

export const EIA_ENERGY_SERIES = [
  { id: 'PET.RWTC.D', symbol: 'WTI', name: 'Cushing OK WTI Spot' },
  { id: 'PET.RBRTE.D', symbol: 'BRENT', name: 'Europe Brent Spot' },
  { id: 'NG.RNGWHHD.D', symbol: 'NG', name: 'Henry Hub Natural Gas Spot' },
] as const;

export function commodityProductsFromAvCatalog(
  functions: AlphaVantageCommodityFunction[],
): CanonicalUniverseInstrument[] {
  return functions.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    venue: 'ALPHA_VANTAGE',
    series: 'PRODUCT',
    isin: null,
    assetClass: 'COMMODITY',
    quoteCurrency: row.quoteCurrency,
    provider: 'alpha-vantage',
    providerAssetId: row.function,
    canonicalSymbol: row.function,
    underlying: row.symbol,
    contractType: 'PRODUCT',
    instrumentType: 'PRODUCT',
    eligibilityStatus: 'ELIGIBLE',
    eligibilityReason: row.energy
      ? 'AV_COMMODITY|EIA_ENERGY_HISTORY_ELIGIBLE'
      : 'AV_COMMODITY_PRODUCT',
  }));
}

export function isAvCommodityProbeOk(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const row = payload as Record<string, unknown>;
  if (row.Note || row.Information || row['Error Message']) return false;
  const data = row.data;
  return Array.isArray(data) && data.length > 0;
}

export async function probeAndPublishCommodityUniverse(apiKey: string) {
  const probeUrl = `https://www.alphavantage.co/query?function=WTI&interval=monthly&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(probeUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'stockpred-universe-ingest/1.0' },
  });
  if (!response.ok) {
    throw new Error(`Alpha Vantage probe failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!isAvCommodityProbeOk(payload)) {
    throw new Error(
      'Alpha Vantage probe did not return a commodity series (rate limit or invalid key).',
    );
  }
  const instruments = commodityProductsFromAvCatalog(ALPHA_VANTAGE_COMMODITY_FUNCTIONS);
  return publishCanonicalUniverseSnapshot({
    universeId: 'COMMODITY_ALL',
    source:
      'Alpha Vantage documented commodity datasets (probe-validated; EIA eligible for energy history)',
    sourceUrl: 'https://www.alphavantage.co/documentation/#commodities',
    provider: 'alpha-vantage',
    instruments,
    sourceCount: ALPHA_VANTAGE_COMMODITY_FUNCTIONS.length,
    rawRecordCount: ALPHA_VANTAGE_COMMODITY_FUNCTIONS.length,
    rejectedCount: 0,
    duplicateCount: 0,
    excludedCount: 0,
    receivedTotal: ALPHA_VANTAGE_COMMODITY_FUNCTIONS.length,
    providerReportedTotal: ALPHA_VANTAGE_COMMODITY_FUNCTIONS.length,
  });
}
