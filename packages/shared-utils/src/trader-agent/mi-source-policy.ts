/**
 * Locked MI source-data policy (binding slice).
 * Yahoo is NOT fundamental SoT (historical OHLCV via MDS only).
 * Screener / TrueData remain disabled stubs — no scrape bypass.
 */

export type MiSourceCapability =
  | 'universe'
  | 'marketData'
  | 'historicalCandles'
  | 'fundamentals'
  | 'fundamentalEnrichment'
  | 'corporate'
  | 'news'
  | 'sentiment'
  | 'macro'
  | 'truedata';

export interface MiSourceBinding {
  capability: MiSourceCapability;
  primary: string[];
  secondary: string[];
  enabled: boolean;
  notes: string;
}

function csvEnv(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function flagEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

/** Canonical source graph — code mirrors SOURCE DATA POLICY. */
export function miSourceBindings(): MiSourceBinding[] {
  const screenerEnabled = flagEnv('SCREENER_ENABLED', false);
  const truedataEnabled = flagEnv('TRUEDATA_ENABLED', false);
  return [
    {
      capability: 'universe',
      primary: ['nse-equity-master'],
      secondary: [],
      enabled: true,
      notes: 'NSE securities/master → InstrumentRef[]',
    },
    {
      capability: 'marketData',
      primary: ['mds'],
      secondary: [],
      enabled: true,
      notes: 'Existing MDS only — no trader-agent bypass',
    },
    {
      capability: 'historicalCandles',
      primary: ['mds'],
      secondary: ['yahoo'],
      enabled: true,
      notes: 'MDS historical path; Yahoo only as MDS research/dev fallback',
    },
    {
      capability: 'fundamentals',
      primary: csvEnv('FUNDAMENTAL_PROVIDERS', 'nse'),
      secondary: [],
      enabled: true,
      notes: 'NSE official filings/results are primary',
    },
    {
      capability: 'fundamentalEnrichment',
      primary: [],
      secondary: csvEnv('FUNDAMENTAL_ENRICHMENT_PROVIDERS', 'screener'),
      enabled: screenerEnabled,
      notes: 'Screener enrichment only — disabled stub this slice',
    },
    {
      capability: 'corporate',
      primary: csvEnv('CORPORATE_PROVIDERS', 'nse'),
      secondary: [],
      enabled: true,
      notes: 'NSE announcements, shareholding, corporate actions',
    },
    {
      capability: 'news',
      primary: csvEnv('NEWS_PROVIDERS', 'current,gdelt'),
      secondary: [],
      enabled: true,
      notes: 'Existing news ingest + GDELT',
    },
    {
      capability: 'sentiment',
      primary: ['finbert'],
      secondary: [],
      enabled: true,
      notes: 'Derived from normalized news via ml-engine FinBERT — never fabricate',
    },
    {
      capability: 'macro',
      primary: [process.env.MACRO_PROVIDER?.trim() || 'rbi'],
      secondary: ['fred', 'yahoo'],
      enabled: true,
      notes: 'One batch MacroSnapshot; India repo/CPI prefer RBI DBIE',
    },
    {
      capability: 'truedata',
      primary: ['truedata'],
      secondary: [],
      enabled: truedataEnabled,
      notes: 'Adapter only; DISABLED — no API key required',
    },
  ];
}

export function resolveMiFundamentalProviders(): string[] {
  return csvEnv('FUNDAMENTAL_PROVIDERS', 'nse').filter(
    (id) => id !== 'yahoo' && (id !== 'truedata' || flagEnv('TRUEDATA_ENABLED')),
  );
}

export function resolveMiEnrichmentProviders(): string[] {
  if (!flagEnv('SCREENER_ENABLED', false)) return [];
  return csvEnv('FUNDAMENTAL_ENRICHMENT_PROVIDERS', 'screener');
}

export function resolveMiNewsProviders(): string[] {
  return csvEnv('NEWS_PROVIDERS', 'current,gdelt').filter(
    (id) => id !== 'truedata' || flagEnv('TRUEDATA_ENABLED'),
  );
}

export function resolveMiCorporateProviders(): string[] {
  return csvEnv('CORPORATE_PROVIDERS', 'nse');
}

export function resolveMiMacroProvider(): string {
  return process.env.MACRO_PROVIDER?.trim() || 'rbi';
}

export function isYahooFundamentalAuthority(): boolean {
  return false;
}

export function isScreenerLiveEnabled(): boolean {
  return flagEnv('SCREENER_ENABLED', false);
}

export function isTrueDataEnabled(): boolean {
  return flagEnv('TRUEDATA_ENABLED', false);
}
