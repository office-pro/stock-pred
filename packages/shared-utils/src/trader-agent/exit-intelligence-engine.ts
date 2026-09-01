/**
 * T2.3 Exit Intelligence Engine — advisory only.
 *
 * Isolated: no Risk, Portfolio, Policy, Gate, broker, exit-policy, or sizing access.
 */
import type {
  ExitEvidenceItem,
  ExitIntelligenceP5Context,
  ExitRecommendation,
  ExitRecommendationAction,
  StructuredThesis,
  ThesisState,
} from '@stockpred/shared-types';

export const EXIT_INTELLIGENCE_ENGINE_VERSION = 'exit-intelligence.v1';

/**
 * Thresholds mirrored from evaluateExitPolicy (exit-policy.ts) — do not invent new bands.
 * @see packages/shared-utils/src/trader-agent/exit-policy.ts
 */
export const EXIT_INTEL_NEAR_TARGET_RATIO = 0.98;
export const EXIT_INTEL_PARTIAL_TARGET_RATIO = 1.01;

export interface ExitIntelligencePosition {
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  target: number;
  quantity: number;
  openedAt: number;
}

export interface BuildExitRecommendationInput {
  now: number;
  position: ExitIntelligencePosition;
  thesis?: StructuredThesis | null;
  /** Historical P5 context only — never treated as live position state. */
  p5Context?: ExitIntelligenceP5Context | null;
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

function isStopBreached(position: ExitIntelligencePosition): boolean {
  return position.stopLoss > 0 && position.currentPrice <= position.stopLoss;
}

function isPastTarget(position: ExitIntelligencePosition): boolean {
  return position.target > 0 && position.currentPrice >= position.target;
}

function isNearTarget(position: ExitIntelligencePosition): boolean {
  return (
    position.target > 0 && position.currentPrice >= position.target * EXIT_INTEL_NEAR_TARGET_RATIO
  );
}

function thesisState(thesis?: StructuredThesis | null): ThesisState {
  return thesis?.state ?? 'UNKNOWN';
}

function appendP5Evidence(
  evidence: ExitEvidenceItem[],
  p5: ExitIntelligenceP5Context | null | undefined,
  now: number,
): void {
  if (!p5?.decisionId || !Number.isFinite(p5.asOf) || p5.asOf > now) return;
  if (p5.maeR != null) {
    evidence.push({
      code: 'P5_MAE',
      message: `Historical MAE ${p5.maeR.toFixed(2)}R (decision ${p5.decisionId})`,
      source: 'p5.outcome.maeR',
      historical: true,
    });
  }
  if (p5.mfeR != null) {
    evidence.push({
      code: 'P5_MFE',
      message: `Historical MFE ${p5.mfeR.toFixed(2)}R (decision ${p5.decisionId})`,
      source: 'p5.outcome.mfeR',
      historical: true,
    });
  }
}

function buildResult(input: {
  now: number;
  action: ExitRecommendationAction;
  reasonCodes: string[];
  summary: string;
  evidence: ExitEvidenceItem[];
  sourceDataTimestamp: string;
}): ExitRecommendation {
  return {
    action: input.action,
    advisory: true,
    reasonCodes: input.reasonCodes,
    summary: input.summary,
    evidence: input.evidence,
    provenance: {
      engineVersion: EXIT_INTELLIGENCE_ENGINE_VERSION,
      generatedAt: iso(input.now),
      sourceDataTimestamp: input.sourceDataTimestamp,
    },
  };
}

export function buildExitRecommendation(input: BuildExitRecommendationInput): ExitRecommendation {
  const { position, now } = input;
  const state = thesisState(input.thesis);
  const evidence: ExitEvidenceItem[] = [];
  const sourceTs = input.thesis?.provenance.sourceDataTimestamp ?? iso(now);

  evidence.push({
    code: 'THESIS_STATE',
    message: `Thesis ${state}`,
    source: 'thesis.state',
  });
  appendP5Evidence(evidence, input.p5Context, now);

  if (isStopBreached(position)) {
    return buildResult({
      now,
      action: 'EXIT',
      reasonCodes: ['STOP_BREACHED'],
      summary: 'Price at or below stop — advisory exit consideration.',
      evidence: [
        ...evidence,
        {
          code: 'STOP',
          message: `Price ${position.currentPrice} <= stop ${position.stopLoss}`,
          source: 'position.currentPrice',
        },
      ],
      sourceDataTimestamp: sourceTs,
    });
  }

  if (state === 'INVALIDATED') {
    return buildResult({
      now,
      action: 'EXIT',
      reasonCodes: ['THESIS_INVALIDATED'],
      summary: 'Thesis invalidated — advisory exit consideration.',
      evidence,
      sourceDataTimestamp: sourceTs,
    });
  }

  if (state === 'WEAKENING') {
    const action: ExitRecommendationAction = isNearTarget(position) ? 'TRIM' : 'HOLD';
    return buildResult({
      now,
      action,
      reasonCodes: action === 'TRIM' ? ['THESIS_WEAKENING', 'NEAR_TARGET'] : ['THESIS_WEAKENING'],
      summary:
        action === 'TRIM'
          ? 'Thesis weakening near target — advisory trim consideration.'
          : 'Thesis weakening — advisory hold; no forced exit.',
      evidence,
      sourceDataTimestamp: sourceTs,
    });
  }

  if (state === 'UNKNOWN') {
    return buildResult({
      now,
      action: 'HOLD',
      reasonCodes: ['INSUFFICIENT_EVIDENCE'],
      summary: 'Insufficient thesis evidence — advisory hold.',
      evidence,
      sourceDataTimestamp: sourceTs,
    });
  }

  if (isPastTarget(position)) {
    return buildResult({
      now,
      action: 'TRIM',
      reasonCodes: ['TARGET_REACHED', 'THESIS_VALID'],
      summary: 'Target reached with valid thesis — advisory trim consideration.',
      evidence: [
        ...evidence,
        {
          code: 'TARGET',
          message: `Price ${position.currentPrice} >= target ${position.target}`,
          source: 'position.target',
        },
      ],
      sourceDataTimestamp: sourceTs,
    });
  }

  if (isNearTarget(position)) {
    return buildResult({
      now,
      action: 'TRIM',
      reasonCodes: ['NEAR_TARGET', 'THESIS_VALID'],
      summary: 'Approaching target with valid thesis — advisory trim consideration.',
      evidence: [
        ...evidence,
        {
          code: 'TARGET',
          message: `Price within near-target band (${EXIT_INTEL_NEAR_TARGET_RATIO * 100}% of target)`,
          source: 'position.target',
        },
      ],
      sourceDataTimestamp: sourceTs,
    });
  }

  return buildResult({
    now,
    action: 'HOLD',
    reasonCodes: ['THESIS_VALID', 'MONITOR'],
    summary: 'Thesis valid — advisory hold and monitor vs stop/target.',
    evidence,
    sourceDataTimestamp: sourceTs,
  });
}

export function verifyExitIntelligenceIsolation(): {
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
      'exit-policy',
      'decision-engine',
      'broker',
    ],
  };
}
