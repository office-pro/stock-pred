import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type {
  PaperSoakReport,
  SoakCalibrationReport,
  SoakKillClass,
  SoakKillCode,
  SoakOpsMetrics,
  SoakRun,
  SoakVsWalkForwardRow,
} from '@stockpred/shared-types';
import {
  buildPaperSoakReport,
  compareWalkForwardToSoak,
  computeSoakCalibration,
  computeSoakOpsMetrics,
} from '@stockpred/shared-utils';
import type { AgentService } from './agent.service';
import { SoakStore } from './soak-store';

function defaultReportPath(soakRunId: string): string {
  const fromEnv = process.env.AGENT_SOAK_REPORT_PATH;
  if (fromEnv) return resolve(fromEnv);
  return resolve(__dirname, `../../data/paper-soak-report-${soakRunId}.json`);
}

function latestReportPath(): string {
  return resolve(__dirname, '../../data/paper-soak-report-latest.json');
}

/**
 * PAPER soak lifecycle. Can only STOP autonomy (force APPROVAL).
 * Never authorizes a trade.
 */
@Injectable()
export class SoakController {
  private readonly store = new SoakStore();
  private agent: AgentService | null = null;
  private lastReport: PaperSoakReport | null = null;

  bindAgent(agent: AgentService): void {
    this.agent = agent;
  }

  getStatus(): { soak: SoakRun | null } {
    return { soak: this.store.getCurrent() };
  }

  getActiveRunId(): string | undefined {
    return this.store.getActiveRunId();
  }

  /** Real soak-scoped ops (not stubs). Defaults to active/current soak run. */
  getOpsMetrics(soakRunId?: string): SoakOpsMetrics {
    const soak = this.store.getCurrent();
    const id = soakRunId ?? soak?.soakRunId ?? null;
    const records = this.agent?.listLedgerRecords() ?? [];
    return computeSoakOpsMetrics(records, id, {
      startedAt: soak?.startedAt,
      now: Date.now(),
    });
  }

  getCalibration(soakRunId?: string): SoakCalibrationReport {
    const soak = this.store.getCurrent();
    const id = soakRunId ?? soak?.soakRunId ?? null;
    const records = this.agent?.listLedgerRecords() ?? [];
    return computeSoakCalibration(records, id);
  }

  getCompare(soakRunId?: string): {
    soakRunId: string | null;
    rows: SoakVsWalkForwardRow[];
  } {
    const soak = this.store.getCurrent();
    const id = soakRunId ?? soak?.soakRunId ?? null;
    const ops = this.getOpsMetrics(id ?? undefined);
    const calibration = this.getCalibration(id ?? undefined);
    const outcomesN = calibration.byScore.reduce((a, b) => a + b.n, 0);
    const wins = calibration.byScore.reduce(
      (a, b) => a + (b.hitRate != null ? b.hitRate * b.n : 0),
      0,
    );
    const soakWinRate = outcomesN > 0 ? wins / outcomesN : null;
    const wf = this.agent?.getWalkForwardReport().report;
    const net = wf?.netPerformance;
    const funnel = wf?.funnel;
    const tradeCount = net?.tradeCount ?? 0;
    const rows = compareWalkForwardToSoak({
      walkForward: wf
        ? {
            autoAcceptRate:
              funnel != null ? funnel.autoAccepted / Math.max(1, funnel.candidates) : null,
            winRate: tradeCount > 0 ? (net?.winCount ?? 0) / tradeCount : null,
            avgR: null,
            maxDrawdownPct: null,
            avgHoldMs: null,
          }
        : null,
      soak: ops,
      soakWinRate,
      soakMaxDd: null,
    });
    return { soakRunId: id, rows };
  }

  buildReport(status?: 'PASSED' | 'KILLED' | 'WAIVED'): PaperSoakReport | null {
    const soak = this.store.getCurrent();
    if (!soak || soak.state === 'RUNNING' || soak.state === 'IDLE') {
      return this.lastReport;
    }
    const phase4Status = status ?? (soak.state as 'PASSED' | 'KILLED' | 'WAIVED');
    const endedAt = soak.endedAt ?? Date.now();
    const ops = this.getOpsMetrics(soak.soakRunId);
    const calibration = this.getCalibration(soak.soakRunId);
    const { rows } = this.getCompare(soak.soakRunId);
    const report = buildPaperSoakReport({
      soakRunId: soak.soakRunId,
      phase4Status,
      startedAt: soak.startedAt,
      endedAt,
      ops,
      calibration,
      vsWalkForward: rows,
      killClass: soak.killClass,
      killCode: soak.killCode,
      killReason: soak.killReason,
      waiveReason: soak.waiveReason,
    });
    this.persistReport(report);
    return report;
  }

  private persistReport(report: PaperSoakReport): void {
    this.lastReport = report;
    try {
      const path = defaultReportPath(report.soakRunId);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
      writeFileSync(latestReportPath(), JSON.stringify(report, null, 2), 'utf8');
    } catch (err) {
      console.warn('[soak] failed to persist PaperSoakReport', err);
    }
  }

  private finishAndReport(
    state: 'PASSED' | 'KILLED' | 'WAIVED',
    patch: Partial<SoakRun> = {},
  ): SoakRun {
    const soak = this.store.finish(state, patch);
    this.buildReport(state);
    return soak;
  }

