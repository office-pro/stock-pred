/**
 * T1.7 Catalyst / Event Context (observe-only).
 *
 * Distinguishes event risk from directional catalysts. Never collapses into
 * CatalystScore. Soft conflicts only — never Risk / Portfolio / Policy / Gate.
 *
 * Look-ahead: at decision time T, only events with eventPublishedAt <= T enter.
 */
import type {
  CatalystConflict,
  CatalystContextAssessment,
  CatalystEventAssessment,
  CatalystEventProvenance,
  MarketReactionContext,
  TiCatalystDirection,
  TiCatalystRelevance,
  TiCatalystStrength,
  TiCatalystType,
  TiEventProximity,
  TiEventRisk,
  TiEventUncertainty,
  TiExpectedImpact,
  TiThesisInteraction,
  TiTradeHorizon,
} from '@stockpred/shared-types';

export const CATALYST_ENGINE_VERSION = 'catalyst-context.v1';
export const CATALYST_CALCULATION_VERSION = 'event-risk-not-direction.v1';

const BINARY_EVENT_TYPES = new Set<TiCatalystType>([
  'EARNINGS',
  'GUIDANCE',
  'REGULATORY',
  'MANAGEMENT_EVENT',
  'CORPORATE_ACTION',
]);

export interface CatalystEventCandidate {
  id?: string;
  type: TiCatalystType;
  title?: string;
  direction?: TiCatalystDirection;
  strength?: TiCatalystStrength;
  relevance?: TiCatalystRelevance;
  expectedImpact?: TiExpectedImpact;
  /** When the event became publicly knowable (required for look-ahead). */
  eventPublishedAt: string;
  eventEffectiveAt?: string;
  sourceDataTimestamp?: string;
  observedAt?: string;
  feedId?: string;
  source?: string;
  unresolvedBinary?: boolean;
  outcomeResolved?: boolean;
}

export interface AssessCatalystContextInput {
  intendedSide?: 'LONG' | 'SHORT';
  tradeHorizon?: TiTradeHorizon;
  /** Decision time T — look-ahead filter anchor. */
  decisionTimestamp: string | number;
  candidates?: CatalystEventCandidate[];
  marketReaction?: MarketReactionContext;
  asOf?: string;
}

function toMs(ts: string | number | undefined): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
}

function toIso(ts: string | number | undefined, fallbackMs: number): string {
  const ms = toMs(ts);
  return new Date(ms ?? fallbackMs).toISOString();
}

function normalizeTitle(title?: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80);
}

function effectiveDayKey(effectiveAt?: string, publishedAt?: string): string {
  const ms = toMs(effectiveAt) ?? toMs(publishedAt);
  if (ms == null) return 'unknown-day';
  return new Date(ms).toISOString().slice(0, 10);
}

/** Logical key for feed deduplication. */
export function logicalEventKey(c: CatalystEventCandidate): string {
  const day = effectiveDayKey(c.eventEffectiveAt, c.eventPublishedAt);
  const title = normalizeTitle(c.title);
  return `${c.type}|${day}|${title || 'untitled'}`;
}

export function isLookAheadSafe(
  candidate: Pick<CatalystEventCandidate, 'eventPublishedAt'>,
  decisionTimestamp: string | number,
): boolean {
  const published = toMs(candidate.eventPublishedAt);
  const decision = toMs(decisionTimestamp);
  if (published == null || decision == null) return false;
  return published <= decision;
}

function approxSessionsUntil(decisionMs: number, effectiveMs: number | null): number | null {
  if (effectiveMs == null) return null;
  const calendarDays = Math.round((effectiveMs - decisionMs) / 86_400_000);
  if (calendarDays < 0) return calendarDays;
  return Math.max(0, Math.round(calendarDays * (5 / 7)));
}

