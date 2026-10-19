/**
 * Map MDS panel rows → MI raw/normalized contracts.
 * Never fabricates missing values. Corporate events ≠ news headlines.
 */

import type {
  EvidenceSourceType,
  InstrumentRef,
  RawCorporateAction,
  RawCorporateDisclosure,
  RawFundamentalRecord,
  RawNewsArticle,
} from '@stockpred/shared-types';
import { normalizeFundamentalFacts, normalizeNewsArticle } from './market-intelligence-normalize';
import type { NseMdsFundamentalsPanelRow, NseMdsNewsPanelRow } from './nse-mds-evidence';
import { finitePanelNum, hasEquityStatementsGate, parsePanelAsOf } from './nse-mds-evidence';

export interface NseMdsCorporatePanelRow {
  symbol?: string;
  event_type?: string;
  headline?: string;
  category?: string;
  published_at?: string | null;
  available_at?: string | null;
  source?: string | null;
  url?: string | null;
  action_type?: string | null;
  ex_date?: string | null;
  /** SHAREHOLDING | ANNOUNCEMENT | CORPORATE_ACTION */
  kind?: 'ANNOUNCEMENT' | 'SHAREHOLDING' | 'CORPORATE_ACTION' | string;
}

function isoFromPanel(...values: Array<string | number | null | undefined>): string {
  const ms = parsePanelAsOf(...values);
  return ms != null ? new Date(ms).toISOString() : new Date().toISOString();
}

function nseProvenance(
  instrument: InstrumentRef,
  source: string,
  evidenceKind: 'FUNDAMENTAL' | 'FILING' | 'NEWS' | 'CORPORATE_ACTION' | 'SHAREHOLDING',
  availableAt: string,
  publishedAt?: string,
) {
  return {
    instrument,
    source,
    sourceType: 'NSE' as EvidenceSourceType,
    evidenceKind,
    availableAt,
    publishedAt,
    retrievedAt: new Date().toISOString(),
    parserVersion: 'mi-mds-bind.v1',
    normalizedVersion: 'mi-normalize.v1',
  };
}

/** Map one MDS fundamentals panel row → MI raw fundamental records (NSE primary). */
export function rawFundamentalsFromMdsPanel(
  instrument: InstrumentRef,
  row: NseMdsFundamentalsPanelRow | undefined,
): RawFundamentalRecord[] {
  if (!hasEquityStatementsGate(row)) return [];
  const availableAt = isoFromPanel(row!.available_at, row!.as_of_date);
  const publishedAt = isoFromPanel(row!.as_of_date, row!.available_at);
  const source = String(row!.source ?? 'nse')
    .toLowerCase()
    .includes('yahoo')
    ? 'yahoo-fundamentals'
    : 'nse-fundamentals';
  const sourceType: EvidenceSourceType = source.startsWith('yahoo') ? 'YAHOO' : 'NSE';
  const metrics: Array<{ metric: string; value: number | null | undefined; unit: string }> = [
    { metric: 'revenue', value: finitePanelNum(row!.revenue), unit: 'INR' },
    { metric: 'pat', value: finitePanelNum(row!.pat), unit: 'INR' },
    { metric: 'roe', value: finitePanelNum(row!.roe), unit: 'pct' },
    { metric: 'trailing_pe', value: finitePanelNum(row!.trailing_pe), unit: 'ratio' },
    { metric: 'price_to_book', value: finitePanelNum(row!.price_to_book), unit: 'ratio' },
  ];
  const out: RawFundamentalRecord[] = [];
  for (const m of metrics) {
    if (m.value == null) continue;
    out.push({
      provenance: {
        instrument,
        source,
        sourceType,
        evidenceKind: 'FUNDAMENTAL',
        availableAt,
        publishedAt,
        retrievedAt: new Date().toISOString(),
        parserVersion: 'mi-mds-bind.v1',
        normalizedVersion: 'mi-normalize.v1',
      },
      metric: m.metric,
      valueNative: m.value,
      unitNative: m.unit,
      periodEnd: row!.as_of_date ?? undefined,
    });
  }
  return out;
}

