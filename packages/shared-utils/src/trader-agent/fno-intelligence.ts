/**
 * B15 F&O Intelligence — provider optional.
 * Until a real OI/IV feed is configured, always UNAVAILABLE.
 */
import type { FnoIntelligenceSnapshot } from '@stockpred/shared-types';
import { B9_B17_FEATURE_VERSION, provenance } from './b9-b17-helpers';

export function assessFnoIntelligence(
  symbol: string,
  providerConfigured = false,
  now: Date = new Date(),
): FnoIntelligenceSnapshot {
  const prov = provenance(
    'fno-intelligence',
    {
      modelVersion: 'fno.v1',
      featureVersion: B9_B17_FEATURE_VERSION,
    },
    now,
  );
  if (!providerConfigured) {
    return {
      status: 'UNAVAILABLE',
      reason: 'PROVIDER_NOT_CONFIGURED',
      symbol: symbol.toUpperCase(),
      provenance: prov,
    };
  }
  // Provider path reserved — still no fabricated OI/IV.
  return {
    status: 'UNAVAILABLE',
    reason: 'MISSING_INPUT',
    symbol: symbol.toUpperCase(),
    provenance: prov,
  };
}
