import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export type P5EvidenceOverall = 'GO' | 'NO-GO' | 'INCONCLUSIVE' | 'UNKNOWN';

export interface P5EvidenceUnlockStatus {
  unlocked: boolean;
  overallDecision: P5EvidenceOverall;
  path: string;
  exists: boolean;
  generatedAt?: string;
  reasonCode?: 'P5_EVIDENCE_GATE_NOT_PASSED';
  reason: string;
}

function defaultEvidencePath(): string {
  const fromEnv = process.env.P5_EVIDENCE_REVIEW_PATH;
  if (fromEnv) return resolve(fromEnv);
  // packages/shared-utils → repo apps/trader-agent/data when running from monorepo build
  return resolve(__dirname, '../../../../apps/trader-agent/data/p5-evidence-review-latest.json');
}

function normalizeOverall(raw: string | undefined): P5EvidenceOverall {
  if (raw === 'GO') return 'GO';
  if (raw === 'NO-GO') return 'NO-GO';
  if (raw === 'INCONCLUSIVE') return 'INCONCLUSIVE';
  return 'UNKNOWN';
}

/**
 * Read-only P5 evidence unlock check.
 * GO makes ARM *available*; it never arms autonomy by itself.
 * INCONCLUSIVE and NO-GO never unlock ARM.
 */
export function readP5EvidenceUnlock(path = defaultEvidencePath()): P5EvidenceUnlockStatus {
  if (!existsSync(path)) {
    return {
      unlocked: false,
      overallDecision: 'UNKNOWN',
      path,
      exists: false,
      reasonCode: 'P5_EVIDENCE_GATE_NOT_PASSED',
      reason: 'P5 evidence review artifact missing — LIVE autonomous ARM blocked',
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      overallDecision?: string;
      generatedAt?: string;
    };
    const overall = normalizeOverall(raw.overallDecision);
    if (overall === 'GO') {
      return {
        unlocked: true,
        overallDecision: 'GO',
        path,
        exists: true,
        generatedAt: raw.generatedAt,
        reason: 'P5 evidence OVERALL GO — ARM LIVE AUTONOMOUS may be requested by a human',
      };
    }
    return {
      unlocked: false,
      overallDecision: overall,
      path,
      exists: true,
      generatedAt: raw.generatedAt,
      reasonCode: 'P5_EVIDENCE_GATE_NOT_PASSED',
      reason: `P5 evidence OVERALL=${overall} — LIVE autonomous ARM blocked`,
    };
  } catch {
    return {
      unlocked: false,
      overallDecision: 'UNKNOWN',
      path,
      exists: true,
      reasonCode: 'P5_EVIDENCE_GATE_NOT_PASSED',
      reason: 'P5 evidence review artifact unreadable — LIVE autonomous ARM blocked',
    };
  }
}

/** Effective LIVE auto latch: operator armed AND evidence unlock. */
export function isLiveAutoEffectivelyArmed(operatorArmed: boolean, path?: string): boolean {
  if (!operatorArmed) return false;
  return readP5EvidenceUnlock(path).unlocked;
}
