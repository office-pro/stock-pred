/**
 * ZERO-HALLUCINATION DATA POLICY helpers.
 * LLM/AI may interpret backend evidence but must never invent market data,
 * securities, universes, fundamentals, news, or confidence fillers.
 */

import type { UnavailableReasonCode } from '@stockpred/shared-types';

export const ZERO_HALLUCINATION_POLICY = {
  version: 'zhp.v1',
  llmIsAuthoritativeDataSource: false,
  forbiddenFillers: ['0', 'neutral', 'estimated_without_model', 'fabricated'] as const,
  missingDataStates: ['UNKNOWN', 'UNAVAILABLE', 'DATA_INCOMPLETE', 'MISSING', 'INVALID'] as const,
} as const;

export function assertNotLlmDataProvider(provider: string): boolean {
  const p = String(provider ?? '')
    .trim()
    .toLowerCase();
  if (!p) return false;
  const banned = ['llm', 'openai', 'anthropic', 'gpt', 'claude', 'gemini', 'model-knowledge'];
  return !banned.some((b) => p.includes(b));
}

/** Never treat missing evidence as a fabricated numeric/neutral filler. */
export function missingDataMarker(reasonCode: UnavailableReasonCode = 'DATA_INCOMPLETE'): {
  status: 'UNAVAILABLE';
  reasonCode: UnavailableReasonCode;
  value: null;
} {
  return { status: 'UNAVAILABLE', reasonCode, value: null };
}

export function refuseInventedUniverse(universeId: string): never {
  throw new Error(
    `UNSUPPORTED_UNIVERSE:${universeId} — canonical membership required; model knowledge cannot invent securities`,
  );
}
