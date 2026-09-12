import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { applyDecisionPolicy } from './decision-policy';
import { isLiveAutoEffectivelyArmed, readP5EvidenceUnlock } from './p5-evidence-unlock';

const okRisk = {
  allowed: true as const,
  riskScore: 1,
  quantity: 10,
  riskAmount: 500,
  stopLoss: 95,
  maxLoss: 500,
  riskReward: 2,
  reasonCodes: [] as [],
  reasons: [] as string[],
};

const okPortfolio = {
  allowed: true as const,
  openPositions: 0,
  cash: 100_000,
  requiredCapital: 1_000,
  nameExposurePct: 5,
  sectorExposurePct: 10 as number | null,
  reasonCodes: [] as [],
  reasons: [] as string[],
};

describe('Phase 6 — DecisionPolicy LIVE autonomous latch', () => {
  it('LIVE + AUTONOMOUS + unarmed → HUMAN_REQUIRED', () => {
    const live = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
      liveAutoArmed: false,
    });
    expect(live.outcome).toBe('HUMAN_REQUIRED');
    expect(live.reasonCodes).toContain('LIVE_AUTONOMOUS_NOT_ARMED');
  });

  it('LIVE + AUTONOMOUS + effectively armed → AUTO_ACCEPTED', () => {
    const live = applyDecisionPolicy({
      operatingMode: 'LIVE',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
      liveAutoArmed: true,
    });
    expect(live.outcome).toBe('AUTO_ACCEPTED');
    expect(live.reasonCodes).toContain('LIVE_AUTONOMOUS_ARMED');
  });

  it('PAPER + AUTONOMOUS ignores liveAutoArmed and stays AUTO_ACCEPTED', () => {
    const paper = applyDecisionPolicy({
      operatingMode: 'PAPER',
      decisionMode: 'AUTONOMOUS',
      eligibility: 'AUTONOMOUS_ELIGIBLE',
      risk: okRisk,
      portfolio: okPortfolio,
      liveAutoArmed: false,
    });
    expect(paper.outcome).toBe('AUTO_ACCEPTED');
  });
});

describe('Phase 6 — P5 evidence activation guard', () => {
  function writeReview(overallDecision: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'p5-ev-'));
    const path = join(dir, 'p5-evidence-review-latest.json');
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 'p5-evidence-review.v1',
        overallDecision,
        generatedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    return path;
  }

  it('NO-GO → unlock false; ARM latch stays ineffective', () => {
    const path = writeReview('NO-GO');
    const status = readP5EvidenceUnlock(path);
    expect(status.unlocked).toBe(false);
    expect(status.reasonCode).toBe('P5_EVIDENCE_GATE_NOT_PASSED');
    expect(isLiveAutoEffectivelyArmed(true, path)).toBe(false);
    expect(isLiveAutoEffectivelyArmed(false, path)).toBe(false);
  });

  it('GO + operator armed → effective; GO alone does not arm', () => {
    const path = writeReview('GO');
    const status = readP5EvidenceUnlock(path);
    expect(status.unlocked).toBe(true);
    expect(isLiveAutoEffectivelyArmed(false, path)).toBe(false);
    expect(isLiveAutoEffectivelyArmed(true, path)).toBe(true);
  });
});
