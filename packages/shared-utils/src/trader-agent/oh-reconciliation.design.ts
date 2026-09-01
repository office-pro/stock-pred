/**
 * Design note (OH-3) — observe-only reconciliation contract.
 *
 * Sources compared (never mutate):
 *   Decision Ledger  ↔  Portfolio holdings  ↔  Monitored positions
 *
 * Detects only:
 *   LEDGER_EXECUTED_NO_HOLDING, HOLDING_NO_LEDGER, POSITION_NO_LEDGER,
 *   QTY_MISMATCH, DUPLICATE_DECISION_ID, EXECUTED_MISSING_ORDER_ID,
 *   OUTCOME_WITHOUT_DECISION
 *
 * Hard rule: never authorize, resize, bypass Risk/Portfolio/Policy/Gate, or place orders.
 * Implementation: packages/shared-utils/.../oh-reconciliation.ts
 * Endpoint: GET /agent/ops/reconcile
 */
export const OH3_RECONCILIATION_DESIGN = {
  version: 'oh-reconciliation.v1',
  observeOnly: true as const,
  endpoint: 'GET /agent/ops/reconcile',
};
