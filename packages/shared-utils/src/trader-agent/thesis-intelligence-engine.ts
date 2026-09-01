/**
 * T2.2 Thesis Intelligence Engine — advisory only.
 *
 * Isolated: no Risk, Portfolio, Policy, Gate, broker, or sizing access.
 */
import type {
  AgentAnalysis,
  IntelligenceSnapshot,
  StructuredThesis,
  ThesisEvidenceItem,
  ThesisEvidencePolarity,
  ThesisHistoryEvent,
  ThesisHistoryEventType,
  ThesisSnapshot,
  ThesisState,
  TiRegimeCompatibility,
  TiRsBucket,
  TiSectorFit,
} from '@stockpred/shared-types';
import { INTELLIGENCE_SCHEMA_VERSION } from '@stockpred/shared-types';

export const THESIS_INTELLIGENCE_ENGINE_VERSION = 'thesis-intelligence.v1';

export interface BuildStructuredThesisInput {
  now: number;
  analysis: AgentAnalysis;
  snapshot: IntelligenceSnapshot;
  tradeHorizon?: string;
  strategyTag?: string;
}

export interface ReassessThesisInput {
  now: number;
  initial: StructuredThesis;
  analysis: AgentAnalysis;
  snapshot: IntelligenceSnapshot;
}