function proximityFromSessions(
  sessionsUntil: number | null,
  effectiveMs: number | null,
  decisionMs: number,
): TiEventProximity {
  if (effectiveMs == null) return 'UNKNOWN';
  if (effectiveMs < decisionMs) return 'PAST';
  if (sessionsUntil == null) return 'UNKNOWN';
  if (sessionsUntil <= 1) return 'IMMINENT';
  if (sessionsUntil <= 5) return 'NEAR';
  if (sessionsUntil <= 15) return 'UPCOMING';
  return 'DISTANT';
}

function impactRank(i: TiExpectedImpact): number {
  if (i === 'HIGH') return 3;
  if (i === 'MED') return 2;
  if (i === 'LOW') return 1;
  return 0;
}

function strengthRank(s: TiCatalystStrength): number {
  if (s === 'HIGH') return 3;
  if (s === 'MED') return 2;
  if (s === 'LOW') return 1;
  return 0;
}

function mergeImpact(a: TiExpectedImpact, b: TiExpectedImpact): TiExpectedImpact {
  return impactRank(a) >= impactRank(b) ? a : b;
}

function mergeStrength(a: TiCatalystStrength, b: TiCatalystStrength): TiCatalystStrength {
  return strengthRank(a) >= strengthRank(b) ? a : b;
}

function forceUnknownDirection(c: CatalystEventCandidate, decisionMs: number): boolean {
  if (c.outcomeResolved === true) return false;
  const effectiveMs = toMs(c.eventEffectiveAt);
  const isFuture = effectiveMs == null || effectiveMs >= decisionMs;
  if (!isFuture) return false;
  if (c.unresolvedBinary === true) return true;
  if (c.unresolvedBinary === false && c.direction && c.direction !== 'UNKNOWN') return false;
  return BINARY_EVENT_TYPES.has(c.type);
}

/** Dedupe candidates into one logical event per key. */
export function dedupeCatalystCandidates(
  candidates: CatalystEventCandidate[],
): CatalystEventCandidate[] {
  const map = new Map<string, CatalystEventCandidate & { _feeds: string[] }>();
  for (const c of candidates) {
    const key = logicalEventKey(c);
    const feed = c.feedId ?? c.source ?? 'unknown';
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...c, _feeds: [feed] });
      continue;
    }
    const existingPub = toMs(existing.eventPublishedAt) ?? Number.POSITIVE_INFINITY;
    const nextPub = toMs(c.eventPublishedAt) ?? Number.POSITIVE_INFINITY;
    const feeds = [...new Set([...existing._feeds, feed])];
    const winner =
      nextPub < existingPub
        ? { ...c, _feeds: feeds }
        : {
            ...existing,
            _feeds: feeds,
            direction: existing.direction ?? c.direction,
            title: existing.title ?? c.title,
            eventEffectiveAt: existing.eventEffectiveAt ?? c.eventEffectiveAt,
          };
    winner.expectedImpact = mergeImpact(
      existing.expectedImpact ?? 'UNKNOWN',
      c.expectedImpact ?? 'UNKNOWN',
    );
    winner.strength = mergeStrength(existing.strength ?? 'UNKNOWN', c.strength ?? 'UNKNOWN');
    winner.unresolvedBinary = Boolean(existing.unresolvedBinary || c.unresolvedBinary);
    winner.outcomeResolved = Boolean(existing.outcomeResolved || c.outcomeResolved);
    map.set(key, winner);
  }
  return [...map.values()].map(({ _feeds, ...rest }) => ({
    ...rest,
    feedId: rest.feedId ?? _feeds[0],
    id: rest.id ?? logicalEventKey(rest),
  }));
}

function resolveDirection(c: CatalystEventCandidate, decisionMs: number): TiCatalystDirection {
  if (forceUnknownDirection(c, decisionMs)) return 'UNKNOWN';
  return c.direction ?? 'UNKNOWN';
}

