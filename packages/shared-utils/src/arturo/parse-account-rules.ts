import type { ArturoAccountRules } from '@stockpred/shared-types';

const ACCOUNT_TOKEN_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

export class ArturoAccountRulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArturoAccountRulesError';
  }
}

/**
 * Parse comma-separated account rules.
 * - `acme.local` → inclusion
 * - `-demo.local` → exclusion
 * Exact match after lowercase trim. Exclusions and inclusions must not conflict.
 */
export function parseAccountRules(raw: string | null | undefined): ArturoAccountRules {
  const source = (raw ?? '').trim();
  if (!source) {
    return { includes: [], excludes: [], raw: '' };
  }

  const parts = source
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const includes: string[] = [];
  const excludes: string[] = [];
  const seenInclude = new Set<string>();
  const seenExclude = new Set<string>();

  for (const part of parts) {
    const isExclude = part.startsWith('-');
    const token = (isExclude ? part.slice(1) : part).trim().toLowerCase();
    if (!token) {
      throw new ArturoAccountRulesError('Empty account token after trim');
    }
    if (!ACCOUNT_TOKEN_RE.test(token)) {
      throw new ArturoAccountRulesError(
        `Invalid account identifier "${token}". Use lowercase letters, digits, dots, underscores, or hyphens.`,
      );
    }
    if (isExclude) {
      if (seenExclude.has(token)) {
        throw new ArturoAccountRulesError(`Duplicate exclusion: ${token}`);
      }
      if (seenInclude.has(token)) {
        throw new ArturoAccountRulesError(
          `Conflicting rules for "${token}": cannot both include and exclude`,
        );
      }
      seenExclude.add(token);
      excludes.push(token);
    } else {
      if (seenInclude.has(token)) {
        throw new ArturoAccountRulesError(`Duplicate inclusion: ${token}`);
      }
      if (seenExclude.has(token)) {
        throw new ArturoAccountRulesError(
          `Conflicting rules for "${token}": cannot both include and exclude`,
        );
      }
      seenInclude.add(token);
      includes.push(token);
    }
  }

  return { includes, excludes, raw: source };
}

export function normalizeAccountId(accountId: string | null | undefined): string {
  return (accountId ?? '').trim().toLowerCase();
}
