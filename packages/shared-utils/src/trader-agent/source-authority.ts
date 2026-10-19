/**
 * SourceAuthorityPolicy + ProviderCapabilityAuthority.
 * Quotes authority ≠ sector/fundamentals/universe authority.
 * Fallback may supply data; it must NOT redefine universe membership.
 */

import type {
  ProviderAuthorityRole,
  ProviderCapabilityAuthority,
  SourceAuthorityPolicy,
} from '@stockpred/shared-types';
import { isProductionMarketDataProvider, NON_PRODUCTION_PROVIDERS } from './instrument-registry';

export const DEFAULT_SOURCE_AUTHORITY_POLICY: SourceAuthorityPolicy = {
  identity: ['nse-equity-master', 'instrument-registry'],
  universe: ['canonical-universe-registry', 'nse-equity-master'],
  marketData: ['broker-websocket', 'yahoo', 'nse', 'binance', 'coingecko', 'alpha-vantage', 'eia'],
  fundamentals: ['nse-fundamentals', 'yahoo-fundamentals'],
  corporateActions: ['nse', 'yahoo'],
  sector: ['nse-fundamentals', 'equity-master'],
  news: ['approved-news-provider'],
};

export const DEFAULT_PROVIDER_CAPABILITY_AUTHORITY: ProviderCapabilityAuthority[] = [
  { provider: 'nse-equity-master', capability: 'universe', role: 'PRIMARY' },
  { provider: 'canonical-universe-registry', capability: 'universe', role: 'PRIMARY' },
  { provider: 'broker-websocket', capability: 'marketData', role: 'PRIMARY' },
  { provider: 'yahoo', capability: 'marketData', role: 'SECONDARY' },
  { provider: 'yahoo', capability: 'historicalCandles', role: 'PRIMARY' },
  { provider: 'nse-fundamentals', capability: 'fundamentals', role: 'PRIMARY' },
  { provider: 'yahoo', capability: 'fundamentals', role: 'FALLBACK' },
  { provider: 'binance', capability: 'marketData', role: 'PRIMARY' },
  { provider: 'binance', capability: 'historicalCandles', role: 'PRIMARY' },
  { provider: 'coingecko', capability: 'marketData', role: 'SECONDARY' },
  { provider: 'alpha-vantage', capability: 'marketData', role: 'SECONDARY' },
  { provider: 'eia', capability: 'historicalCandles', role: 'SECONDARY' },
  { provider: 'mcx', capability: 'marketData', role: 'FALLBACK' },
  { provider: 'cme', capability: 'marketData', role: 'FALLBACK' },
  { provider: 'simulated', capability: 'marketData', role: 'FALLBACK' },
];

export interface ProviderSelectionResult {
  provider: string;
  providerSelectionReason: string;
  fallbackUsed: boolean;
  role: ProviderAuthorityRole;
  authorizedForUniverseMembership: false;
  productionCapable: boolean;
}

/**
 * Prefer PRIMARY → SECONDARY → approved FALLBACK.
 * Never auto-failover to simulated for production capability.
 */
export function selectProviderForCapability(input: {
  capability: string;
  preferred?: string | null;
  allowSimulated?: boolean;
  authorities?: ProviderCapabilityAuthority[];
}): ProviderSelectionResult | null {
  const rows = (input.authorities ?? DEFAULT_PROVIDER_CAPABILITY_AUTHORITY).filter(
    (a) => a.capability === input.capability,
  );
  if (!rows.length) return null;

  const order: ProviderAuthorityRole[] = ['PRIMARY', 'SECONDARY', 'FALLBACK'];
  const preferred = input.preferred?.trim().toLowerCase() || null;

  if (preferred) {
    const hit = rows.find((r) => r.provider.toLowerCase() === preferred);
    if (hit) {
      if (NON_PRODUCTION_PROVIDERS.has(hit.provider) && !input.allowSimulated) {
        // fall through to next approved
      } else {
        return {
          provider: hit.provider,
          providerSelectionReason:
            preferred === hit.provider.toLowerCase() ? 'preferred' : 'listed',
          fallbackUsed: hit.role === 'FALLBACK',
          role: hit.role,
          authorizedForUniverseMembership: false,
          productionCapable: isProductionMarketDataProvider(hit.provider),
        };
      }
    }
  }

  for (const role of order) {
    const candidates = rows.filter((r) => r.role === role);
    for (const c of candidates) {
      if (NON_PRODUCTION_PROVIDERS.has(c.provider) && !input.allowSimulated) continue;
      return {
        provider: c.provider,
        providerSelectionReason: `role_${role.toLowerCase()}`,
        fallbackUsed: role === 'FALLBACK',
        role,
        authorizedForUniverseMembership: false,
        productionCapable: isProductionMarketDataProvider(c.provider),
      };
    }
  }
  return null;
}

/** Universe membership authority is never a market-data fallback provider. */
export function providerMayRedefineUniverseMembership(provider: string): false {
  void provider;
  return false;
}

export function resolveAuthorityConflict(input: {
  field: keyof SourceAuthorityPolicy;
  sources: string[];
  policy?: SourceAuthorityPolicy;
}): { winner: string | null; conflict: boolean; reasonCode?: string } {
  const policy = input.policy ?? DEFAULT_SOURCE_AUTHORITY_POLICY;
  const ranked = policy[input.field] ?? [];
  const present = input.sources.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (present.length === 0) return { winner: null, conflict: false };
  if (present.length === 1) return { winner: present[0]!, conflict: false };

  let best: string | null = null;
  let bestIdx = Number.POSITIVE_INFINITY;
  for (const s of present) {
    const idx = ranked.findIndex((r) => r.toLowerCase() === s);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      best = s;
    }
  }
  if (best == null) {
    return { winner: null, conflict: true, reasonCode: 'IDENTITY_CONFLICT' };
  }
  const others = present.filter((s) => s !== best);
  const conflict = others.some((s) => ranked.some((r) => r.toLowerCase() === s));
  return conflict
    ? { winner: best, conflict: true, reasonCode: 'IDENTITY_CONFLICT' }
    : { winner: best, conflict: false };
}

/** Production certification gate before DataCapability.AVAILABLE. */
export function productionCertificationGate(input: {
  schemaOk: boolean;
  paginationOk: boolean;
  identityOk: boolean;
  freshnessOk: boolean;
  coverageOk: boolean;
  sampleComparisonOk: boolean;
  productionApproved: boolean;
}): { certified: boolean; capability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'; detail: string } {
  const steps = [
    ['schema', input.schemaOk],
    ['pagination', input.paginationOk],
    ['identity', input.identityOk],
    ['freshness', input.freshnessOk],
    ['coverage', input.coverageOk],
    ['sample_comparison', input.sampleComparisonOk],
    ['production_approved', input.productionApproved],
  ] as const;
  const failed = steps.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length === 0) {
    return { certified: true, capability: 'AVAILABLE', detail: 'production_certified' };
  }
  if (failed.includes('production_approved') || failed.includes('schema')) {
    return { certified: false, capability: 'UNAVAILABLE', detail: failed.join('|') };
  }
  return { certified: false, capability: 'PARTIAL', detail: failed.join('|') };
}
