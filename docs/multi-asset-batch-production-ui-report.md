# Multi-Asset Batch Production UI — Implementation Report

## Verdict

The frozen Multi-Asset Seam was consumed without changing its adapter/provider boundary. The batch
workstation is universe-driven: predefined universes never accept frontend symbols, canonical
membership is resolved and frozen by the backend, and missing canonical sources remain unavailable.

## Provenance chains

| Area                              | Status        | Demonstrated chain                                                                                                                                                                                                       |
| --------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NSE_ALL membership                | IMPLEMENTED   | NSE reference listing artifact → Canonical Universe Registry atomic `PUBLISH/COMPLETE` snapshot → trader-agent batch create → UI universe/review cards                                                                   |
| NIFTY baskets                     | IMPLEMENTED   | Versioned content hash of canonical `index-universes.json` basket → trader-agent catalog/create → UI                                                                                                                     |
| US_SP500 / US_ALL                 | NOT AVAILABLE | No approved canonical artifact is configured; API and UI return `UNSUPPORTED_UNIVERSE`                                                                                                                                   |
| CRYPTO_ALL                        | NOT AVAILABLE | No approved canonical artifact is configured; API and UI return `UNSUPPORTED_UNIVERSE`                                                                                                                                   |
| COMMODITY_ALL                     | NOT AVAILABLE | No approved canonical artifact is configured; API and UI return `UNSUPPORTED_UNIVERSE`                                                                                                                                   |
| FUTURES_ALL                       | NOT AVAILABLE | No approved canonical artifact is configured; API and UI return `UNSUPPORTED_UNIVERSE`                                                                                                                                   |
| Custom / Single Stock             | IMPLEMENTED   | Canonical listing/snapshot search → validated `InstrumentRef` → create cardinality/identity validation → immutable batch `instrumentSet`                                                                                 |
| Sector membership                 | IMPLEMENTED   | MDS sector classification → intersection with canonical NSE_ALL eligibility → content-versioned sector snapshot → batch lineage                                                                                          |
| Market session                    | PARTIAL       | Backend NSE session rule + real MDS timestamp → API → header/workstation. Other markets and exchange-holiday/next-open calendars render `Not available`                                                                  |
| Universe market-data availability | IMPLEMENTED   | Immutable canonical members ∩ real MDS records → eligible/available/live/delayed/stale/missing denominators → API → UI                                                                                                   |
| Provider/source readiness         | PARTIAL       | Source authority + adapter capability declarations are exposed separately from runtime data status. Universe-wide runtime coverage is currently measured for MDS quotes; other capabilities use completed batch coverage |
| Batch progress                    | IMPLEMENTED   | Durable tasks → backend processed/pending/failed/totalEligible → polling API → unified workstation                                                                                                                       |
| Capability coverage               | IMPLEMENTED   | BatchResearchReport canonical/processed denominators → batch-id report endpoint → selected-batch UI                                                                                                                      |
| Best Picks / Bull-Run             | IMPLEMENTED   | Existing RankingContext order and Bull-Run v2 evidence are reused; UI does not re-rank                                                                                                                                   |
| Fundamentals/news                 | PARTIAL       | Existing backend outputs and batch capability coverage only; missing values remain unavailable and no frontend/LLM synthesis was added                                                                                   |
| Execution readiness               | IMPLEMENTED   | No frontend readiness derivation was added; backend authorization chain remains unchanged                                                                                                                                |
| Paper lineage                     | IMPLEMENTED   | Optional batch id → membership assertion → universe version/mode/model/feature snapshot persisted on PaperExperiment                                                                                                     |

## Contract enforcement

- Predefined universe requests reject `symbols`, `instrument`, `instruments`, and public `allLimit`.
- `CUSTOM` requires one or more canonical `InstrumentRef` records.
- `SINGLE_STOCK` requires exactly one canonical `InstrumentRef`.
- Strict universe/scan-kind pairs and required inverse/global/sector parameters are validated.
- Active canonical artifacts must be `PUBLISH/COMPLETE`, non-empty, and provider-total complete.
- Failed refreshes retain the last-known-good snapshot; refresh and status routes are admin-only at
  the API gateway.
- Running batch membership is persisted and is not refreshed by market ticks or universe refreshes.

## Verification

- Shared seam/batch regression: PASS (55 tests).
- Trader-agent create-contract regression: PASS (5 tests).
- Frontend request/null truthfulness regression: PASS (9 tests).
- Full shared-intelligence regression: PASS (60 suites, 519 tests).
- Full trader-agent regression: PASS (5 suites, 17 tests; final contract test rerun included).
- Full frontend regression: PASS (10 suites, 36 tests).
- Authentication regression: PASS (2 suites, 6 tests).
- Multi-asset runtime validation: PASS (offline 21/21; live 12/12).
- Responsive Cypress acceptance: PASS (4/4) at desktop, tablet, and mobile widths; three
  screenshots captured.
- Changed package/application TypeScript builds: PASS.
- IDE diagnostics for changed production files: PASS.

The repository-wide build-check reached and passed all package/application builds. Its global lint
and aggregate test wrapper remain blocked by pre-existing broker-sdk generated declaration lint
errors and a missing local `uuid` test module; neither blocker is in the Multi-Asset change set.
