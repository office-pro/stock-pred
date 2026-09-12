import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SoakStore } from './soak-store';

describe('SoakStore FSM (P4)', () => {
  let dir: string;
  let store: SoakStore;

  const baseline = {
    equity: 1_000_000,
    cash: 900_000,
    openPositions: 0,
    dayStartEquity: 1_000_000,
    weekStartEquity: 1_000_000,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'soak-'));
    store = new SoakStore(join(dir, 'soak.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts RUNNING and rejects a second start while RUNNING', () => {
    const run = store.start({
      baseline,
      decisionMode: 'AUTONOMOUS',
      operatingMode: 'PAPER',
      riskBudgets: { perTradeRiskPercent: 1 },
      targetDurationMs: 60_000,
    });
    expect(run.state).toBe('RUNNING');
    expect(store.getActiveRunId()).toBe(run.soakRunId);
    expect(() =>
      store.start({
        baseline,
        decisionMode: 'AUTONOMOUS',
        operatingMode: 'PAPER',
        riskBudgets: {},
      }),
    ).toThrow(/already RUNNING/i);
  });

  it('rejects finish when not RUNNING', () => {
    expect(() => store.finish('PASSED')).toThrow(/No RUNNING/i);
  });

  it('does not allow KILLED → RUNNING without a new start()', () => {
    store.start({
      baseline,
      decisionMode: 'AUTONOMOUS',
      operatingMode: 'PAPER',
      riskBudgets: {},
      targetDurationMs: 60_000,
    });
    const killed = store.finish('KILLED', {
      killClass: 'RISK',
      killCode: 'SOAK_DAILY_DD',
      killReason: 'test',
    });
    expect(killed.state).toBe('KILLED');
    expect(store.getActiveRunId()).toBeUndefined();
    const next = store.start({
      baseline,
      decisionMode: 'APPROVAL',
      operatingMode: 'PAPER',
      riskBudgets: {},
    });
    expect(next.state).toBe('RUNNING');
    expect(next.soakRunId).not.toBe(killed.soakRunId);
  });
});
