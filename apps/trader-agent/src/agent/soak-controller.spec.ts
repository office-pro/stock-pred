import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentService } from './agent.service';
import { SoakController } from './soak-controller';

describe('SoakController kills (P4)', () => {
  let dir: string;
  let controller: SoakController;
  let forced: Array<{ code: string; reason: string }>;
  let decisionMode: 'APPROVAL' | 'AUTONOMOUS';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'soak-ctl-'));
    process.env.AGENT_SOAK_PATH = join(dir, 'soak.json');
    forced = [];
    decisionMode = 'AUTONOMOUS';
    controller = new SoakController();
    const agent = {
      getMode: () => ({
        tradingEnabled: true,
        mode: 'PAPER' as const,
        decisionMode,
        killSwitch: false,
        liveArming: { armed: false },
        disclaimer: '',
        riskBudgets: {
          perTradeRiskPercent: 1,
          maxOpenPositions: 5,
          maxNameExposurePct: 10,
          maxSectorExposurePct: 30,
          cashReservePct: 5,
        },
      }),
      peekPortfolioAnchors: () => ({
        equity: 1_000_000,
        cash: 900_000,
        openPositions: 0,
        dayStartEquity: 1_000_000,
        weekStartEquity: 1_000_000,
      }),
      listLedgerRecords: () => [],
      getWalkForwardReport: () => ({ report: null, path: null }),
      forceApprovalFromSoak: (code: string, reason: string) => {
        forced.push({ code, reason });
        decisionMode = 'APPROVAL';
      },
    } as unknown as AgentService;
    controller.bindAgent(agent);
    controller.start({ targetDurationMs: 7 * 24 * 60 * 60 * 1000 });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.AGENT_SOAK_PATH;
  });

  it('kills on daily drawdown and forces APPROVAL', () => {
    const result = controller.evaluateKills({
      equity: 960_000,
      dayStartEquity: 1_000_000,
    });
    expect(result.killed).toBe(true);
    expect(result.code).toBe('SOAK_DAILY_DD');
    expect(result.soak?.state).toBe('KILLED');
    expect(forced).toHaveLength(1);
    expect(decisionMode).toBe('APPROVAL');
  });

  it('kills on soak rolling drawdown', () => {
    const result = controller.evaluateKills({
      equity: 940_000,
      dayStartEquity: 940_000,
    });
    expect(result.killed).toBe(true);
    expect(result.code).toBe('SOAK_ROLLING_DD');
  });

  it('kills only after consecutive veto windows (not a single spike)', () => {
    expect(
      controller.evaluateKills({
        equity: 1_000_000,
        dayStartEquity: 1_000_000,
        vetoRate: 0.95,
      }).killed,
    ).toBe(false);
    expect(
      controller.evaluateKills({
        equity: 1_000_000,
        dayStartEquity: 1_000_000,
        vetoRate: 0.95,
      }).killed,
    ).toBe(false);
    const third = controller.evaluateKills({
      equity: 1_000_000,
      dayStartEquity: 1_000_000,
      vetoRate: 0.95,
    });
    expect(third.killed).toBe(true);
    expect(third.code).toBe('SOAK_VETO_SPIKE');
    expect(decisionMode).toBe('APPROVAL');
  });

  it('kills on exec failure streak', () => {
    const result = controller.evaluateKills({
      equity: 1_000_000,
      dayStartEquity: 1_000_000,
      execFailStreak: 3,
    });
    expect(result.killed).toBe(true);
    expect(result.code).toBe('SOAK_EXEC_FAILURE_STREAK');
    expect(decisionMode).toBe('APPROVAL');
  });
});
