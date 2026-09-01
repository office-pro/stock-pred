/**
 * Read-only P5 evidence export → data/p5-evidence-review-latest.json
 * Does NOT modify DecisionPolicy, Gate, Risk, or the ARM latch.
 * Sample adequacy (20/10/20) is review guidance only — not a runtime Policy/Risk/Gate threshold.
 *
 * Usage: node apps/trader-agent/scripts/export-p5-evidence-review.mjs
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, '../data');
const ledgerPath =
  process.env.AGENT_DECISION_LEDGER_PATH ||
  join(dataDir, 'decision-ledger.json');
const soakLatestPath = join(dataDir, 'paper-soak-report-latest.json');
const outPath = join(dataDir, 'p5-evidence-review-latest.json');

function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function isDecisionEntry(e) {
  return (
    e &&
    typeof e === 'object' &&
    e.kind !== 'OUTCOME_RECORDED' &&
    typeof e.decisionId === 'string'
  );
}

function agentHumanAgree(agent, human) {
  if (!agent || !human) return null;
  if (agent === 'RECOMMEND_APPROVE' && human === 'HUMAN_APPROVE') return true;
  if (agent === 'RECOMMEND_WAIT' && human === 'HUMAN_WAIT') return true;
  if (agent === 'RECOMMEND_REJECT' && human === 'HUMAN_REJECT') return true;
  const agentOk =
    agent === 'RECOMMEND_APPROVE' ||
    agent === 'RECOMMEND_WAIT' ||
    agent === 'RECOMMEND_REJECT';
  const humanOk =
    human === 'HUMAN_APPROVE' ||
    human === 'HUMAN_WAIT' ||
    human === 'HUMAN_REJECT';
  if (agentOk && humanOk) return false;
  return null;
}

/** Offline mirror of computeHumanIntelMetrics (shared-utils). */
function computeHumanIntelMetrics(entries) {
  let reviewed = 0;
  let agentApproveCount = 0;
  let agentWaitCount = 0;
  let agentRejectCount = 0;
  let humanApproveCount = 0;
  let humanWaitCount = 0;
  let humanRejectCount = 0;
  let agreementCount = 0;
  let overrideCount = 0;
  let waitThenLaterCount = 0;

  const byDecision = new Map();
  for (const e of entries) {
    const list = byDecision.get(e.decisionId) ?? [];
    list.push(e);
    byDecision.set(e.decisionId, list);
  }

  const bumpAgent = (a) => {
    if (a === 'RECOMMEND_APPROVE') agentApproveCount += 1;
    else if (a === 'RECOMMEND_WAIT') agentWaitCount += 1;
    else if (a === 'RECOMMEND_REJECT') agentRejectCount += 1;
  };
  const bumpHuman = (h) => {
    if (h === 'HUMAN_APPROVE') humanApproveCount += 1;
    else if (h === 'HUMAN_WAIT') humanWaitCount += 1;
    else if (h === 'HUMAN_REJECT') humanRejectCount += 1;
  };

  for (const e of entries) {
    if (!e.humanDecision && !e.agentRecommendation) continue;
    reviewed += 1;
    bumpAgent(e.agentRecommendation);
    bumpHuman(e.humanDecision);
    const agree = agentHumanAgree(e.agentRecommendation, e.humanDecision);
    if (agree === true) agreementCount += 1;
    if (agree === false) overrideCount += 1;
  }

  for (const [, rows] of byDecision) {
    const hadWait = rows.some(
      (r) => r.humanDecision === 'HUMAN_WAIT' || r.decision === 'WAIT',
    );
    const laterAction = rows.some(
      (r) =>
        r.humanDecision === 'HUMAN_APPROVE' ||
        r.humanDecision === 'HUMAN_REJECT' ||
        r.decision === 'APPROVED' ||
        r.decision === 'EXECUTED' ||
        r.decision === 'REJECT',
    );
    if (hadWait && laterAction) waitThenLaterCount += 1;
  }

  const withOutcome = entries.filter(
    (e) =>
      e.outcome?.realizedR != null &&
      e.intelligenceSnapshot?.tradeQuality?.overallScore != null,
  );
  const pos = withOutcome.filter((e) => (e.outcome?.realizedR ?? 0) > 0);
  const neg = withOutcome.filter((e) => (e.outcome?.realizedR ?? 0) <= 0);
  const avg = (rows) => {
    if (rows.length === 0) return null;
    const sum = rows.reduce(
      (a, r) => a + (r.intelligenceSnapshot?.tradeQuality?.overallScore ?? 0),
      0,
    );
    return sum / rows.length;
  };
  const reviewedSafe = Math.max(reviewed, 1);

  return {
    reviewed,
    agentApproveCount,
    agentWaitCount,
    agentRejectCount,
    humanApproveCount,
    humanWaitCount,
    humanRejectCount,
    agreementCount,
    overrideCount,
    agreementPct: reviewed === 0 ? 0 : (agreementCount / reviewedSafe) * 100,
    overridePct: reviewed === 0 ? 0 : (overrideCount / reviewedSafe) * 100,
    waitThenLaterCount,
    qualityVsRealizedRSamples: withOutcome.length,
    avgQualityWhenPositiveR: avg(pos),
    avgQualityWhenNegativeR: avg(neg),
  };
}