function resolveUncertainty(
  direction: TiCatalystDirection,
  proximity: TiEventProximity,
  impact: TiExpectedImpact,
  forcedBinary: boolean,
): TiEventUncertainty {
  if (
    forcedBinary &&
    (proximity === 'IMMINENT' || proximity === 'NEAR' || proximity === 'UPCOMING')
  ) {
    return 'HIGH';
  }
  if (direction === 'UNKNOWN' && (proximity === 'IMMINENT' || proximity === 'NEAR')) {
    return 'HIGH';
  }
  if (impact === 'HIGH' && proximity !== 'PAST' && proximity !== 'DISTANT') return 'MED';
  if (proximity === 'PAST' || proximity === 'DISTANT') return 'LOW';
  return 'MED';
}

function resolveEventRisk(events: CatalystEventAssessment[]): TiEventRisk {
  if (!events.length) return 'NONE';
  const hot = events.filter(
    (e) =>
      e.proximity === 'IMMINENT' ||
      e.proximity === 'NEAR' ||
      (e.proximity === 'UPCOMING' && e.expectedImpact === 'HIGH'),
  );
  if (!hot.length) {
    if (events.some((e) => e.proximity === 'UPCOMING')) return 'LOW';
    return 'NONE';
  }
  if (
    hot.some(
      (e) => e.uncertainty === 'HIGH' || e.expectedImpact === 'HIGH' || e.type === 'EARNINGS',
    )
  ) {
    return 'HIGH';
  }
  return 'MED';
}

function thesisInteractionFrom(
  intendedSide: 'LONG' | 'SHORT',
  events: CatalystEventAssessment[],
  eventRisk: TiEventRisk,
): TiThesisInteraction {
  if (!events.length) return 'NEUTRAL';
  const directional = events.filter((e) => e.direction === 'BULLISH' || e.direction === 'BEARISH');
  const aligns = (d: TiCatalystDirection) =>
    (intendedSide === 'LONG' && d === 'BULLISH') || (intendedSide === 'SHORT' && d === 'BEARISH');
  const opposes = (d: TiCatalystDirection) =>
    (intendedSide === 'LONG' && d === 'BEARISH') || (intendedSide === 'SHORT' && d === 'BULLISH');

  if (directional.some((e) => opposes(e.direction))) return 'CONFLICTS';
  if (eventRisk === 'HIGH' || eventRisk === 'MED') {
    const unresolvedNear = events.some(
      (e) =>
        e.direction === 'UNKNOWN' &&
        (e.proximity === 'IMMINENT' || e.proximity === 'NEAR' || e.proximity === 'UPCOMING'),
    );
    if (unresolvedNear) return 'INCREASES_EVENT_RISK';
  }
  if (directional.some((e) => aligns(e.direction))) return 'SUPPORTS';
  return 'NEUTRAL';
}

function buildConflicts(
  events: CatalystEventAssessment[],
  eventRisk: TiEventRisk,
  thesisInteraction: TiThesisInteraction,
): CatalystConflict[] {
  const conflicts: CatalystConflict[] = [];
  const earningsNear = events.filter(
    (e) =>
      e.type === 'EARNINGS' &&
      (e.proximity === 'IMMINENT' || e.proximity === 'NEAR' || e.proximity === 'UPCOMING'),
  );
  if (earningsNear.length) {
    conflicts.push({
      code: 'EARNINGS_NEAR',
      message: `Earnings event within ${earningsNear[0].sessionsUntil ?? '?'} sessions (direction=${earningsNear[0].direction})`,
      eventIds: earningsNear.map((e) => e.id),
    });
  }
  if (eventRisk === 'HIGH') {
    conflicts.push({
      code: 'EVENT_RISK_HIGH',
      message: 'Elevated event risk near decision — timing/uncertainty material',
      eventIds: events
        .filter((e) => e.proximity === 'IMMINENT' || e.proximity === 'NEAR')
        .map((e) => e.id),
    });
  }
  const unresolved = events.filter(
    (e) =>
      e.direction === 'UNKNOWN' &&
      e.uncertainty === 'HIGH' &&
      e.proximity !== 'PAST' &&
      e.proximity !== 'DISTANT',
  );
  if (unresolved.length) {
    conflicts.push({
      code: 'UNRESOLVED_BINARY_EVENT',
      message: 'Significant upcoming event with unknown outcome — not a directional catalyst',
      eventIds: unresolved.map((e) => e.id),
    });
  }
  if (thesisInteraction === 'CONFLICTS') {
    conflicts.push({
      code: 'CATALYST_CONFLICTS_THESIS',
      message: 'Known catalyst direction conflicts with intended side',
      eventIds: events
        .filter((e) => e.direction === 'BULLISH' || e.direction === 'BEARISH')
        .map((e) => e.id),
    });
  }
  return conflicts;
}

