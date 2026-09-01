# ML Lifecycle

## Product boundary

```text
ML predicts
  → Trade Intelligence interprets
  → evaluateTrade
  → Risk → Portfolio → Policy → Gate → Execution
```

ML never authorizes trades. Kafka `predictions.*` events are consumer feeds only.

P5 evidence / P6 ARM / LIVE unlock are **independent** of this ML work.

See also: [T1 Trade Intelligence / Alpha](./t1-trade-intelligence-alpha.md) (observe-only layer between ML and evaluateTrade).

## Roadmap

| Phase  | Focus                          | Status                                                                                  |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------- |
| **M1** | Trust / provenance / freshness | **COMPLETE** (verified)                                                                 |
| **M2** | Validation / calibration       | **COMPLETE** (candidate→WF→calibrate→promote)                                           |
| **M3** | Market realism / richer labels | **COMPLETE** (PIT universe, ADJUSTED cross-path hard fail, path labels, cost/imbalance) |
| **M4** | Serving / drift                | **COMPLETE** (ACTIVE-only serve, drift stamps, MLPredictionSnapshot)                    |

M2/M3/M4 promotion and drift thresholds are **ML criteria only** — they do not affect trading authorization (Risk / Portfolio / Policy / Gate).

## ML Lab (orchestrator UI)

Status: **Phase 1–5 shipped** (ML Lab complete).

```text
ML Lab UI → API Gateway → ml-engine jobs / lifecycle / registry / promote / overview / evaluations / drift / reports → existing M1–M4
                       ↘ market-data /market/data-contract + /market/ml-ti-bridge (status only)
```

| Route                 | Role                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `/ml-lab`             | Overview — counts, active-by-horizon, current job, evaluation presence |
| `/ml-lab/ingestion`   | Feature ingest jobs + market data-contract panel (**status only**)     |
| `/ml-lab/dataset`     | Read-only `dataset-quality.json` (M2)                                  |
| `/ml-lab/validation`  | Read-only holdout + walk-forward reports (M2)                          |
| `/ml-lab/predictions` | Latest served predictions (M4 ACTIVE models)                           |
| `/ml-lab/monitoring`  | Drift reports + scored accuracy (M4)                                   |
| `/ml-lab/ti-bridge`   | Observational ML → Trade Intelligence usability (**not** trade auth)   |
| `/ml-lab/reports`     | Catalog of existing M2–M4 artifacts (presence + deep links)            |
| `/ml-lab/registry`    | Model list + **Promote** (server gates; UI never decides)              |
| `/ml-lab/jobs`        | Staged lifecycle + component jobs (observation + start/cancel)         |

APIs:

| Method | Path                            | Notes                                                                        |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/ml/registry`              | Optional `horizon`, `status`                                                 |
| GET    | `/api/ml/registry/active`       | Active model per core horizon                                                |
| POST   | `/api/ml/promote`               | Body `{ horizon, modelId? }` — 400 on gate failure                           |
| GET    | `/api/ml/overview`              | Registry counts + job snapshot + evaluation flags                            |
| GET    | `/api/ml/evaluations`           | holdout / walkForward / mlBacktest / **datasetQuality** (read-only)          |
| GET    | `/api/ml/drift`                 | Per-horizon M4 drift JSON (read-only)                                        |
| GET    | `/api/ml/reports`               | Catalog of existing report artifacts (presence + lab paths)                  |
| GET    | `/api/ml/lifecycle/latest`      | Latest staged lifecycle run (stages + statuses)                              |
| GET    | `/api/ml/lifecycle/runs/:runId` | One persisted lifecycle run                                                  |
| GET    | `/api/predictions`              | Latest predictions (M4 fields when cached)                                   |
| GET    | `/api/predictions/accuracy`     | Scored accuracy artifact                                                     |
| GET    | `/api/market/data-contract`     | `ingestMode`, `quoteStatus`, `liveUsable`, session flag — **not** trade auth |
| GET    | `/api/market/ml-ti-bridge`      | Usable vs rejected ML rows for TI — **not** trade auth                       |

### Lifecycle orchestration (Jobs)

One staged DAG that **calls existing M1–M4 modules** — does not reimplement train/WF/promote/predict.

```text
FULL_ML_LIFECYCLE (job kind: ml_lifecycle_full)
  INGEST → TRAIN_CANDIDATE → DATA_QUALITY → WALK_FORWARD → CALIBRATION
  → PROMOTE_IF_GATES_PASS → PREDICT (ACTIVE only) → DRIFT_SCORE → REPORT

