import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  type DecisionLedgerEntry,
  type DecisionLedgerRecord,
  type DecisionOutcomeRecord,
  type DecisionTradeOutcome,
  isDecisionLedgerEntry,
  isDecisionOutcomeRecord,
} from '@stockpred/shared-types';

function defaultLedgerPath(): string {
  const fromEnv = process.env.AGENT_DECISION_LEDGER_PATH;
  if (fromEnv) return resolve(fromEnv);
  return resolve(__dirname, '../../data/decision-ledger.json');
}

interface LedgerFile {
  entries: DecisionLedgerRecord[];
}

function outcomeKey(o: {
  decisionId: string;
  positionId?: string;
  orderId?: string;
  tradeId?: string;
}): string {
  if (o.positionId) return `pos:${o.positionId}`;
  if (o.tradeId) return `trade:${o.tradeId}`;
  if (o.orderId) return `order:${o.orderId}`;
  return `decision:${o.decisionId}`;
}

/** Append-only decision ledger (JSON). Decisions are never rewritten; outcomes append. */
export class DecisionLedgerStore {
  private readonly path: string;
  private readonly maxEntries: number;

  constructor(path = defaultLedgerPath(), maxEntries = 5_000) {
    this.path = path;
    this.maxEntries = maxEntries;
  }

  private read(): LedgerFile {
    try {
      if (!existsSync(this.path)) return { entries: [] };
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LedgerFile>;
      return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    } catch {
      return { entries: [] };
    }
  }

  private write(file: LedgerFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(file, null, 2), 'utf8');
  }

  append(entry: DecisionLedgerEntry): DecisionLedgerEntry {
    const file = this.read();
    file.entries.push(entry);
    if (file.entries.length > this.maxEntries) {
      file.entries = file.entries.slice(file.entries.length - this.maxEntries);
    }
    this.write(file);
    return entry;
  }

  /**
   * Append OUTCOME_RECORDED. Idempotent on (decisionId | positionId | orderId | tradeId).
   * Does not mutate the original decision row.
   */
  appendOutcome(
    outcome: Omit<DecisionOutcomeRecord, 'kind' | 'timestamp'> & { timestamp?: number },
  ): { recorded: DecisionOutcomeRecord; duplicate: boolean } {
    const file = this.read();
    const key = outcomeKey(outcome);
    for (let i = file.entries.length - 1; i >= 0; i -= 1) {
      const row = file.entries[i];
      if (isDecisionOutcomeRecord(row) && outcomeKey(row) === key) {
        return { recorded: row, duplicate: true };
      }
    }

    const record: DecisionOutcomeRecord = {
      kind: 'OUTCOME_RECORDED',
      outcomeId: outcome.outcomeId,
      decisionId: outcome.decisionId,
      timestamp: outcome.timestamp ?? Date.now(),
      soakRunId: outcome.soakRunId,
      positionId: outcome.positionId,
      orderId: outcome.orderId,
      tradeId: outcome.tradeId,
      symbol: outcome.symbol,
      exitPrice: outcome.exitPrice,
      pnl: outcome.pnl,
      pnlPercent: outcome.pnlPercent,
      holdingPeriodMs: outcome.holdingPeriodMs,
      exitReason: outcome.exitReason,
      closedAt: outcome.closedAt,
      realizedR: outcome.realizedR,
      plannedRiskAmount: outcome.plannedRiskAmount,
    };
    file.entries.push(record);
    if (file.entries.length > this.maxEntries) {
      file.entries = file.entries.slice(file.entries.length - this.maxEntries);
    }
    this.write(file);
    return { recorded: record, duplicate: false };
  }

  /** Newest-first decision rows (outcomes excluded). Materialized outcome merged when present. */
  list(limit = 50): DecisionLedgerEntry[] {
    const file = this.read();
    const n = Math.min(Math.max(1, limit), 200);
    const decisions: DecisionLedgerEntry[] = [];
    for (let i = file.entries.length - 1; i >= 0 && decisions.length < n; i -= 1) {
      const row = file.entries[i];
      if (isDecisionLedgerEntry(row)) {
        decisions.push(this.materialize(row, file.entries));
      }
    }
    return decisions;
  }

  /** Raw append-only stream (decisions + outcomes). */
  listRaw(limit = 500): DecisionLedgerRecord[] {
    const file = this.read();
    const n = Math.min(Math.max(1, limit), this.maxEntries);
    return file.entries.slice(-n);
  }

  get(decisionId: string): DecisionLedgerEntry | null {
    const file = this.read();
    for (let i = file.entries.length - 1; i >= 0; i -= 1) {
      const row = file.entries[i];
      if (isDecisionLedgerEntry(row) && row.decisionId === decisionId) {
        return this.materialize(row, file.entries);
      }
    }
    return null;
  }

  getByOpportunity(opportunityId: string): DecisionLedgerEntry | null {
    const file = this.read();
    for (let i = file.entries.length - 1; i >= 0; i -= 1) {
      const row = file.entries[i];
      if (isDecisionLedgerEntry(row) && row.opportunityId === opportunityId) {
        return this.materialize(row, file.entries);
      }
    }
    return null;
  }

  getByTradeId(tradeId: string): DecisionLedgerEntry | null {
    const file = this.read();
    for (let i = file.entries.length - 1; i >= 0; i -= 1) {
      const row = file.entries[i];
      if (!isDecisionLedgerEntry(row)) continue;
      if (
        row.tradeId === tradeId ||
        row.execution?.orderId === tradeId ||
        row.orderId === tradeId
      ) {
        return this.materialize(row, file.entries);
      }
    }
    return null;
  }

  listForSoak(soakRunId: string): DecisionLedgerRecord[] {
    return this.read().entries.filter((row) => {
      if (isDecisionOutcomeRecord(row)) return row.soakRunId === soakRunId;
      return row.soakRunId === soakRunId;
    });
  }

  /** True if an OUTCOME_RECORDED already exists for this key. */
  hasOutcome(keys: {
    decisionId: string;
    positionId?: string;
    orderId?: string;
    tradeId?: string;
  }): boolean {
    const key = outcomeKey(keys);
    const file = this.read();
    return file.entries.some((row) => isDecisionOutcomeRecord(row) && outcomeKey(row) === key);
  }

  private materialize(
    decision: DecisionLedgerEntry,
    all: DecisionLedgerRecord[],
  ): DecisionLedgerEntry {
    let latest: DecisionOutcomeRecord | null = null;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const row = all[i];
      if (isDecisionOutcomeRecord(row) && row.decisionId === decision.decisionId) {
        latest = row;
        break;
      }
    }
    if (!latest) return decision;
    const outcome: DecisionTradeOutcome = {
      outcomeId: latest.outcomeId,
      decisionId: latest.decisionId,
      soakRunId: latest.soakRunId,
      positionId: latest.positionId,
      orderId: latest.orderId,
      tradeId: latest.tradeId,
      exitPrice: latest.exitPrice,
      pnl: latest.pnl,
      pnlPercent: latest.pnlPercent,
      holdingPeriodMs: latest.holdingPeriodMs,
      exitReason: latest.exitReason,
      closedAt: latest.closedAt,
      realizedR: latest.realizedR,
      plannedRiskAmount: latest.plannedRiskAmount,
    };
    return { ...decision, outcome };
  }
}
