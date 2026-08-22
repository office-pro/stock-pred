# Phase 7 — Advanced circuit breakers (stop-only)

**Status:** Engineering COMPLETE (independent of P5 Evidence / P6 activation).

```text
P5 engineering        COMPLETE
P5 evidence           NO-GO / ops
P6 engineering        COMPLETE
P6 activation         BLOCKED
P7 breakers           COMPLETE (stop-only)
```

## Invariant

```text
Breaker trip → force APPROVAL / block autonomous cycle → ledger reasonCodes + desk indicator
```

Breakers **never**:

- imply `AUTO_ACCEPTED`
- set `liveAutoArmed`
- bypass Risk / Portfolio / Policy / Gate
- change P5 Evidence GO/NO-GO or P6 ARM semantics

## Implementation

| Piece        | Location                                                              |
| ------------ | --------------------------------------------------------------------- |
| Pure eval    | `packages/shared-utils/src/trader-agent/circuit-breakers.ts`          |
| Reason codes | `DecisionReasonCode` `BREAKER_*` in shared-types                      |
| Enforcement  | `apps/trader-agent` `enforceBreakers()` before PAPER autonomous cycle |
| Desk         | Agent Desk chip from `getMode().breakers`                             |
| Tests        | `phase7.spec.ts`                                                      |

## Sample adequacy note

P5 review `20/10/20` remains **evidence-review criteria only** — not breaker or Risk/Gate runtime thresholds.

## Activation path (unchanged)

LIVE autonomous still requires Evidence OVERALL=GO **and** human `ARM LIVE AUTONOMOUS`.