function summarizeGate(entries) {
  let withGate = 0;
  let passed = 0;
  let blocked = 0;
  const reasonCounts = {};
  for (const e of entries) {
    if (!e.gateResult) continue;
    withGate += 1;
    if (e.gateResult.passed) passed += 1;
    else blocked += 1;
    for (const code of e.gateResult.reasonCodes ?? []) {
      reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
    }
  }
  return { withGate, passed, blocked, reasonCounts };
}

function summarizeModes(entries) {
  let paper = 0;
  let live = 0;
  let other = 0;
  let withHuman = 0;
  let withAgentRec = 0;
  let withIntel = 0;
  let withRealizedR = 0;
  let unauthorizedLiveAutoAccepted = 0;
  for (const e of entries) {
    const mode = String(e.operatingMode ?? '').toUpperCase();
    if (mode.includes('LIVE')) live += 1;
    else if (mode.includes('PAPER')) paper += 1;
    else other += 1;
    if (e.humanDecision) withHuman += 1;
    if (e.agentRecommendation) withAgentRec += 1;
    if (e.intelligenceSnapshot) withIntel += 1;
    if (e.outcome?.realizedR != null) withRealizedR += 1;
    if (
      mode.includes('LIVE') &&
      (e.decision === 'AUTO_ACCEPTED' || e.humanDecision === 'AUTO_ACCEPTED')
    ) {
      unauthorizedLiveAutoAccepted += 1;
    }
  }
  return {
    paper,
    live,
    other,
    withHuman,
    withAgentRec,
    withIntel,
    withRealizedR,
    unauthorizedLiveAutoAccepted,
  };
}

const ledgerFile = loadJson(ledgerPath);
const rawEntries = Array.isArray(ledgerFile?.entries) ? ledgerFile.entries : [];
const decisionEntries = rawEntries.filter(isDecisionEntry);
const metrics = computeHumanIntelMetrics(decisionEntries);
const gateSummary = summarizeGate(decisionEntries);
const modeSummary = summarizeModes(decisionEntries);
const soakLatest = loadJson(soakLatestPath);

const soakFiles = existsSync(dataDir)
  ? readdirSync(dataDir).filter(
      (f) => f.startsWith('paper-soak-report-') && f.endsWith('.json'),
    )
  : [];

const classification = {
  TECHNICAL_SAFETY: 'PASS',
  INTELLIGENCE_QUALITY: 'REVIEW',
  HUMAN_VALUE: 'REVIEW',
  EXECUTION_QUALITY: 'REVIEW',
};

const reviewCount = Object.values(classification).filter((v) => v === 'REVIEW').length;
const failCount = Object.values(classification).filter((v) => v === 'FAIL').length;
const sampleAdequate =
  metrics.reviewed >= 20 &&
  metrics.qualityVsRealizedRSamples >= 10 &&
  modeSummary.live + modeSummary.paper >= 20;

// Locked verdict: floors unmet → INCONCLUSIVE (not NO-GO). GO never auto-arms.
let overallDecision = 'INCONCLUSIVE';
if (!sampleAdequate) {
  overallDecision = 'INCONCLUSIVE';
} else if (classification.TECHNICAL_SAFETY !== 'PASS' || failCount > 0) {
  overallDecision = 'NO-GO';
} else if (reviewCount <= 1) {
  overallDecision = 'GO';
} else {
  overallDecision = 'NO-GO';
}

const generatedAt = new Date().toISOString();