INCREMENTAL_ML_REFRESH (job kind: ml_lifecycle_refresh)
  INGEST → PREDICT (ACTIVE required) → DRIFT_SCORE → REPORT
```

Stage statuses: `PENDING | RUNNING | PASSED | FAILED | SKIPPED | BLOCKED`.

Persisted under `{ML_MODELS_DIR}/lifecycle-runs/{runId}.json` (+ `latest.json`).

```text
CLI:  python -m app.lifecycle --mode full|refresh --universe nifty50
      python -m app.lifecycle --mode full --resume
      python -m app.lifecycle --mode full --from-stage TRAIN_CANDIDATE
```

Promotion remains server-side and gate-controlled. If promote is BLOCKED, model stays CANDIDATE and PREDICT/DRIFT are SKIPPED (refresh fails hard without ACTIVE).

Boundary: lifecycle ends at predictions / TI usability — **no BUY / SELL / ARM**, no Risk / Portfolio / Policy / Gate / P5 / P6 changes.

Contract:

```text
Train → CANDIDATE only
Promote → ACTIVE only after server-side gates
ML Lab never BUY / SELL / ARM LIVE
Data status ≠ trade authorization
Dataset / Validation = existing M2 artifacts only (no new train logic in React)
Predictions / Monitoring / TI bridge = existing M4 serving + MDS usability only
Reports hub = index of existing artifacts only (no new report generation)
Lifecycle job = orchestrate existing modules only (no duplicated ML logic)
```

Ingest modes (`LIVE_INGEST` / `EOD_INGEST` / `HISTORICAL_BACKFILL`) and quote statuses (`LIVE` / `CLOSED_MARKET` / `STALE`) are **informational**. Risk still enforces the 60s quote-age gate.

ML → TI: only **fresh + drift-compatible** predictions may influence Trade Intelligence / advisory. The Lab bridge is observational and does **not** change Risk / Portfolio / Policy / Gate.

## M3 progression

```text
Historical Universe (as-of)
  → Canonical ADJUSTED price policy
  → Leakage-safe dataset
  → Classification + forwardReturn / MFE / MAE labels
  → Dataset quality (PIT membership + price policy)
  → Train → Candidate (+ path regressors)
  → Walk-forward + stability
  → Cost-aware + imbalance evaluation
  → Calibration
  → Promote ACTIVE
  → Serve calibratedProbabilities + expectedReturn/Mfe/Mae (advisory)
```

Strict boundary: `expectedReturn` / `expectedMfe` / `expectedMae` / `calibratedProbabilities` are **ML → Trade Intelligence only**. They never feed Risk / Portfolio / Policy / Gate.

## M3 deliverables

1. **Historical universe (PIT)** — `app/historical_universe.py`  
   Snapshots under `{ML_MODELS_DIR}/universe-snapshots/`. Bars filtered by as-of membership.

2. **Canonical adjusted prices + hard cross-path enforcement** — `app/price_policy.py`  
   Provider adj → corp-actions.json → synthetic/unverified identity (explicit stamp).  
   No silent raw labeling. **Hard fail** unless every path is ADJUSTED:

   ```text
   TRAIN    → assert_canonical_mode()
   PREDICT  → assert_canonical_mode() (+ assert_same_mode vs train metadata)
   BACKTEST → assert_canonical_mode() (+ assert_same_mode vs train metadata)
   OUTCOME  → assert_same_mode() / assert_outcome_modes()
   ```

   `ADJUSTED + ADJUSTED + ADJUSTED + ADJUSTED` → pass. Any `RAW` → `PricePolicyError`.

3. **Path labels + regressors** — `app/path_labels.py`, `app/regressors.py`  
   Classification primary; secondary heads for forwardReturn / MFE / MAE. Predict emits advisory fields only.

4. **Cost-aware + imbalance metrics** — `app/eval_metrics.py`  
   Wired into holdout / walk-forward / promote evidence (not Gate).

5. **Dataset quality extensions** — membership + price-policy hard fails.

6. **Tests** — `tests/test_m3_market_realism.py`, `tests/test_m3_price_policy_crosspath.py` (+ M1/M2 still green).

## M2 progression

```text
Dataset
  → DatasetQualityReport (hard gates)
  → Train as CANDIDATE
  → Walk-forward (mean + fold stability)
  → OOS calibration
  → Promote ACTIVE
  → Serve calibratedProbabilities
