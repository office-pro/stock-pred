import { ArturoReleaseMode, type ArturoAccountRules } from '@stockpred/shared-types';
import { normalizeAccountId } from './parse-account-rules';

export interface EvaluateFlagInput {
  mode: ArturoReleaseMode;
  rules: ArturoAccountRules;
  accountId: string;
}

/**
 * Central ARTURO release evaluator.
 * Exclusions always take precedence over inclusions and General Availability.
 */
export function evaluateFlag(input: EvaluateFlagInput): boolean {
  const account = normalizeAccountId(input.accountId);
  if (!account) return false;

  const excludes = new Set(input.rules.excludes.map(normalizeAccountId));
  if (excludes.has(account)) return false;

  if (input.mode === ArturoReleaseMode.OFF) return false;

  if (input.mode === ArturoReleaseMode.GENERAL_AVAILABILITY) return true;

  // CODE_BETA: only explicit includes
  const includes = new Set(input.rules.includes.map(normalizeAccountId));
  return includes.has(account);
}

/**
 * Resolve effective UI state: local override (including explicit false) wins over server.
 */
export function resolveEffectiveEnabled(
  serverEnabled: boolean,
  localOverride: boolean | undefined,
): { enabled: boolean; source: 'local' | 'server' } {
  if (localOverride !== undefined) {
    return { enabled: localOverride, source: 'local' };
  }
  return { enabled: serverEnabled, source: 'server' };
}
