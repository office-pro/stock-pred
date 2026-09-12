# Phase 7 — Advanced circuit breakers (stop-only)

**Status:** P7 advanced breakers implemented (independent of P5 Evidence / P6 activation).

```text
P5 evidence           PARKED / INCONCLUSIVE
P6 implementation     COMPLETE
P6 activation         BLOCKED (P5 GO + human ARM)
P7 advanced breakers  COMPLETE (stop/restrict only)
```

## Invariant

```text
Breaker trip → force APPROVAL / restrict autonomous → ledger reasonCodes + desk indicator
```

Breakers **never**:

- imply `AUTO_ACCEPTED`
- set `liveAutoArmed`
- mutate Risk / Portfolio / Policy / Gate
- change P5 Evidence GO/NO-GO or P6 ARM semantics

## Implementation

| Piece            | Location                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| Classic eval     | `packages/shared-utils/src/trader-agent/circuit-breakers.ts`              |
| P7.1 Quality     | `p7-quality-breaker.ts`                                                   |
| P7.2 EV          | `p7-ev-breaker.ts`                                                        |
| P7.3 Calibration | `p7-calibration-breaker.ts` (`probabilityTarget` only — not confidence)   |
| P7.4 Regime      | `p7-regime-breaker.ts`                                                    |
| P7.5 Aggregation | `p7-breaker-aggregation.ts`                                               |
| Types / floors   | `packages/shared-types/src/p7-breakers.ts`                                |
| Enforcement      | `apps/trader-agent` `enforceBreakers()` before autonomous cycle           |
| Desk             | Agent Desk chip from `getMode().breakers` (`aggregateState`, `subStates`) |
| Tests            | `p7-*-breaker.spec.ts`, `p7-isolation.spec.ts`, `p7-validation.spec.ts`   |

## Aggregate enforcement contract

| Aggregate           | Enforcement         |
| ------------------- | ------------------- |
| CLEAR, INSUFFICIENT | NONE                |
| UNKNOWN, RESTRICT   | RESTRICT_AUTONOMOUS |
| STOP, SEVERE_STOP   | FORCE_APPROVAL      |

`execution_drift` remains in legacy scaffold only — advanced metric wiring is **out of scope** for this P7 slice.

## Sample floors

P7 sample floors (`P7_SAMPLE_FLOORS`) are separate from P5 evidence unlock floors. Floors unmet → `INSUFFICIENT` (observability only, no enforcement).

## Activation path (unchanged)

LIVE autonomous still requires Evidence OVERALL=GO **and** human `ARM LIVE AUTONOMOUS`. P7 PASS does not enable P6.