```

ML promotion thresholds are **not** trading authorization or Risk/Portfolio thresholds:

```text
min_folds >= 3
mean_hit_rate >= 40.0   (percent)
worst_fold_hit_rate >= 30.0
hit_rate_std <= 12.0
```

Override via `ML_PROMOTE_MIN_FOLDS`, `ML_PROMOTE_MIN_MEAN_HIT`, `ML_PROMOTE_MIN_WORST_FOLD`, `ML_PROMOTE_MAX_HIT_STD`.

## M2 deliverables

1. **Dataset quality** — `app/dataset_quality.py`  
   PIT violations / empty rows / missingness ceilings hard-fail train. Persists `dataset-quality.json`.

2. **Candidate-first lifecycle** — `train` calls `register_model(..., activate=False)`.  
   Candidates are never served. Explicit `python -m app.promote --horizon ...`.

3. **Walk-forward promote gate** — `app/promote_gates.py` + enriched `walkforward.py`  
   Mean, worst-fold, std; unstable high-mean models stay candidates.

4. **OOS calibration** — `app/calibration.py`  
   Isotonic one-vs-rest on walk-forward OOS probs. Brier / log loss / reliability.  
   Predict emits `probabilities` (raw) and `calibratedProbabilities`.  
   Disclaimer: confidence ≠ calibrated probability.

5. **Registry promote** — `registry.promote_model` fills walkforward + calibration metrics and activates.

6. **Tests** — `tests/test_m2_validation.py` (+ M1 trust suite still green).

## M1 deliverables (foundation)

1. PIT enforcement — `app/pit.py`
2. FeatureSet version — `FEATURE_SET_VERSION`
3. Model registry — `{ML_MODELS_DIR}/registry/models.json`
4. Prediction provenance + TTL freshness
5. Train/serve feature-version parity

## Env knobs

```text
ML_MODELS_DIR
ML_MODEL_VERSION
ML_DATASET_VERSION
ML_PREDICTION_TTL_SECONDS   # default 21600
ML_DQ_MAX_MISSING_RATE      # default 0.05
ML_DQ_MIN_ROWS              # default 1
ML_DQ_REQUIRE_VERIFIED_ADJ  # default 0; set 1 to hard-fail unverified close-as-adjusted
ML_PROMOTE_MIN_FOLDS        # default 3
ML_PROMOTE_MIN_MEAN_HIT     # default 40
ML_PROMOTE_MIN_WORST_FOLD   # default 30
ML_PROMOTE_MAX_HIT_STD      # default 12
ML_PROMOTE_MIN_BALANCED_ACCURACY  # default 0.34
ML_PROMOTE_MIN_MINORITY_RECALL    # default 0.15
ML_PROMOTE_REQUIRE_NET_POSITIVE    # default 1
ML_PRICE_ALLOW_CLOSE_AS_ADJUSTED  # default 1 (explicit unverified stamp)
ML_DRIFT_PSI_WARN                 # default 0.1
ML_DRIFT_PSI_INCOMPATIBLE         # default 0.25
ML_DRIFT_Z_WARN                   # default 3.0
ML_DRIFT_MIN_OUTCOMES             # default 50; below → driftStatus=insufficient_data for calib
ML_DRIFT_REQUIRE_ACTIVE           # default 1 (registry-only; no models_dir/{horizon}/ fallback)
```

## M4 deliverables (serving contract + drift)

1. **Versioned candidates + ACTIVE-only serve** — train writes `{models_dir}/{horizon}/candidates/{modelId}/`; `get_models` resolves **only** via registry `get_active(horizon).artifactDir`. No ACTIVE / missing artifactDir → hard fail. Never fall back to `{models_dir}/{horizon}/`.
2. **Serving stamps** — every prediction includes `modelId`, provenance, and `driftStatus` (`ok|warn|incompatible|insufficient_data`). `confidence` ≠ `calibratedProbabilities`.
3. **Drift monitors** (`app/drift.py`) — feature PSI/z vs train `feature-baseline.json`; calibration Brier vs promote baseline **only when** outcome count ≥ `ML_DRIFT_MIN_OUTCOMES`, else `insufficient_data` (no silent tiny-sample scores). Feature `incompatible` wins. Warn/TI-unusable only — never auto-retrain / never Gate.
4. **Consumer reject** — prediction-cache `getUsable` / `isUsableMlPrediction` rejects `driftStatus=incompatible` (and stale/missing). `insufficient_data` alone does not reject.
5. **`MLPredictionSnapshot`** — optional on `IntelligenceSnapshot` for ledger audit; builder copies from usable ML payload only.
6. **Tests** — `tests/test_m4_serving_drift.py` + prediction-cache M4 specs.

## Explicit non-goals

- Auto-retrain / auto-promote on drift
- Changing agent walk-forward or P5 soak / P6 ARM criteria
- Feeding ML probabilities, path targets, or drift into Risk / Portfolio / Policy / Gate