function toAssessment(
  c: CatalystEventCandidate,
  decisionMs: number,
  observedAt: string,
  sourceFeeds?: string[],
): CatalystEventAssessment {
  const effectiveMs = toMs(c.eventEffectiveAt);
  const sessionsUntil = approxSessionsUntil(decisionMs, effectiveMs);
  const proximity = proximityFromSessions(sessionsUntil, effectiveMs, decisionMs);
  const forced = forceUnknownDirection(c, decisionMs);
  const direction = resolveDirection(c, decisionMs);
  const expectedImpact = c.expectedImpact ?? (BINARY_EVENT_TYPES.has(c.type) ? 'HIGH' : 'MED');
  const uncertainty = resolveUncertainty(direction, proximity, expectedImpact, forced);
  const provenance: CatalystEventProvenance = {
    sourceDataTimestamp: c.sourceDataTimestamp,
    eventPublishedAt: toIso(c.eventPublishedAt, decisionMs),
    eventEffectiveAt: c.eventEffectiveAt ? toIso(c.eventEffectiveAt, decisionMs) : undefined,
    observedAt,
    feedId: c.feedId,
    source: c.source,
  };
  return {
    id: c.id ?? logicalEventKey(c),
    type: c.type,
    title: c.title,
    direction,
    strength: c.strength ?? (expectedImpact === 'HIGH' ? 'HIGH' : 'MED'),
    relevance: c.relevance ?? (proximity === 'IMMINENT' || proximity === 'NEAR' ? 'HIGH' : 'MED'),
    proximity,
    expectedImpact,
    uncertainty,
    sessionsUntil,
    provenance,
    sourceFeeds,
  };
}

/**
 * Assess catalyst / event context for a decision.
 * Empty or look-ahead-only candidates → eventRisk NONE, no invented calendar.
 */
export function assessCatalystContext(
  input: AssessCatalystContextInput,
): CatalystContextAssessment {
  const intendedSide = input.intendedSide ?? 'LONG';
  const decisionMs = toMs(input.decisionTimestamp) ?? Date.now();
  const decisionIso = new Date(decisionMs).toISOString();
  const asOf = input.asOf ?? decisionIso;
  const observedAt = asOf;

  const raw = input.candidates ?? [];
  const fresh = raw.filter((c) => isLookAheadSafe(c, decisionMs));
  const deduped = dedupeCatalystCandidates(fresh);

  const feedsByKey = new Map<string, string[]>();
  for (const c of fresh) {
    const key = logicalEventKey(c);
    const feed = c.feedId ?? c.source ?? 'unknown';
    const list = feedsByKey.get(key) ?? [];
    if (!list.includes(feed)) list.push(feed);
    feedsByKey.set(key, list);
  }

  const events = deduped.map((c) =>
    toAssessment(c, decisionMs, observedAt, feedsByKey.get(logicalEventKey(c))),
  );

  const eventRisk = resolveEventRisk(events);
  const thesisInteraction = thesisInteractionFrom(intendedSide, events, eventRisk);
  const conflicts = buildConflicts(events, eventRisk, thesisInteraction);

  return {
    intendedSide,
    tradeHorizon: input.tradeHorizon,
    events,
    eventRisk,
    thesisInteraction,
    ...(input.marketReaction ? { marketReaction: input.marketReaction } : {}),
    conflicts,
    provenance: {
      engineVersion: CATALYST_ENGINE_VERSION,
      calculationVersion: CATALYST_CALCULATION_VERSION,
      sourceDataTimestamp: decisionIso,
      asOf,
      inputs: {
        intendedSide,
        tradeHorizon: input.tradeHorizon ?? null,
        candidateCount: raw.length,
        lookAheadExcluded: raw.length - fresh.length,
        eventCount: events.length,
        eventRisk,
        thesisInteraction,
      },
    },
  };
}

