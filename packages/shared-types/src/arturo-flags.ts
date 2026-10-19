/**
 * ARTURO flag key naming convention
 * ---------------------------------
 * Pattern:  feat_<area>_<feature>
 * Rules:
 *   - lowercase snake_case only: /^feat_[a-z][a-z0-9_]*$/
 *   - <area>    = product surface (desk, scanner, batch, bull_run, ml, admin, …)
 *   - <feature> = capability being gated (experimental_chip, new_banner, …)
 *   - no environments in the key (UI unlock is ?sha=develop; optional ARTURO_ENABLED=false hard-disables APIs)
 *   - no user/brand ids in the key (use account rules for targeting)
 *
 * Examples:
 *   feat_desk_experimental_chip
 *   feat_scanner_new_banner
 *   feat_batch_quote_first_preflight
 *
 * Usage:
 *   1. Add a constant below when you introduce a flag.
 *   2. Create the same key in the ARTURO UI.
 *   3. Gate with: useArturoFlag(ARTURO_FLAGS.DESK_EXPERIMENTAL_CHIP)
 */

/** Canonical flag keys used by the app. Prefer these over raw strings. */
export const ARTURO_FLAGS = {
  /** Agent Desk non-trading "Experimental" chip. */
  DESK_EXPERIMENTAL_CHIP: 'feat_desk_experimental_chip',
  /**
   * Nifty / NSE-all batch: when ON, fundamentals (and related datasource params)
   * must be present from the real source — do not treat incomplete rows as complete.
   * Key matches ARTURO UI (`prequirement` spelling preserved).
   */
  NIFTY_ALL_STOCK_REQUIREMENT_FUNDAMENTALS: 'feat_nifty_all_stock_prequirement_fundamentals',
} as const;

export type ArturoFlagKey = (typeof ARTURO_FLAGS)[keyof typeof ARTURO_FLAGS];

/** All registered keys (for docs / validation helpers). */
export const ARTURO_FLAG_KEYS: ArturoFlagKey[] = Object.values(ARTURO_FLAGS);

/**
 * Legacy keys kept for DB rows created before the feat_ convention.
 * Prefer ARTURO_FLAGS for new work; evaluate both when migrating.
 */
export const ARTURO_FLAG_LEGACY = {
  DESK_EXPERIMENTAL: 'arturo_desk_experimental',
} as const;

export const ARTURO_FLAG_KEY_PATTERN = /^feat_[a-z][a-z0-9_]*$/;

/** Build a convention-compliant key: arturoFlagKey('desk', 'experimental_chip') → feat_desk_experimental_chip */
export function arturoFlagKey(area: string, feature: string): string {
  const a = area
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const f = feature
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (!a || !f) {
    throw new Error('arturoFlagKey requires non-empty area and feature');
  }
  return `feat_${a}_${f}`;
}

export function isArturoFlagKey(value: string): boolean {
  return ARTURO_FLAG_KEY_PATTERN.test(value);
}

export const ARTURO_FLAG_KEY_HINT =
  'Use feat_<area>_<feature> (e.g. feat_desk_experimental_chip). Register in ARTURO_FLAGS.';
