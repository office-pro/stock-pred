import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { AgentDecisionMode, AgentMode, AgentRiskBudgetConfig } from '@stockpred/shared-types';
import { DEFAULT_AGENT_RISK_BUDGETS } from '@stockpred/shared-types';

export interface PersistedAgentState {
  tradingEnabled: boolean;
  mode: AgentMode;
  decisionMode: AgentDecisionMode;
  killSwitch: boolean;
  /** Operator latch only — ineffective unless P5 evidence OVERALL=GO. */
  liveAutoArmed: boolean;
  riskBudgets: AgentRiskBudgetConfig;
  updatedAt: number;
}

function defaultStatePath(): string {
  const fromEnv = process.env.AGENT_STATE_PATH;
  if (fromEnv) return resolve(fromEnv);
  return resolve(__dirname, '../../data/agent-state.json');
}

function parseBudgets(raw: unknown): AgentRiskBudgetConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AGENT_RISK_BUDGETS };
  const row = raw as Record<string, unknown>;
  const num = (key: keyof AgentRiskBudgetConfig, fallback: number): number => {
    const v = row[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    perTradeRiskPercent: num('perTradeRiskPercent', DEFAULT_AGENT_RISK_BUDGETS.perTradeRiskPercent),
    maxOpenPositions: Math.max(
      1,
      Math.floor(num('maxOpenPositions', DEFAULT_AGENT_RISK_BUDGETS.maxOpenPositions)),
    ),
    maxNameExposurePct: num('maxNameExposurePct', DEFAULT_AGENT_RISK_BUDGETS.maxNameExposurePct),
    maxSectorExposurePct: num(
      'maxSectorExposurePct',
      DEFAULT_AGENT_RISK_BUDGETS.maxSectorExposurePct,
    ),
    cashReservePct: num('cashReservePct', DEFAULT_AGENT_RISK_BUDGETS.cashReservePct),
    maxPriceDeviationPct: num(
      'maxPriceDeviationPct',
      DEFAULT_AGENT_RISK_BUDGETS.maxPriceDeviationPct,
    ),
  };
}

const DEFAULT_STATE: PersistedAgentState = {
  tradingEnabled: false,
  mode: 'PAPER',
  decisionMode: 'APPROVAL',
  killSwitch: false,
  liveAutoArmed: false,
  riskBudgets: { ...DEFAULT_AGENT_RISK_BUDGETS },
  updatedAt: 0,
};

/** Durable JSON so agent trading prefs survive trader-agent restarts. */
export class AgentStateStore {
  private readonly path: string;

  constructor(path = defaultStatePath()) {
    this.path = path;
  }

  load(): PersistedAgentState {
    try {
      if (!existsSync(this.path)) {
        return { ...DEFAULT_STATE, riskBudgets: { ...DEFAULT_AGENT_RISK_BUDGETS } };
      }
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedAgentState>;
      return {
        tradingEnabled: Boolean(parsed.tradingEnabled),
        mode: parsed.mode === 'LIVE' || parsed.mode === 'RESEARCH' ? parsed.mode : 'PAPER',
        decisionMode: parsed.decisionMode === 'AUTONOMOUS' ? 'AUTONOMOUS' : 'APPROVAL',
        killSwitch: Boolean(parsed.killSwitch),
        liveAutoArmed: Boolean(parsed.liveAutoArmed),
        riskBudgets: parseBudgets(parsed.riskBudgets),
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    } catch {
      return { ...DEFAULT_STATE, riskBudgets: { ...DEFAULT_AGENT_RISK_BUDGETS } };
    }
  }

  save(state: Omit<PersistedAgentState, 'updatedAt'>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const payload: PersistedAgentState = { ...state, updatedAt: Date.now() };
    writeFileSync(this.path, JSON.stringify(payload, null, 2), 'utf8');
  }
}
