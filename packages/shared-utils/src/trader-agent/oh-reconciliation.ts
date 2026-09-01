/**
 * OH-3 ledger ↔ holdings ↔ positions reconciliation (pure).
 * Observe / detect / report only — never authorize, resize, or cancel.
 */

import type {
  OhReconcileHoldingInput,
  OhReconcileIssue,
  OhReconcileLedgerInput,
  OhReconcilePositionInput,
  OhReconciliationReport,
} from '@stockpred/shared-types';

const EXECUTED_DECISIONS = new Set(['AUTO_ACCEPT', 'AUTO_ACCEPTED', 'APPROVED', 'EXECUTED']);

function sym(s: string): string {
  return s.trim().toUpperCase();
}

function isOpenExecuted(row: OhReconcileLedgerInput): boolean {
  if (!EXECUTED_DECISIONS.has(row.decision)) return false;
  if (row.hasOutcome) return false;
  const status = (row.executionStatus ?? '').toUpperCase();
  if (status && status !== 'EXECUTED' && status !== 'FILLED' && status !== 'OPEN') {
    return false;
  }
  return true;
}

/**
 * Build an observe-only reconciliation report.
 * Does not call brokers, Risk, Portfolio, Policy, or Gate.
 */
export function buildOhReconciliationReport(input: {
  ledger: OhReconcileLedgerInput[];
  holdings: OhReconcileHoldingInput[];
  positions?: OhReconcilePositionInput[];
  now?: number;
}): OhReconciliationReport {
  const now = input.now ?? Date.now();
  const issues: OhReconcileIssue[] = [];

  const idCounts = new Map<string, number>();
  for (const row of input.ledger) {
    idCounts.set(row.decisionId, (idCounts.get(row.decisionId) ?? 0) + 1);
  }
  for (const [decisionId, count] of idCounts) {
    if (count > 1) {
      issues.push({
        code: 'DUPLICATE_DECISION_ID',
        severity: 'WARN',
        decisionId,
        message: `Decision id appears ${count} times in ledger window`,
        details: { count },
      });
    }
  }

  const openExecuted = input.ledger.filter(isOpenExecuted);
  const holdingsBySymbol = new Map<string, OhReconcileHoldingInput[]>();
  for (const h of input.holdings) {
    const k = sym(h.symbol);
    const list = holdingsBySymbol.get(k) ?? [];
    list.push(h);
    holdingsBySymbol.set(k, list);
  }

  const positionsBySymbol = new Map<string, OhReconcilePositionInput[]>();
  for (const p of input.positions ?? []) {
    const k = sym(p.symbol);
    const list = positionsBySymbol.get(k) ?? [];
    list.push(p);
    positionsBySymbol.set(k, list);
  }

  const ledgerSymbolsCovered = new Set<string>();

  for (const row of openExecuted) {
    const orderId = row.executionOrderId ?? row.orderId;
    if (!orderId) {
      issues.push({
        code: 'EXECUTED_MISSING_ORDER_ID',
        severity: 'WARN',
        decisionId: row.decisionId,
        symbol: row.symbol,
        message: 'Executed ledger row has no orderId',
      });
    }

    const k = sym(row.symbol);
    ledgerSymbolsCovered.add(k);
    const holdings = holdingsBySymbol.get(k) ?? [];
    const positions = positionsBySymbol.get(k) ?? [];

    if (holdings.length === 0 && positions.length === 0) {
      issues.push({
        code: 'LEDGER_EXECUTED_NO_HOLDING',
        severity: 'CRITICAL',
        decisionId: row.decisionId,
        symbol: row.symbol,
        orderId,
        message: `Ledger says executed/open for ${k} but no holding or monitored position found`,
      });
      continue;
    }

    if (row.executionQty != null && holdings.length > 0) {
      const heldQty = holdings.reduce((a, h) => a + h.quantity, 0);
      if (heldQty !== row.executionQty) {
        issues.push({
          code: 'QTY_MISMATCH',
          severity: 'WARN',
          decisionId: row.decisionId,
          symbol: row.symbol,
          orderId,
          message: `Ledger qty ${row.executionQty} vs holdings qty ${heldQty} for ${k}`,
          details: { ledgerQty: row.executionQty, holdingQty: heldQty },
        });
      }
    }
  }

  for (const [k, lots] of holdingsBySymbol) {
    if (ledgerSymbolsCovered.has(k)) continue;
    const linked = lots.some((h) => h.decisionId || h.orderId);
    if (linked) continue;
    const hasAnyLedger = input.ledger.some(
      (r) => sym(r.symbol) === k && EXECUTED_DECISIONS.has(r.decision),
    );
    if (!hasAnyLedger) {
      issues.push({
        code: 'HOLDING_NO_LEDGER',
        severity: 'CRITICAL',
        symbol: k,
        message: `Broker/portfolio holding for ${k} with no matching executed ledger decision in window`,
        details: { quantity: lots.reduce((a, h) => a + h.quantity, 0) },
      });
    }
  }

  for (const [k, lots] of positionsBySymbol) {
    if (ledgerSymbolsCovered.has(k) || holdingsBySymbol.has(k)) continue;
    const hasAnyLedger = input.ledger.some(
      (r) => sym(r.symbol) === k && EXECUTED_DECISIONS.has(r.decision),
    );
    if (!hasAnyLedger) {
      issues.push({
        code: 'POSITION_NO_LEDGER',
        severity: 'WARN',
        symbol: k,
        message: `Monitored position for ${k} with no matching executed ledger decision in window`,
        details: { quantity: lots.reduce((a, p) => a + p.quantity, 0) },
      });
    }
  }

  const decisionIds = new Set(input.ledger.map((r) => r.decisionId));
  for (const row of input.ledger) {
    if (row.hasOutcome && !decisionIds.has(row.decisionId)) {
      issues.push({
        code: 'OUTCOME_WITHOUT_DECISION',
        severity: 'WARN',
        decisionId: row.decisionId,
        symbol: row.symbol,
        message: `Outcome present without decision row for ${row.decisionId}`,
      });
    }
  }

  const criticalCount = issues.filter((i) => i.severity === 'CRITICAL').length;
  const warnCount = issues.filter((i) => i.severity === 'WARN').length;

  return {
    schemaVersion: 'oh-reconciliation.v1',
    generatedAt: now,
    observeOnly: true,
    summary: {
      ledgerExecutedOpen: openExecuted.length,
      holdings: input.holdings.length,
      positions: (input.positions ?? []).length,
      issueCount: issues.length,
      criticalCount,
      warnCount,
    },
    issues,
  };
}