/**
 * Best-effort candidates from aggregated AltDataView panels.
 * Never invents an upcoming earnings calendar — only published aggregates.
 */
export function candidatesFromAltData(alt: {
  symbol: string;
  news?: {
    availableAt: number;
    sentiment7d: number;
    highImpact7d: number;
    earningsSentiment: number;
    count7d: number;
  } | null;
  social?: {
    availableAt: number;
    attentionSpike: number;
    sentiment1d: number;
  } | null;
  macro?: {
    availableAt: number;
    usdinrChg20d: number | null;
    brentChg20d: number | null;
  } | null;
}): CatalystEventCandidate[] {
  const out: CatalystEventCandidate[] = [];
  const symbol = alt.symbol.toUpperCase();

  if (alt.news && alt.news.count7d > 0) {
    const published = new Date(alt.news.availableAt).toISOString();
    let direction: TiCatalystDirection = 'UNKNOWN';
    if (alt.news.sentiment7d >= 0.35) direction = 'BULLISH';
    else if (alt.news.sentiment7d <= -0.35) direction = 'BEARISH';
    out.push({
      id: `alt-news-${symbol}-${alt.news.availableAt}`,
      type: 'NEWS',
      title: `${symbol} news aggregate 7d`,
      direction,
      strength: alt.news.highImpact7d > 0 ? 'HIGH' : 'MED',
      relevance: 'MED',
      expectedImpact: alt.news.highImpact7d > 0 ? 'MED' : 'LOW',
      eventPublishedAt: published,
      eventEffectiveAt: published,
      sourceDataTimestamp: published,
      feedId: 'alt-news',
      source: 'alt-data',
      outcomeResolved: true,
    });
  }

  if (alt.social && alt.social.attentionSpike >= 0.6) {
    const published = new Date(alt.social.availableAt).toISOString();
    out.push({
      id: `alt-social-${symbol}-${alt.social.availableAt}`,
      type: 'NEWS',
      title: `${symbol} social attention spike`,
      direction: 'UNKNOWN',
      strength: 'MED',
      relevance: 'LOW',
      expectedImpact: 'LOW',
      eventPublishedAt: published,
      eventEffectiveAt: published,
      feedId: 'alt-social',
      source: 'alt-data',
      outcomeResolved: true,
    });
  }

  if (alt.macro) {
    const chg = Math.max(
      Math.abs(alt.macro.usdinrChg20d ?? 0),
      Math.abs(alt.macro.brentChg20d ?? 0),
    );
    if (chg >= 3) {
      const published = new Date(alt.macro.availableAt).toISOString();
      out.push({
        id: `alt-macro-${symbol}-${alt.macro.availableAt}`,
        type: 'MACRO',
        title: 'Macro move (USDINR Brent)',
        direction: 'UNKNOWN',
        strength: chg >= 6 ? 'HIGH' : 'MED',
        relevance: 'MED',
        expectedImpact: chg >= 6 ? 'MED' : 'LOW',
        eventPublishedAt: published,
        eventEffectiveAt: published,
        feedId: 'alt-macro',
        source: 'alt-data',
        outcomeResolved: true,
      });
    }
  }

  return out;
}
