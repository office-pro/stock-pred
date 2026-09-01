import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  type DecisionLedgerEntry,
  type DecisionLedgerRecord,
  type DecisionOutcomeRecord,
  type DecisionTradeOutcome,
  type StructuredThesis,
  type ThesisHistoryEvent,
  type ThesisHistoryLedgerRecord,
  isDecisionLedgerEntry,
  isDecisionOutcomeRecord,
  isThesisHistoryLedgerRecord,
} from '@stockpred/shared-types';
import { appendThesisHistory } from '@stockpred/shared-utils';

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
      outcomeKind: outcome.outcomeKind,
      rankingContextId: outcome.rankingContextId,
      grossR: outcome.grossR,
      fees: outcome.fees,
      slippage: outcome.slippage,
      grossPnl: outcome.grossPnl,
      netPnl: outcome.netPnl,
      netR: outcome.netR,
      maeR: outcome.maeR,
      mfeR: outcome.mfeR,
      pathMetricsStatus: outcome.pathMetricsStatus,
      counterfactualProvenance: outcome.counterfactualProvenance,
      waitMarkEndReason: outcome.waitMarkEndReason,
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
      if (isThesisHistoryLedgerRecord(row)) return false;
      if (isDecisionOutcomeRecord(row)) return row.soakRunId === soakRunId;
      return isDecisionLedgerEntry(row) && row.soakRunId === soakRunId;
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

  /** Append-only thesis history. Enforces monotonic timestamps and single THESIS_CREATED. */
  appendThesisEvent(input: {
    decisionId: string;
    timestamp?: number;
    event: ThesisHistoryEvent;
    reassessment?: StructuredThesis;
  }): { recorded: ThesisHistoryLedgerRecord; duplicate: boolean } {
    const file = this.read();
    const existingEvents = file.entries
      .filter((row): row is ThesisHistoryLedgerRecord => isThesisHistoryLedgerRecord(row))
      .filter((row) => row.decisionId === input.decisionId)
      .map((row) => row.event);

    if (
      input.event.type === 'THESIS_CREATED' &&
      existingEvents.some((e) => e.type === 'THESIS_CREATED')
    ) {
      const prior = file.entries.find(
        (row): row is ThesisHistoryLedgerRecord =>
          isThesisHistoryLedgerRecord(row) &&
          row.decisionId === input.decisionId &&
          row.event.type === 'THESIS_CREATED',
      );
      return { recorded: prior!, duplicate: true };
    }

    appendThesisHistory({ events: existingEvents }, input.event);

    const record: ThesisHistoryLedgerRecord = {
      kind: 'THESIS_EVENT',
      decisionId: input.decisionId,
      timestamp: input.timestamp ?? Date.now(),
      event: input.event,
      reassessment: input.reassessment,
    };
    file.entries.push(record);
    if (file.entries.length > this.maxEntries) {
      file.entries = file.entries.slice(file.entries.length - this.maxEntries);
    }
    this.write(file);
    return { recorded: record, duplicate: false };
  }

  listThesisEvents(decisionId: string): ThesisHistoryLedgerRecord[] {
    return this.read().entries.filter(
      (row): row is ThesisHistoryLedgerRecord =>
        isThesisHistoryLedgerRecord(row) && row.decisionId === decisionId,
    );
  }

  private latestThesisEvent(
    decisionId: string,
    all: DecisionLedgerRecord[],
  ): ThesisHistoryLedgerRecord | null {
    let latest: ThesisHistoryLedgerRecord | null = null;
    for (const row of all) {
      if (isThesisHistoryLedgerRecord(row) && row.decisionId === decisionId) {
        latest = row;
      }
    }
    return latest;
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
    const thesisEvent = this.latestThesisEvent(decision.decisionId, all);
    const thesisReassessment = thesisEvent?.reassessment ?? decision.thesisSnapshot?.initialThesis;

    let result: DecisionLedgerEntry = decision;
    if (thesisReassessment) {
      result = { ...result, thesisReassessment };
    }
    if (!latest) return result;
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
      outcomeKind: latest.outcomeKind,
      rankingContextId: latest.rankingContextId,
      grossR: latest.grossR,
      fees: latest.fees,
      slippage: latest.slippage,
      grossPnl: latest.grossPnl,
      netPnl: latest.netPnl,
      netR: latest.netR,
      maeR: latest.maeR,
      mfeR: latest.mfeR,
      pathMetricsStatus: latest.pathMetricsStatus,
      counterfactualProvenance: latest.counterfactualProvenance,
      waitMarkEndReason: latest.waitMarkEndReason,
    };
    return { ...result, outcome };
  }
}