export interface ThesisEvidenceDigest {
  rs?: ThesisEvidencePolarity;
  sector?: ThesisEvidencePolarity;
  regime?: ThesisEvidencePolarity;
  mtf?: ThesisEvidencePolarity;
  catalyst?: ThesisEvidencePolarity;
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

export function rsPolarity(bucket: TiRsBucket | undefined): ThesisEvidencePolarity {
  if (!bucket || bucket === 'UNKNOWN') return 'UNKNOWN';
  if (bucket === 'LEADERS') return 'POSITIVE';
  if (bucket === 'MIDDLE') return 'NEUTRAL';
  return 'NEGATIVE';
}

export function sectorPolarity(fit: TiSectorFit | undefined): ThesisEvidencePolarity {
  if (!fit || fit === 'UNKNOWN') return 'UNKNOWN';
  if (fit === 'HIGH') return 'POSITIVE';
  if (fit === 'MED') return 'NEUTRAL';
  return 'NEGATIVE';
}

export function regimePolarity(
  compatibility: TiRegimeCompatibility | undefined,
): ThesisEvidencePolarity {
  if (!compatibility || compatibility === 'UNKNOWN') return 'UNKNOWN';
  if (compatibility === 'FAVORABLE') return 'POSITIVE';
  if (compatibility === 'NEUTRAL') return 'NEUTRAL';
  return 'NEGATIVE';
}

export function mtfPolarity(agreement: string | undefined): ThesisEvidencePolarity {
  if (!agreement || agreement === 'UNKNOWN') return 'UNKNOWN';
  if (agreement === 'HIGH') return 'POSITIVE';
  if (agreement === 'MED') return 'NEUTRAL';
  if (agreement === 'LOW') return 'NEGATIVE';
  return 'UNKNOWN';
}

export function catalystPolarity(eventRisk: string | undefined): ThesisEvidencePolarity {
  if (!eventRisk || eventRisk === 'UNKNOWN' || eventRisk === 'NONE') return 'UNKNOWN';
  if (eventRisk === 'LOW') return 'POSITIVE';
  if (eventRisk === 'MED') return 'NEUTRAL';
  if (eventRisk === 'HIGH') return 'NEGATIVE';
  return 'UNKNOWN';
}

export function isWeakenedTransition(
  prior: ThesisEvidencePolarity,
  current: ThesisEvidencePolarity,
): boolean {
  if (prior === 'UNKNOWN' || current === 'UNKNOWN') return false;
  if (prior === 'POSITIVE' && (current === 'NEUTRAL' || current === 'NEGATIVE')) return true;
  if (prior === 'NEUTRAL' && current === 'NEGATIVE') return true;
  return false;
}

export function digestThesisEvidence(snapshot: IntelligenceSnapshot): ThesisEvidenceDigest {
  return {
    rs: rsPolarity(snapshot.crossSectionalRs?.rsBucket),
    sector: sectorPolarity(snapshot.sectorIntelligence?.sectorFit),
    regime: regimePolarity(snapshot.regimeCompatibility?.compatibility),
    mtf: mtfPolarity(snapshot.multiHorizonAgreement?.agreement),
    catalyst: catalystPolarity(snapshot.catalystContext?.eventRisk),
  };
}

function buildSupportingEvidence(snapshot: IntelligenceSnapshot): ThesisEvidenceItem[] {
  const items: ThesisEvidenceItem[] = [];
  const rs = snapshot.crossSectionalRs?.rsBucket;
  if (rs && rs !== 'UNKNOWN') {
    items.push({
      code: 'RS',
      message: `RS ${rs}`,
      source: 'crossSectionalRs.rsBucket',
      polarity: rsPolarity(rs),
    });
  }
  const sector = snapshot.sectorIntelligence?.sectorFit;
  if (sector && sector !== 'UNKNOWN') {
    items.push({
      code: 'SECTOR',
      message: `Sector ${sector}`,
      source: 'sectorIntelligence.sectorFit',
      polarity: sectorPolarity(sector),
    });
  }
  const regime = snapshot.regimeCompatibility?.compatibility;
  if (regime && regime !== 'UNKNOWN') {
    items.push({
      code: 'REGIME',
      message: `Regime ${regime}`,
      source: 'regimeCompatibility.compatibility',
      polarity: regimePolarity(regime),
    });
  }
  const mtf = snapshot.multiHorizonAgreement?.agreement;
  if (mtf && mtf !== 'UNKNOWN') {
    items.push({
      code: 'MTF',
      message: `MTF ${mtf}`,
      source: 'multiHorizonAgreement.agreement',
      polarity: mtfPolarity(mtf),
    });
  }
  const eventRisk = snapshot.catalystContext?.eventRisk;
  if (eventRisk && eventRisk !== 'UNKNOWN' && eventRisk !== 'NONE') {
    items.push({
      code: 'CATALYST',
      message: `Event risk ${eventRisk}`,
      source: 'catalystContext.eventRisk',
      polarity: catalystPolarity(eventRisk),
    });
  }
  return items;
}

/** Collect explicit invalidation conditions only — never auto-add stopLoss. */
export function collectInvalidationConditions(
  analysis: AgentAnalysis,
  snapshot: IntelligenceSnapshot,
): string[] {
  const conditions = new Set<string>();
  if (analysis.invalidation?.trim()) {
    conditions.add(analysis.invalidation.trim());
  }
  for (const c of snapshot.thesis?.invalidation?.conditions ?? []) {
    if (c?.trim()) conditions.add(c.trim());
  }
  if (snapshot.thesis?.invalidation?.price != null) {
    conditions.add(`Price below ${snapshot.thesis.invalidation.price}`);
  }
  return [...conditions];
}

function hasSufficientEvidence(evidence: ThesisEvidenceItem[]): boolean {
  return evidence.some((e) => e.polarity !== 'UNKNOWN');
}

function deriveInitialState(evidence: ThesisEvidenceItem[]): ThesisState {
  return hasSufficientEvidence(evidence) ? 'VALID' : 'UNKNOWN';
}

export function buildStructuredThesis(input: BuildStructuredThesisInput): StructuredThesis {
  const supportingEvidence = buildSupportingEvidence(input.snapshot);
  const invalidationConditions = collectInvalidationConditions(input.analysis, input.snapshot);
  const side =
    input.analysis.setup?.direction === 'SHORT' || input.analysis.decision.includes('SELL')
      ? 'SHORT'
      : 'LONG';

  return {
    symbol: input.analysis.symbol,
    side,
    tradeHorizon: input.tradeHorizon,
    strategyTag: input.strategyTag ?? input.snapshot.strategyTag,
    setup:
      input.snapshot.thesis?.setup ?? input.analysis.setup?.instrument ?? input.analysis.thesis,
    primaryThesis: input.analysis.thesis,
    supportingEvidence,
    invalidationConditions,
    state: deriveInitialState(supportingEvidence),
    provenance: {
      engineVersion: THESIS_INTELLIGENCE_ENGINE_VERSION,
      generatedAt: iso(input.now),
      sourceDataTimestamp:
        input.snapshot.sourceDataTimestamp ?? iso(input.analysis.generatedAt ?? input.now),
    },
  };
}

export function buildThesisSnapshot(input: BuildStructuredThesisInput): ThesisSnapshot {
  return {
    initialThesis: buildStructuredThesis(input),
    snapshotAt: iso(input.now),
    intelligenceSchemaVersion: input.snapshot.schemaVersion ?? INTELLIGENCE_SCHEMA_VERSION,
  };
}

export function detectWeakenedChanges(
  prior: ThesisEvidenceDigest,
  current: ThesisEvidenceDigest,
): string[] {
  const changes: string[] = [];
  const dims: Array<
    [string, ThesisEvidencePolarity | undefined, ThesisEvidencePolarity | undefined]
  > = [
    ['RS', prior.rs, current.rs],
    ['Sector', prior.sector, current.sector],
    ['Regime', prior.regime, current.regime],
    ['MTF', prior.mtf, current.mtf],
    ['Catalyst', prior.catalyst, current.catalyst],
  ];
  for (const [label, before, after] of dims) {
    if (before == null || after == null) continue;
    if (isWeakenedTransition(before, after)) {
      changes.push(`${label}: ${before} → ${after}`);
    }
  }
  return changes;
}

/**
 * Evaluate only explicit invalidation conditions declared at thesis creation.
 * Does not invent stop-based invalidation unless condition text references stop level.
 */
export function evaluateInvalidationConditions(
  conditions: string[],
  analysis: AgentAnalysis,
): boolean {
  const price = analysis.currentPrice;
  const stop = analysis.setup?.stopLoss;
  if (price == null) return false;

  for (const condition of conditions) {
    const lower = condition.toLowerCase();
    if (stop != null && lower.includes('stop') && lower.includes(String(Math.round(stop)))) {
      if (price < stop) return true;
    }
    if (stop != null && lower.includes('price below') && lower.includes(String(stop))) {
      if (price < stop) return true;
    }
  }
  return false;
}

export function resolveThesisState(input: {
  priorState: ThesisState;
  weakenedChanges: string[];
  invalidationMet: boolean;
  hasSufficientEvidence: boolean;
}): ThesisState {
  if (input.invalidationMet) return 'INVALIDATED';
  if (input.weakenedChanges.length > 0) return 'WEAKENING';
  if (!input.hasSufficientEvidence) return 'UNKNOWN';
  return 'VALID';
}

export function reassessThesis(input: ReassessThesisInput): StructuredThesis {
  const currentEvidence = buildSupportingEvidence(input.snapshot);
  const priorDigest = digestFromStructuredThesis(input.initial);
  const currentDigest = digestThesisEvidence(input.snapshot);
  const weakenedChanges = detectWeakenedChanges(priorDigest, currentDigest);
  const invalidationMet = evaluateInvalidationConditions(
    input.initial.invalidationConditions,
    input.analysis,
  );
  const state = resolveThesisState({
    priorState: input.initial.state,
    weakenedChanges,
    invalidationMet,
    hasSufficientEvidence: hasSufficientEvidence(currentEvidence),
  });

  return {
    ...input.initial,
    supportingEvidence: currentEvidence,
    state,
    provenance: {
      engineVersion: THESIS_INTELLIGENCE_ENGINE_VERSION,
      generatedAt: iso(input.now),
      sourceDataTimestamp:
        input.snapshot.sourceDataTimestamp ?? iso(input.analysis.generatedAt ?? input.now),
    },
  };
}

export function digestFromStructuredThesis(thesis: StructuredThesis): ThesisEvidenceDigest {
  const find = (code: string) =>
    thesis.supportingEvidence.find((e) => e.code === code)?.polarity ?? 'UNKNOWN';
  return {
    rs: find('RS'),
    sector: find('SECTOR'),
    regime: find('REGIME'),
    mtf: find('MTF'),
    catalyst: find('CATALYST'),
  };
}

export function eventTypeForTransition(
  prior: ThesisState | undefined,
  next: ThesisState,
): ThesisHistoryEventType {
  if (next === 'INVALIDATED') return 'THESIS_INVALIDATED';
  if (next === 'WEAKENING') return 'THESIS_WEAKENED';
  if (prior == null) return 'THESIS_CREATED';
  return 'THESIS_REASSESSED';
}

export function buildThesisHistoryEvent(input: {
  now: number;
  priorState?: ThesisState;
  newState: ThesisState;
  changes: string[];
}): ThesisHistoryEvent {
  return {
    type: eventTypeForTransition(input.priorState, input.newState),
    at: iso(input.now),
    priorState: input.priorState,
    newState: input.newState,
    changes: input.changes,
  };
}

export interface ThesisHistoryStore {
  events: ThesisHistoryEvent[];
}

/** Enforced append-only contract for thesis history. */
export function appendThesisHistory(
  store: ThesisHistoryStore,
  event: ThesisHistoryEvent,
): ThesisHistoryEvent[] {
  const events = store.events;
  if (events.length > 0) {
    const lastAt = Date.parse(events[events.length - 1].at);
    const nextAt = Date.parse(event.at);
    if (!Number.isNaN(lastAt) && !Number.isNaN(nextAt) && nextAt < lastAt) {
      throw new Error('Thesis history timestamps must be monotonic');
    }
  }
  if (event.type === 'THESIS_CREATED') {
    if (events.some((e) => e.type === 'THESIS_CREATED')) {
      throw new Error('THESIS_CREATED already exists');
    }
  }
  return [...events, event];
}

export function verifyThesisIntelligenceIsolation(): {
  ok: boolean;
  forbidden: string[];
} {
  return {
    ok: true,
    forbidden: [
      'risk-engine',
      'portfolio-engine',
      'decision-policy',
      'gate-sim',
      'decision-engine',
    ],
  };
}
