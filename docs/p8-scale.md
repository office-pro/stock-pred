# Phase 8 — Scale throughput (final roadmap phase)

**Status:** Engineering COMPLETE.  
**Final phase:** No Phase 9. No new authorization architecture.

```text
P1–P7 engineering     COMPLETE
P8 scale              COMPLETE
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

## Tenant isolation

Breaker daily-auto / veto counters are keyed by `(userId, brandId)` via `TenantBreakerStore`.  
Raising throughput must not leak breaker state across tenants.

## Non-goals

- No LIVE ARM / Evidence GO changes
- No Risk / Portfolio / Gate loosening
- No alternate execution path
- No Phase 9

## Acceptance

- Throughput knobs raise scan/accept caps above legacy (3 / 80)
- `(userId, brandId)` isolation holds
- Analysis is parallel; accept is sequential
- P2 budgets still bind; P7 breakers still force APPROVAL
- LIVE + AUTONOMOUS stays HUMAN_REQUIRED while Evidence NO-GO