export function normalizedFundamentalsFromMdsPanel(
  instrument: InstrumentRef,
  row: NseMdsFundamentalsPanelRow | undefined,
) {
  return normalizeFundamentalFacts(instrument, rawFundamentalsFromMdsPanel(instrument, row));
}

/** News panel → RawNewsArticle (existing ingest + GDELT land in MDS panel). */
export function rawNewsFromMdsPanel(
  instrument: InstrumentRef,
  row: NseMdsNewsPanelRow | undefined,
): RawNewsArticle[] {
  const count = finitePanelNum(row?.news_count_7d);
  if (count == null || count <= 0) return [];
  const availableAt = isoFromPanel(row!.available_at, row!.as_of_date);
  const sourceRaw = String(row!.source ?? 'current').toLowerCase();
  const sourceType: EvidenceSourceType = sourceRaw.includes('gdelt')
    ? 'OTHER'
    : sourceRaw.includes('nse')
      ? 'NSE'
      : 'OTHER';
  return [
    {
      provenance: {
        instrument,
        source: sourceRaw.includes('gdelt') ? 'gdelt' : 'current-news-ingest',
        sourceType,
        evidenceKind: 'NEWS',
        availableAt,
        publishedAt: availableAt,
        retrievedAt: new Date().toISOString(),
        parserVersion: 'mi-mds-bind.v1',
        normalizedVersion: 'mi-normalize.v1',
      },
      articleId: `${instrument.symbol}:news-panel:${availableAt.slice(0, 10)}`,
      title: `${instrument.symbol} news cluster (${count} in window)`,
      category: 'MARKET',
      tags: sourceRaw.includes('gdelt') ? ['gdelt'] : ['ingest'],
    },
  ];
}

export function normalizedNewsFromMdsPanel(
  instrument: InstrumentRef,
  row: NseMdsNewsPanelRow | undefined,
) {
  return rawNewsFromMdsPanel(instrument, row).map((a) => normalizeNewsArticle(instrument, a));
}

/** Corporate panel → disclosure / action (never classified as NEWS). */
export function corporateFromMdsPanel(
  instrument: InstrumentRef,
  rows: NseMdsCorporatePanelRow[] | undefined,
): {
  disclosures: RawCorporateDisclosure[];
  actions: RawCorporateAction[];
} {
  const disclosures: RawCorporateDisclosure[] = [];
  const actions: RawCorporateAction[] = [];
  for (const row of rows ?? []) {
    const sym = String(row.symbol ?? '')
      .trim()
      .toUpperCase();
    if (sym && sym !== instrument.symbol.toUpperCase()) continue;
    const availableAt = isoFromPanel(row.available_at, row.published_at);
    const publishedAt = isoFromPanel(row.published_at, row.available_at);
    const kind = String(row.kind ?? 'ANNOUNCEMENT').toUpperCase();
    if (kind === 'CORPORATE_ACTION') {
      actions.push({
        provenance: nseProvenance(
          instrument,
          row.source ?? 'nse-corporate-actions',
          'CORPORATE_ACTION',
          availableAt,
          publishedAt,
        ),
        actionType: row.action_type ?? row.event_type ?? 'CORPORATE_ACTION',
        exDate: row.ex_date ?? undefined,
        details: { headline: row.headline, category: row.category, url: row.url },
      });
      continue;
    }
    const evidenceKind = kind === 'SHAREHOLDING' ? 'SHAREHOLDING' : 'FILING';
    disclosures.push({
      provenance: nseProvenance(
        instrument,
        row.source ?? 'nse-corporate-announcements',
        evidenceKind,
        availableAt,
        publishedAt,
      ),
      title: row.headline ?? row.event_type ?? 'Corporate announcement',
      category: row.category ?? row.event_type,
      bodyRef: row.url ?? undefined,
    });
  }
  return { disclosures, actions };
}

export function hasCorporateEvidence(rows: NseMdsCorporatePanelRow[] | undefined): boolean {
  return (rows ?? []).some((r) => Boolean(r.headline || r.event_type || r.action_type));
}
