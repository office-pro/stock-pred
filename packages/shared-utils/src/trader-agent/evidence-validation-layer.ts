/**
 * Evidence Validation Layer — aggregate engine evidence into supporting/conflicting/missing.
 * NOT a ranking engine. NOT authorization. No EvidenceScore numeric.
 */
import type {
  EvidenceStance,
  EvidenceValidationResult,
  StructuredEvidenceItem,
} from '@stockpred/shared-types';
import { provenance } from './b9-b17-helpers';

export const EVIDENCE_VALIDATION_VERSION = 'evidence-validation.v1';

export interface EvidenceValidationInput {
  items: StructuredEvidenceItem[];
  now?: Date;
}

function stancePolarity(
  stance: EvidenceStance,
): 'SUPPORTING' | 'CONFLICTING' | 'NEUTRAL' | 'MISSING' {
  if (stance === 'SUPPORTING') return 'SUPPORTING';
  if (stance === 'CONFLICTING') return 'CONFLICTING';
  if (stance === 'MISSING') return 'MISSING';
  return 'NEUTRAL';
}

export function validateEvidencePackage(input: EvidenceValidationInput): EvidenceValidationResult {
  const now = input.now ?? new Date();
  const supporting: StructuredEvidenceItem[] = [];
  const conflicting: StructuredEvidenceItem[] = [];
  const missing: StructuredEvidenceItem[] = [];
  const neutral: StructuredEvidenceItem[] = [];

  for (const item of input.items) {
    if (item.status === 'MISSING' || item.stance === 'MISSING') {
      missing.push({
        ...item,
        stance: 'MISSING',
        status: item.status === 'AVAILABLE' ? 'MISSING' : item.status,
      });
      continue;
    }
    const bucket = stancePolarity(item.stance);
    if (bucket === 'SUPPORTING') supporting.push(item);
    else if (bucket === 'CONFLICTING') conflicting.push(item);
    else if (bucket === 'MISSING') missing.push(item);
    else neutral.push(item);
  }

  const evidenceCount = supporting.length + conflicting.length + neutral.length;
  let evidenceQuality: EvidenceValidationResult['evidenceQuality'] = 'UNKNOWN';
  if (evidenceCount === 0 && missing.length > 0) evidenceQuality = 'INSUFFICIENT';
  else if (supporting.length >= 3 && conflicting.length === 0) evidenceQuality = 'STRONG';
  else if (supporting.length > 0 && conflicting.length > 0) evidenceQuality = 'MIXED';
  else if (supporting.length > 0 && conflicting.length === 0) evidenceQuality = 'WEAK';
  else if (conflicting.length > 0 && supporting.length === 0) evidenceQuality = 'WEAK';
  else evidenceQuality = 'INSUFFICIENT';

  const parts: string[] = [];
  if (supporting.length) parts.push(`${supporting.length} supporting`);
  if (conflicting.length) parts.push(`${conflicting.length} conflicting`);
  if (missing.length) parts.push(`${missing.length} missing`);
  if (neutral.length) parts.push(`${neutral.length} neutral/unknown`);
  const conflictSummary =
    parts.length === 0
      ? 'Insufficient evidence — no forced prediction.'
      : conflicting.length > 0
        ? `Evidence is mixed (${parts.join(', ')}). Conflicts reduce conviction; insufficient or conflicting engines do not authorize execution.`
        : `Evidence leans ${supporting.length ? 'supportive' : 'incomplete'} (${parts.join(', ')}). Advisory only.`;

  return {
    schemaVersion: 'evidence-validation.v1',
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    missingEvidence: missing,
    neutralEvidence: neutral,
    evidenceCount,
    evidenceQuality,
    conflictSummary,
    provenance: provenance(
      'evidence-validation',
      {
        modelVersion: EVIDENCE_VALIDATION_VERSION,
        sampleSize: evidenceCount,
      },
      now,
    ),
  };
}

