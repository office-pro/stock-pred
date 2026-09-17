/**
 * Commodity products vs exchange futures.
 * Public delayed webpages are not production APIs. Do not scrape MCX/CME.
 */

export type CommodityUniverseKind =
  | 'COMMODITY_ALL'
  | 'FUTURES_ALL'
  | 'MCX_FUTURES_ALL'
  | 'CME_FUTURES_ALL';

export interface CommoditySourceGate {
  universeId: CommodityUniverseKind;
  supported: false;
  reasonCode: 'UNSUPPORTED_UNIVERSE';
  detail: string;
  requiredSource: 'ALPHA_VANTAGE' | 'EIA' | 'MCX' | 'CME';
  identityModel: 'PRODUCT' | 'CONTRACT';
  scrapeForbidden: true;
}

export function commodityUniverseGate(universeId: CommodityUniverseKind): CommoditySourceGate {
  if (universeId === 'COMMODITY_ALL') {
    return {
      universeId,
      supported: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      requiredSource: 'ALPHA_VANTAGE',
      identityModel: 'PRODUCT',
      scrapeForbidden: true,
      detail:
        'COMMODITY_ALL is commodity products/underlyings from a validated Alpha Vantage catalog (EIA for energy history), not NSE gold-company equities and not MCX/CME contract months. Run npm run ingest:commodities with ALPHA_VANTAGE_API_KEY.',
    };
  }
  if (universeId === 'MCX_FUTURES_ALL') {
    return {
      universeId,
      supported: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      requiredSource: 'MCX',
      identityModel: 'CONTRACT',
      scrapeForbidden: true,
      detail:
        'MCX_FUTURES_ALL requires an approved machine-readable delayed feed. A public delayed webpage is not a production API — do not scrape.',
    };
  }
  if (universeId === 'CME_FUTURES_ALL') {
    return {
      universeId,
      supported: false,
      reasonCode: 'UNSUPPORTED_UNIVERSE',
      requiredSource: 'CME',
      identityModel: 'CONTRACT',
      scrapeForbidden: true,
      detail:
        'CME_FUTURES_ALL requires an approved machine-readable delayed/reference source. CME website quotes are reference-only. Do not scrape.',
    };
  }
  return {
    universeId: 'FUTURES_ALL',
    supported: false,
    reasonCode: 'UNSUPPORTED_UNIVERSE',
    requiredSource: 'CME',
    identityModel: 'CONTRACT',
    scrapeForbidden: true,
    detail:
      'FUTURES_ALL is unsupported. Use CRYPTO_FUTURES_ALL, MCX_FUTURES_ALL, or CME_FUTURES_ALL. Do not invent a generic futures mega-list.',
  };
}

/** NSE listed names (even "GOLD" miners/ETFs) are equities, never commodity products. */
export function nseEquityIsNotCommodity(_symbol: string, _name: string): true {
  return true;
}

export function futuresContractIdentity(input: {
  symbol: string;
  venue?: string;
  underlying?: string;
  contractMonth?: string;
  expiry?: string;
  contractType?: string;
}): string | null {
  const underlying = String(input.underlying ?? '').trim();
  const venue = String(input.venue ?? '').trim();
  const month = String(input.contractMonth ?? input.expiry ?? '').trim();
  const contractType = String(input.contractType ?? '').trim();
  if (!underlying || !venue) return null;
  if (!month && contractType.toUpperCase() !== 'PERPETUAL') return null;
  return `${venue}|${underlying}|${contractType || month}|${month}|${input.symbol}`.toUpperCase();
}