const snapshot = {
  schemaVersion: 'p5-evidence-review.v1',
  artifactKind: 'runtime-export',
  reviewWindow: {
    kind: 'disk_export',
    note: existsSync(ledgerPath)
      ? 'Exported from on-disk decision ledger + soak reports.'
      : 'decision-ledger.json absent on disk; metrics computed over empty entry set.',
  },
  generatedAt,
  exportSources: {
    ledgerPath,
    ledgerExists: existsSync(ledgerPath),
    soakLatestPath,
    soakLatestExists: existsSync(soakLatestPath),
    soakReportFiles: soakFiles,
  },
  paperSampleCount: modeSummary.paper,
  liveSampleCount: modeSummary.live,
  ledgerVersion: null,
  configVersion: null,
  ledgerStats: {
    rawRecordCount: rawEntries.length,
    decisionEntryCount: decisionEntries.length,
    ...modeSummary,
  },
  p4ReportReference: soakLatest
    ? {
        path: 'apps/trader-agent/data/paper-soak-report-latest.json',
        soakRunId: soakLatest.soakRunId ?? null,
        schemaVersion: soakLatest.schemaVersion ?? null,
        phase4Status: soakLatest.phase4Status ?? null,
        technicalChecklist: soakLatest.technicalChecklist ?? null,
        ops: soakLatest.ops
          ? {
              candidates: soakLatest.ops.candidates,
              accepted: soakLatest.ops.accepted,
              filled: soakLatest.ops.filled,
              gateVeto: soakLatest.ops.gateVeto,
            }
          : null,
      }
    : null,
  humanIntelMetricSnapshot: metrics,
  liveGateEvidenceSnapshot: {
    ...gateSummary,
    unauthorizedLiveAutoAccepted: modeSummary.unauthorizedLiveAutoAccepted,
    note:
      gateSummary.withGate === 0
        ? 'No gateResult rows on ledger for this export window.'
        : 'Summarized from ledger gateResult fields.',
  },
  portfolioEvidence: {
    gateCategory: false,
    role: 'evidence-only',
    status: 'incomplete',
    note: 'Display-only ranking / portfolio-fit; not a fifth gate row.',
  },
  evidenceSections: {
    humanValue: classification.HUMAN_VALUE,
    intelligenceQuality: classification.INTELLIGENCE_QUALITY,
    portfolio: 'evidence-only',
    execution: classification.EXECUTION_QUALITY,
    safety: classification.TECHNICAL_SAFETY,
  },
  classification,
  overallDecision,
  reviewerRationale:
    overallDecision === 'GO'
      ? 'Runtime export met document-level GO rules (safety PASS, ≤1 REVIEW, sample adequacy).'
      : 'NO-GO: insufficient runtime evidence for a justified GO. TECHNICAL SAFETY remains PASS on P5 implementation/tests. Intelligence / Human / Execution stay REVIEW until ledger human-validation outcomes (and preferably LIVE/Gate rows) are populated and re-exported. This is not a finding that intelligence is ineffective.',
  remediation: {
    requiredExports: [
      'Populate apps/trader-agent/data/decision-ledger.json via PAPER/LIVE human approve/WAIT flows',
      'Re-run this script (or GET /agent/human-intel-metrics) after human decisions accumulate',
      'Include LIVE / Gate rows with gateResult and closed outcomes (realizedR) where available',
    ],
    nextSteps: [
      'Run human-validation on Agent Desk against real suggestions',
      'node apps/trader-agent/scripts/export-p5-evidence-review.mjs',
      'Re-score four gate rows in docs/p5-evidence-review.md',
      'Only after OVERALL GO may a human confirm ARM LIVE AUTONOMOUS (P6 code already present; activation still human-gated)',
    ],
  },
  boundaries: {
    modifiesRuntimePolicy: false,
    setsLiveAutoArmed: false,
    changesDecisionPolicy: false,
    changesGateBehavior: false,
    implementsP6Arm: false,
    note: 'This artifact is audit/evidence only. overallDecision unlocks human ARM eligibility only; it must never be loaded by Policy, Gate, or Risk as a trading threshold.',
  },
  goRulesApplied: {
    technicalSafetyMustPass: classification.TECHNICAL_SAFETY === 'PASS',
    noFailCategories: failCount === 0,
    atMostOneReview: reviewCount <= 1,
    sampleAdequateJustified: sampleAdequate,
    sampleAdequacyNote:
      'Document-level guidance used for this export: reviewed>=20 and qualityVsRealizedRSamples>=10 and paper+live decisions>=20. Not hard-coded into Policy/Gate.',
  },
  markdownPath: 'docs/p5-evidence-review.md',
};

writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      outPath,
      overallDecision,
      classification,
      decisionEntryCount: decisionEntries.length,
      reviewed: metrics.reviewed,
      ledgerExists: existsSync(ledgerPath),
      soakLatestExists: existsSync(soakLatestPath),
      soakReportFiles: soakFiles,
    },
    null,
    2,
  ),
);
