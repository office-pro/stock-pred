/**
 * B17 US/Global → India Impact — news + macro evidence, targeted subset.
 * Never reruns full universe authorization. Consensus missing → Not available fields.
 */
import type {
  GlobalEventIntelligence,
  GlobalEventImportance,
  GlobalEventSectorImpact,
  GlobalEventStockImpact,
  GlobalImpactDirection,
} from '@stockpred/shared-types';
import { B9_B17_FEATURE_VERSION, provenance } from './b9-b17-helpers';

export interface GlobalEventInput {
  eventId?: string;
  eventType: string;
  country?: string | null;
  eventTime?: string | null;
  source: string;
  importance?: GlobalEventImportance;
  actual?: string | number | null;
  consensus?: string | number | null;
  previous?: string | number | null;
  headline?: string | null;
  /** Optional macro surprise proxy: positive = hawkish/hot print, etc. */
  surpriseDirection?: GlobalImpactDirection | null;
}

const SECTOR_EXPOSURE: Record<string, GlobalEventSectorImpact[]> = {
  US_CPI: [
    { sector: 'Information Technology', impact: 'NEGATIVE', note: 'Rates-sensitive growth' },
    { sector: 'Financial Services', impact: 'MIXED', note: 'NII vs risk appetite' },
    { sector: 'Realty', impact: 'NEGATIVE', note: 'Rate sensitivity' },
    { sector: 'Pharmaceuticals', impact: 'UNKNOWN' },
  ],
  US_FED: [
    { sector: 'Financial Services', impact: 'MIXED' },
    {
      sector: 'Information Technology',
      impact: 'NEGATIVE',
      note: 'Discount-rate effect if hawkish',
    },
    { sector: 'Energy', impact: 'MIXED' },
  ],
  US_NFP: [
    { sector: 'Financial Services', impact: 'MIXED' },
    { sector: 'Information Technology', impact: 'MIXED' },
  ],
  CRUDE: [
    { sector: 'Energy', impact: 'POSITIVE', note: 'If crude rises' },
    { sector: 'Consumer Discretionary', impact: 'NEGATIVE', note: 'Transport/input costs' },
  ],
  USDINR: [
    { sector: 'Information Technology', impact: 'POSITIVE', note: 'If USDINR rises (INR weak)' },
    { sector: 'Pharmaceuticals', impact: 'POSITIVE', note: 'Exporter FX' },
    { sector: 'Energy', impact: 'NEGATIVE', note: 'Import bill' },
  ],
  DEFAULT: [{ sector: 'UNKNOWN', impact: 'UNKNOWN', note: 'Insufficient mapping evidence' }],
};

function classifyEventType(input: GlobalEventInput): string {
  const t = `${input.eventType} ${input.headline ?? ''}`.toUpperCase();
  if (t.includes('CPI') || t.includes('INFLATION')) return 'US_CPI';
  if (t.includes('FED') || t.includes('FOMC') || t.includes('RATE')) return 'US_FED';
  if (t.includes('NFP') || t.includes('PAYROLL') || t.includes('JOBS')) return 'US_NFP';
  if (t.includes('CRUDE') || t.includes('OIL') || t.includes('BRENT')) return 'CRUDE';
  if (t.includes('USDINR') || t.includes('DOLLAR') || t.includes('DXY')) return 'USDINR';
  return 'DEFAULT';
}

function importanceOf(input: GlobalEventInput, kind: string): GlobalEventImportance {
  if (input.importance) return input.importance;
  if (kind === 'US_CPI' || kind === 'US_FED' || kind === 'US_NFP') return 'HIGH';
  if (kind === 'CRUDE' || kind === 'USDINR') return 'MEDIUM';
  return 'UNKNOWN';
}

function surpriseLabel(input: GlobalEventInput): string | null {
  if (input.actual == null || input.consensus == null) return null;
  const a = Number(input.actual);
  const c = Number(input.consensus);
  if (!Number.isFinite(a) || !Number.isFinite(c))
    return String(input.surpriseDirection ?? 'Not available');
  if (a > c) return 'ABOVE_CONSENSUS';
  if (a < c) return 'BELOW_CONSENSUS';
  return 'IN_LINE';
}

export function assessGlobalEventImpact(
  input: GlobalEventInput,
  exposedStocks: Array<{ symbol: string; sector?: string | null }> = [],
  now: Date = new Date(),
): GlobalEventIntelligence {
  const prov = provenance(
    'global-impact-intelligence',
    {
      modelVersion: 'global-impact.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  if (!input.eventType && !input.headline) {
    return {
      status: 'UNAVAILABLE',
      reason: 'MISSING_INPUT',
      eventId: input.eventId ?? 'unknown',
      eventType: 'UNKNOWN',
      source: input.source || 'unknown',
      importance: 'UNKNOWN',
      affectedAssets: [],
      affectedSectors: [],
      affectedStocks: [],
      provenance: prov,
    };
  }

  const kind = classifyEventType(input);
  const sectors = SECTOR_EXPOSURE[kind] ?? SECTOR_EXPOSURE.DEFAULT;
  const sectorImpact = new Map(sectors.map((s) => [s.sector.toUpperCase(), s.impact]));
  const stocks: GlobalEventStockImpact[] = exposedStocks.slice(0, 50).map((s) => {
    const sec = (s.sector || '').toUpperCase();
    const impact = sectorImpact.get(sec) ?? 'UNKNOWN';
    return {
      symbol: s.symbol.toUpperCase(),
      impact,
      exposureNote: s.sector ? `Sector map: ${s.sector}` : 'Sector unknown',
    };
  });

  const direction: GlobalImpactDirection =
    input.surpriseDirection ?? (kind === 'US_CPI' || kind === 'US_FED' ? 'MIXED' : 'UNKNOWN');

  return {
    status: 'AVAILABLE',
    eventId: input.eventId ?? `${kind}-${now.toISOString()}`,
    eventType: kind,
    country: input.country ?? (kind.startsWith('US_') ? 'US' : null),
    eventTime: input.eventTime ?? null,
    source: input.source,
    importance: importanceOf(input, kind),
    actual: input.actual ?? null,
    consensus: input.consensus ?? null,
    previous: input.previous ?? null,
    surprise: surpriseLabel(input) ?? 'Not available',
    direction,
    affectedAssets:
      kind === 'CRUDE'
        ? ['BRENT', 'USDINR']
        : kind === 'USDINR'
          ? ['USDINR', 'DXY']
          : ['USDINR', 'NIFTY'],
    affectedSectors: sectors,
    affectedStocks: stocks,
    historicalNote:
      'Exposure map is evidence-templated from sector sensitivity; validate with historical outcomes when event sample exists.',
    provenance: prov,
  };
}

/** Symbols/sectors to refresh continuously — not full NIFTY500. */
export function targetedUniverseFromGlobalEvent(event: GlobalEventIntelligence): {
  sectors: string[];
  symbols: string[];
} {
  return {
    sectors: event.affectedSectors.map((s) => s.sector).filter((s) => s !== 'UNKNOWN'),
    symbols: event.affectedStocks.map((s) => s.symbol),
  };
}
