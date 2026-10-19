/**
 * MI-2 helpers: corporate event taxonomy, PIT guard, coverage report builder.
 */

import { createHash } from 'crypto';
import type {
  InstrumentRef,
  MarketIntelligenceUniverseType,
  MiCoverageReport,
  MiCorporateEventType,
  MiIdentityResolutionStatus,
  MiInstrumentEvidenceStatus,
} from '@stockpred/shared-types';

export function miContentHash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/** Reject look-ahead: availableAt must be <= asOf. */
export function isAvailableAtAllowed(availableAt: string, asOf: string): boolean {
  const a = Date.parse(availableAt);
  const b = Date.parse(asOf);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a <= b;
}

/**
 * MI-3 PIT invariant: publishedAt <= asOf AND availableAt <= asOf.
 * Missing either timestamp → not eligible (no silent fallback).
 */
export function isPitEligible(
  publishedAt: string | Date | null | undefined,
  availableAt: string | Date | null | undefined,
  asOf: string | Date,
): boolean {
  if (publishedAt == null || availableAt == null) return false;
  const p = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(String(publishedAt));
  const a = availableAt instanceof Date ? availableAt.getTime() : Date.parse(String(availableAt));
  const o = asOf instanceof Date ? asOf.getTime() : Date.parse(String(asOf));
  if (!Number.isFinite(p) || !Number.isFinite(a) || !Number.isFinite(o)) return false;
  return p <= o && a <= o;
}

export function classifyMiCorporateEventType(raw: string): MiCorporateEventType {
  const t = raw.toUpperCase();
  if (/BOARD\s*MEET|BOARDMEET/.test(t)) return 'BOARD_MEETING';
  if (/EARNING|RESULT|FINANCIAL\s*RESULT|QUARTERLY|ANNUAL/.test(t)) return 'EARNINGS';
  if (/DIVIDEND/.test(t)) return 'DIVIDEND';
  if (/BUY\s*BACK|BUYBACK/.test(t)) return 'BUYBACK';
  if (/BONUS/.test(t)) return 'BONUS';
  if (/SPLIT|SUB.?DIVISION/.test(t)) return 'SPLIT';
  if (/ORDER\s*WIN|LARGE\s*ORDER|BAGS?\s+ORDER/.test(t)) return 'ORDER_WIN';
  if (/ACQUIS|MERGER|TAKEOVER/.test(t)) return 'ACQUISITION';
  if (/MANAGEMENT|APPOINT|RESIGN|DIRECTOR|CEO|CFO|MD\b/.test(t)) return 'MANAGEMENT_CHANGE';
  if (/SEBI|REGULAT|PENALT|SHOW\s*CAUSE/.test(t)) return 'REGULATORY_ACTION';
  return 'OTHER';
}

export interface MiCoverageInventoryRow {
  instrument: InstrumentRef;
  identityStatus: MiIdentityResolutionStatus;
  fundamentals: 'available' | 'partial' | 'unavailable';
  hasCorporate: boolean;
  hasNews: boolean;
  sentiment: 'scored' | 'unavailable' | 'na';
}

export function buildMiCoverageReport(input: {
  universeType: MarketIntelligenceUniverseType;
  universeVersion: string;
  asOf: string;
  requested: number;
  rows: MiCoverageInventoryRow[];
  macroAvailable: boolean;
}): MiCoverageReport {
  let resolved = 0;
  let unresolved = 0;
  let mismatch = 0;
  let fundAvail = 0;
  let fundPartial = 0;
  let fundUnavail = 0;
  let corpAvail = 0;
  let corpUnavail = 0;
  let newsWith = 0;
  let newsWithout = 0;
  let sentScored = 0;
  let sentUnavail = 0;

  for (const row of input.rows) {
    if (row.identityStatus === 'RESOLVED') resolved += 1;
    else if (row.identityStatus === 'IDENTITY_MISMATCH') mismatch += 1;
    else unresolved += 1;

    if (row.identityStatus !== 'RESOLVED') continue;

    if (row.fundamentals === 'available') fundAvail += 1;
    else if (row.fundamentals === 'partial') fundPartial += 1;
    else fundUnavail += 1;

    if (row.hasCorporate) corpAvail += 1;
    else corpUnavail += 1;

    if (row.hasNews) newsWith += 1;
    else newsWithout += 1;

    if (row.hasNews) {
      if (row.sentiment === 'scored') sentScored += 1;
      else sentUnavail += 1;
    }
  }

  return {
    universeType: input.universeType,
    universeVersion: input.universeVersion,
    asOf: input.asOf,
    universe: {
      requested: input.requested,
      resolved,
      unresolved,
      mismatch,
    },
    fundamentals: {
      available: fundAvail,
      partial: fundPartial,
      unavailable: fundUnavail,
    },
    corporateEvents: {
      available: corpAvail,
      unavailable: corpUnavail,
    },
    news: {
      instrumentsWithEvidence: newsWith,
      withoutEvidence: newsWithout,
    },
    sentiment: {
      scored: sentScored,
      unavailable: sentUnavail,
    },
    macro: { available: input.macroAvailable },
  };
}

/** Map preflight-style evidence flags → coverage inventory (tests / smoke). */
export function inventoryFromEvidenceStatuses(
  evidence: MiInstrumentEvidenceStatus[],
  opts?: { sentimentScoredSymbols?: Set<string>; fundamentalsPartialSymbols?: Set<string> },
): MiCoverageInventoryRow[] {
  const scored = opts?.sentimentScoredSymbols ?? new Set<string>();
  const partial = opts?.fundamentalsPartialSymbols ?? new Set<string>();
  return evidence.map((e) => {
    const sym = e.instrument.symbol.toUpperCase();
    let fundamentals: MiCoverageInventoryRow['fundamentals'] = 'unavailable';
    if (e.hasFundamentals) {
      fundamentals = partial.has(sym) ? 'partial' : 'available';
    }
    let sentiment: MiCoverageInventoryRow['sentiment'] = 'na';
    if (e.hasNewsInWindow) {
      sentiment = scored.has(sym) ? 'scored' : 'unavailable';
    }
    return {
      instrument: e.instrument,
      identityStatus: e.identityStatus,
      fundamentals,
      hasCorporate: e.hasCorporateEvents,
      hasNews: e.hasNewsInWindow,
      sentiment,
    };
  });
}

/** FinBERT missing → null sentiment (never fabricate NEUTRAL/0). */
export function miSentimentFromScore(
  score: number | null | undefined,
  modelVersion = 'finbert',
): {
  label?: 'positive' | 'negative' | 'neutral';
  score?: number;
  confidence?: number;
  modelVersion?: string;
  status: 'scored' | 'UNAVAILABLE';
} {
  if (score == null || !Number.isFinite(score)) {
    return { status: 'UNAVAILABLE' };
  }
  const label = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral';
  return {
    status: 'scored',
    label,
    score,
    confidence: Math.min(1, Math.abs(score)),
    modelVersion,
  };
}
