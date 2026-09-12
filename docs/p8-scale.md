# Phase 8 — Scale throughput (final roadmap phase)

**Status:** Engineering COMPLETE. Validation/hardening COMPLETE.  
**Final phase:** No Phase 9. No new authorization architecture.

```text
P1–P7 engineering     COMPLETE
P8 scale              COMPLETE
P8 validation         COMPLETE
P5 Evidence           NO-GO (ops; unchanged)
P6 LIVE activation    BLOCKED until GO + human ARM (unchanged)
```

## Goal

Raise capacity on the **same** trading brain:

```text
Intelligence → evaluateTrade → Risk → Portfolio → Policy → Gate → Execution
```

## Parallelism rule (hard)

```text
Analysis worker pool  →  opportunities
        ↓
SEQUENTIAL / SINGLE-FLIGHT accept loop
        ↓
Risk → Portfolio → Policy → Gate → Execution
```

- **Safe to parallelize:** symbol analysis / opportunity preparation (`mapPool`)
- **Must stay sequential:** autonomous accept / authorize / execute

## Knobs (env)

| Env                                      | Default   | Role                            |
| ---------------------------------------- | --------- | ------------------------------- |
| `AGENT_MAX_SYMBOLS_SCANNED`              | 120       | Max quotes considered per cycle |
| `AGENT_MAX_OPPORTUNITIES`                | 40        | Max retained after rank         |
| `AGENT_MAX_AUTONOMOUS_ACCEPTS_PER_CYCLE` | 8         | Sequential accepts/cycle        |
| `AGENT_ANALYSIS_CONCURRENCY`             | 4         | Analysis worker pool size       |
| `AGENT_STRATEGY_TAGS`                    | _(empty)_ | Intelligence-only strategy tags |

Exposed read-only on `GET /agent/mode` as `scale` + `lastCycleMetrics`.  
Tenant-scoped breaker counters require authenticated `x-user-id` / `x-brand-id` headers (same pattern as other agent endpoints).

## Tenant isolation

Breaker daily-auto / veto counters are keyed by `(userId, brandId)` via `TenantBreakerStore`.  
Raising throughput must not leak breaker state across tenants.

### `autoPnlDrawdownPct` — global-only

`TenantBreakerCounters.autoPnlDrawdownPct` is **not populated per-tenant** (always `0` in tenant snapshots).  
Use the agent-level global drawdown metric for observability/enforcement. No tenant mirror wiring.

## Validation (P8.1–P8.5)

Validation modules in `packages/shared-utils/src/trader-agent/`:

| Module                    | Role                                                      |
| ------------------------- | --------------------------------------------------------- |
| `p8-load-harness.ts`      | Invariant-based load test wrapping **existing** `mapPool` |
| `p8-isolation.spec.ts`    | Auth, P7/P8 separation, tenant A/B, idempotency           |
| `p8-validation-report.ts` | Aggregated `P8ValidationReport` artifact                  |

### Load harness contract (invariant-based)

**Analysis PASS/FAIL invariants:**

```text
peakConcurrency <= configured concurrency
every symbol processed exactly once
result ordering deterministic (index order preserved)
```

**Accept PASS/FAIL invariants:**

```text
accepted <= acceptsPerCycle
acceptance execution remains sequential
no duplicate acceptance of same candidate
```

**Timing (diagnostic only — NOT pass/fail):** p50 / p95 / p99 recorded for observability.

### Verdict semantics

| Verdict          | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| **PASS**         | All deterministic checks pass                                   |
| **FAIL**         | Invariant breach, isolation change, or frozen-file gate failure |
| **INCONCLUSIVE** | Required test/environment evidence unavailable                  |

Example: `peakConcurrency > configured` → **FAIL** (not INCONCLUSIVE).

## Non-goals

- No LIVE ARM / Evidence GO changes
- No Risk / Portfolio / Gate loosening
- No alternate execution path
- No distributed workers, Redis, Kafka, or queue infrastructure in trader-agent
- No Phase 9

## Acceptance

- Throughput knobs raise scan/accept caps above legacy (3 / 80)
- `(userId, brandId)` isolation holds
- Analysis is parallel; accept is sequential
- P2 budgets still bind; P7 breakers still force APPROVAL
- LIVE + AUTONOMOUS stays HUMAN_REQUIRED while Evidence NO-GO
- `p8-*` + `phase8.spec.ts` regression green
