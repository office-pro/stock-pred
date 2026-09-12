import type {
  DecisionLedgerEntry,
  DecisionLedgerRecord,
  DecisionOutcomeRecord,
} from '@stockpred/shared-types';
import { runP7CalibrationBreaker } from './p7-calibration-breaker';

const BASE_TS = 1_700_000_000_000;
const NOW = BASE_TS + 60_000;

function row(id: string, p: number, netR: number, soak = false): DecisionLedgerRecord[] {
  const d = {
    decisionId: id,
    soakRunId: soak ? 'SOAK-1' : undefined,
    intelligenceSnapshot: {
      expectedValue: { probabilityTarget: p, probabilitySource: 'RAW_MODEL' },
    } as DecisionLedgerEntry['intelligenceSnapshot'],
  };
  return [
    {
      timestamp: BASE_TS,
      symbol: 'INFY',
      direction: 'BUY' as const,
      operatingMode: 'PAPER' as const,
      decisionMode: 'AUTONOMOUS' as const,
      state: 'EXECUTED' as const,
      analysisSnapshot: {
        score: 82,
        confidence: 70,
        scores: {
          fundamental: null,
          technical: 82,
          sentiment: null,
          quant: null,
          macro: null,
          sector: null,
          risk: null,
          overall: 82,
        },
        regime: 'RISK_ON',
        thesis: 't',
        strategy: 'B',
        eligibility: 'AUTONOMOUS_ELIGIBLE' as const,
      },
      riskVerdict: {
        allowed: true,
        riskScore: 1,
        quantity: 5,
        riskAmount: 250,
        stopLoss: 1400,
        maxLoss: 250,
        riskReward: 2,
        reasonCodes: [],
        reasons: [],
      },
      portfolioVerdict: {
        allowed: true,
        openPositions: 0,
        cash: 1e6,
        requiredCapital: 20_000,
        nameExposurePct: 2,
        sectorExposurePct: null,
        reasonCodes: [],
        reasons: [],
      },
      decision: 'AUTO_ACCEPT' as const,
      reasonCodes: [],
      decisionReasons: [],
      ...d,
    },
    {
      kind: 'OUTCOME_RECORDED' as const,
      outcomeId: `o-${id}`,
      decisionId: id,
      timestamp: BASE_TS,
      exitPrice: 1,
      pnl: netR * 100,
      pnlPercent: 1,
      holdingPeriodMs: 1,
      exitReason: 'T',
      closedAt: soak ? BASE_TS - 86_400_000 : BASE_TS - 100,
      realizedR: netR,
      netR,
      outcomeKind: 'ACTUAL' as const,
      soakRunId: soak ? 'SOAK-1' : undefined,
    } satisfies DecisionOutcomeRecord,
  ];
}

describe('p7-calibration-breaker (P7.3)', () => {
  it('returns INSUFFICIENT without probabilityTarget', () => {
    const records = row('a', 0.6, 1).map((r) =>
      'decisionId' in r && r.decisionId === 'a' ? { ...r, intelligenceSnapshot: undefined } : r,
    ) as DecisionLedgerRecord[];
    const result = runP7CalibrationBreaker({ records, now: NOW });
    expect(result.subState).toBe('INSUFFICIENT');
  });

  it('returns CLEAR with stable calibration across hist/live', () => {
    const records: DecisionLedgerRecord[] = [];
    for (let i = 0; i < 12; i++) records.push(...row(`hs${i}`, [0.4, 0.55, 0.7][i % 3]!, 1, true));
    for (let i = 0; i < 12; i++) records.push(...row(`lv${i}`, [0.4, 0.55, 0.7][i % 3]!, 1, false));
    const result = runP7CalibrationBreaker({
      records,
      now: NOW,
      floors: { minCalibrationBuckets: 3 },
    });
    expect(result.subState).toBe('CLEAR');
  });

  it('never uses confidence as probability', () => {
    const records = row('c1', 0.6, 1);
    const entry = records[0] as DecisionLedgerEntry;
    entry.analysisSnapshot.confidence = 82;
    entry.intelligenceSnapshot = undefined;
    const result = runP7CalibrationBreaker({ records, now: NOW });
    expect(result.subState).toBe('INSUFFICIENT');
  });
});