  start(input?: { targetDurationMs?: number }): SoakRun {
    if (!this.agent) throw new BadRequestException('SoakController not bound');
    const mode = this.agent.getMode();
    if (mode.mode !== 'PAPER') {
      throw new BadRequestException('Soak may only start in PAPER mode');
    }
    const portfolio = this.agent.peekPortfolioAnchors();
    return this.store.start({
      baseline: {
        equity: portfolio.equity,
        cash: portfolio.cash,
        openPositions: portfolio.openPositions,
        dayStartEquity: portfolio.dayStartEquity || portfolio.equity,
        weekStartEquity: portfolio.weekStartEquity || portfolio.equity,
      },
      decisionMode: mode.decisionMode,
      operatingMode: mode.mode,
      riskBudgets: {
        perTradeRiskPercent: mode.riskBudgets.perTradeRiskPercent,
        maxOpenPositions: mode.riskBudgets.maxOpenPositions,
        maxNameExposurePct: mode.riskBudgets.maxNameExposurePct,
        maxSectorExposurePct: mode.riskBudgets.maxSectorExposurePct,
        cashReservePct: mode.riskBudgets.cashReservePct,
      },
      targetDurationMs: input?.targetDurationMs,
    });
  }

  stop(): SoakRun {
    const cur = this.store.getCurrent();
    if (!cur || cur.state !== 'RUNNING') {
      throw new BadRequestException('No RUNNING soak to stop');
    }
    const elapsed = Date.now() - cur.startedAt;
    const passed = elapsed >= cur.targetDurationMs;
    return this.finishAndReport(passed ? 'PASSED' : 'WAIVED', {
      waiveReason: passed ? undefined : 'Stopped before target duration',
    });
  }

  waive(reason: string): SoakRun {
    const cur = this.store.getCurrent();
    if (!cur || cur.state !== 'RUNNING') {
      throw new BadRequestException('No RUNNING soak to waive');
    }
    return this.finishAndReport('WAIVED', { waiveReason: reason || 'Operator waive' });
  }

  evaluateKills(input: {
    equity: number;
    dayStartEquity: number;
    vetoRate?: number;
    execFailStreak?: number;
    quoteStale?: boolean;
    dataFailure?: boolean;
  }): {
    killed: boolean;
    soak: SoakRun | null;
    code?: SoakKillCode;
    killClass?: SoakKillClass;
  } {
    const cur = this.store.getCurrent();
    if (!cur || cur.state !== 'RUNNING' || !this.agent) {
      return { killed: false, soak: cur };
    }
    const t = cur.configSnapshot.killThresholds;
    const dailyDd =
      input.dayStartEquity > 0 ? (input.dayStartEquity - input.equity) / input.dayStartEquity : 0;
    const soakDd =
      cur.baseline.equity > 0 ? (cur.baseline.equity - input.equity) / cur.baseline.equity : 0;

    if (dailyDd > t.dailyDrawdownPct) {
      return this.kill('RISK', 'SOAK_DAILY_DD', `Daily DD ${(dailyDd * 100).toFixed(2)}%`);
    }
    if (soakDd > t.soakDrawdownPct) {
      return this.kill('RISK', 'SOAK_ROLLING_DD', `Soak DD ${(soakDd * 100).toFixed(2)}%`);
    }
    if ((input.execFailStreak ?? 0) >= t.execFailStreak) {
      return this.kill(
        'EXECUTION',
        'SOAK_EXEC_FAILURE_STREAK',
        `Exec fail streak ${input.execFailStreak}`,
      );
    }

    let consecutiveVeto = cur.consecutiveVetoWindows;
    if ((input.vetoRate ?? 0) >= t.vetoSpikeRate) consecutiveVeto += 1;
    else consecutiveVeto = 0;

    let consecutiveStale = cur.consecutiveStaleWindows;
    if (input.quoteStale) consecutiveStale += 1;
    else consecutiveStale = 0;

    let consecutiveData = cur.consecutiveDataFailWindows;
    if (input.dataFailure) consecutiveData += 1;
    else consecutiveData = 0;

    this.store.update((run) => ({
      ...run,
      consecutiveVetoWindows: consecutiveVeto,
      consecutiveStaleWindows: consecutiveStale,
      consecutiveDataFailWindows: consecutiveData,
    }));

    if (consecutiveVeto >= t.consecutiveVetoWindows) {
      return this.kill(
        'DECISION',
        'SOAK_VETO_SPIKE',
        `Veto spike across ${consecutiveVeto} windows`,
      );
    }
    if (consecutiveStale >= t.consecutiveVetoWindows) {
      return this.kill(
        'DATA',
        'SOAK_QUOTE_STALE',
        `Quote stale across ${consecutiveStale} windows`,
      );
    }
    if (consecutiveData >= t.consecutiveVetoWindows) {
      return this.kill(
        'DATA',
        'SOAK_DATA_FAILURE',
        `Data failure across ${consecutiveData} windows`,
      );
    }

    if (Date.now() - cur.startedAt >= cur.targetDurationMs) {
      return { killed: false, soak: this.finishAndReport('PASSED') };
    }

    return { killed: false, soak: this.store.getCurrent() };
  }

  private kill(
    killClass: SoakKillClass,
    killCode: SoakKillCode,
    killReason: string,
  ): { killed: true; soak: SoakRun; code: SoakKillCode; killClass: SoakKillClass } {
    if (this.agent) {
      this.agent.forceApprovalFromSoak(killCode, killReason);
    }
    const soak = this.finishAndReport('KILLED', { killClass, killCode, killReason });
    return { killed: true, soak, code: killCode, killClass };
  }

  emptyOpsMetrics(soakRunId: string | null): SoakOpsMetrics {
    return this.getOpsMetrics(soakRunId ?? undefined);
  }

  buildReportStub(status: 'PASSED' | 'KILLED' | 'WAIVED'): PaperSoakReport | null {
    return this.buildReport(status);
  }
}