/** Map common advisory labels into structured evidence (backend-owned values only). */
export function evidenceFromAdvisoryLabels(labels: {
  technical?: string | null;
  sector?: string | null;
  rs?: string | null;
  regime?: string | null;
  mlDirection?: string | null;
  fundamental?: number | null;
  catalyst?: string | null;
  historicalStatus?: string | null;
  historicalSampleSize?: number | null;
  bullRunStage?: string | null;
  bullRunProbability?: number | null;
  integrity?: string | null;
  globalImpact?: string | null;
  fnoStatus?: string | null;
  correlationStatus?: string | null;
}): StructuredEvidenceItem[] {
  const items: StructuredEvidenceItem[] = [];

  const push = (
    engine: string,
    present: boolean,
    stance: EvidenceStance,
    value: string | number | null | undefined,
    source: string,
    extras?: Partial<StructuredEvidenceItem>,
  ) => {
    if (!present) {
      items.push({
        engine,
        status: 'MISSING',
        stance: 'MISSING',
        source,
        interpretation: 'Not available',
      });
      return;
    }
    items.push({
      engine,
      status: 'AVAILABLE',
      stance,
      value: value ?? null,
      interpretation: value != null ? String(value) : undefined,
      source,
      ...extras,
    });
  };

  if (labels.technical != null) {
    const t = String(labels.technical).toUpperCase();
    push(
      'Technical',
      true,
      t.includes('BEAR') || t.includes('WEAK') ? 'CONFLICTING' : 'SUPPORTING',
      labels.technical,
      'technical',
    );
  } else {
    push('Technical', false, 'MISSING', null, 'technical');
  }

  if (labels.sector != null) {
    const s = String(labels.sector).toUpperCase();
    push(
      'Sector',
      true,
      s === 'LEADING' || s === 'IMPROVING' || s === 'HIGH'
        ? 'SUPPORTING'
        : s === 'LAGGING' || s === 'WEAKENING'
          ? 'CONFLICTING'
          : 'NEUTRAL',
      labels.sector,
      'sector',
    );
  } else {
    push('Sector', false, 'MISSING', null, 'sector');
  }

  if (labels.rs != null) {
    push('RS', true, labels.rs === 'LEADERS' ? 'SUPPORTING' : 'NEUTRAL', labels.rs, 'rs');
  } else {
    push('RS', false, 'MISSING', null, 'rs');
  }

  if (labels.regime != null) {
    push('Regime', true, 'NEUTRAL', labels.regime, 'regime');
  } else {
    push('Regime', false, 'MISSING', null, 'regime');
  }

  if (labels.mlDirection != null) {
    const d = String(labels.mlDirection).toUpperCase();
    push(
      'ML',
      true,
      d === 'UP' || d === 'BUY' || d === 'LONG'
        ? 'SUPPORTING'
        : d === 'DOWN' || d === 'SELL'
          ? 'CONFLICTING'
          : 'NEUTRAL',
      labels.mlDirection,
      'ml',
    );
  } else {
    push('ML', false, 'MISSING', null, 'ml');
  }

  if (labels.fundamental != null && Number.isFinite(labels.fundamental)) {
    push(
      'Fundamental',
      true,
      labels.fundamental >= 50 ? 'SUPPORTING' : labels.fundamental < 40 ? 'CONFLICTING' : 'NEUTRAL',
      labels.fundamental,
      'fundamental',
    );
  } else {
    push('Fundamental', false, 'MISSING', null, 'fundamental');
  }

  if (labels.catalyst != null) {
    push(
      'Catalyst',
      true,
      labels.catalyst === 'HIGH'
        ? 'CONFLICTING'
        : labels.catalyst === 'LOW'
          ? 'SUPPORTING'
          : 'NEUTRAL',
      labels.catalyst,
      'catalyst',
    );
  } else {
    push('Catalyst', false, 'MISSING', null, 'catalyst');
  }

  if (labels.historicalStatus === 'AVAILABLE') {
    push(
      'Historical',
      true,
      'SUPPORTING',
      `sampleSize=${labels.historicalSampleSize ?? 'n/a'}`,
      'historical',
      {
        sampleSize: labels.historicalSampleSize ?? null,
      },
    );
  } else {
    push('Historical', false, 'MISSING', null, 'historical', {
      sampleSize: labels.historicalSampleSize ?? null,
    });
  }

  if (labels.bullRunStage != null) {
    const st = String(labels.bullRunStage).toUpperCase();
    push(
      'BullRun',
      true,
      st === 'FAILED' || st === 'WEAKENING' ? 'CONFLICTING' : 'SUPPORTING',
      labels.bullRunProbability != null
        ? `${labels.bullRunStage} p=${labels.bullRunProbability}`
        : labels.bullRunStage,
      'bullRun',
    );
  } else {
    push('BullRun', false, 'MISSING', null, 'bullRun');
  }

  if (labels.integrity != null) {
    push(
      'Integrity',
      true,
      labels.integrity === 'SUSPICIOUS'
        ? 'CONFLICTING'
        : labels.integrity === 'NORMAL'
          ? 'SUPPORTING'
          : 'NEUTRAL',
      labels.integrity,
      'integrity',
    );
  } else {
    push('Integrity', false, 'MISSING', null, 'integrity');
  }

  if (labels.globalImpact != null) {
    push(
      'Global',
      true,
      labels.globalImpact === 'POSITIVE'
        ? 'SUPPORTING'
        : labels.globalImpact === 'NEGATIVE'
          ? 'CONFLICTING'
          : 'NEUTRAL',
      labels.globalImpact,
      'global',
    );
  } else {
    push('Global', false, 'MISSING', null, 'global');
  }

  if (labels.fnoStatus != null) {
    push('FNO', true, 'NEUTRAL', labels.fnoStatus, 'fno');
  } else {
    push('FNO', false, 'MISSING', null, 'fno');
  }

  if (labels.correlationStatus != null) {
    push('Correlation', true, 'NEUTRAL', labels.correlationStatus, 'correlation');
  } else {
    push('Correlation', false, 'MISSING', null, 'correlation');
  }

  return items;
}
