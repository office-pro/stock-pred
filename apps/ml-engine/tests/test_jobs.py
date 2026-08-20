from app.jobs import apply_progress, npm_script


def test_parses_feature_progress():
    job = {"kind": "train_manipulation", "percent": 0, "horizonsSeen": []}
    apply_progress(job, "[train-manipulation] features 4025/4566 (kept 3609, skipped 398)")
    assert job["current"] == 4025
    assert job["total"] == 4566
    assert job["percent"] >= 70
    assert "4025/4566" in job["stage"]


def test_parses_batch_and_universe():
    job = {"kind": "predict_all", "percent": 0}
    apply_progress(job, "Listed book: 4566 symbols from market-data-service")
    assert job.get("total") in (None, 0)
    apply_progress(job, "[universe] nifty50: 50 constituents (skipped full listed-book scan)")
    assert job["total"] == 50
    apply_progress(job, "[batch] scoring 50 symbols universe=nifty50")
    assert job["total"] == 50
    apply_progress(job, "[batch] 12/50 scoring RELIANCE")
    assert job["current"] == 12
    assert job["total"] == 50
    assert job["percent"] > 0


def test_listed_book_line_is_not_the_job_universe():
    job = {"kind": "train_all", "percent": 0, "horizonsSeen": []}
    apply_progress(job, "Listed book: 4566 symbols from market-data-service")
    apply_progress(job, "[universe] nifty50: 50 constituents (skipped full listed-book scan)")
    apply_progress(job, "[train] universe: 50 symbols (nifty50), 1500 days, synthetic=False")
    assert job["total"] == 50


def test_npm_script_uses_dedicated_nifty_commands():
    assert npm_script("ingest_fundamentals", "nifty50") == (
        "npm run ingest:fundamentals -- --universe nifty50"
    )
    assert npm_script("ingest_fundamentals", "all") == (
        "npm run ingest:fundamentals -- --universe all"
    )
    assert npm_script("run_all", "nifty500") == "python -m app.run_all --universe nifty500"
    assert npm_script("train_all", "nifty50") == "npm run train:ml:nifty50"
    assert npm_script("train_all", "nifty100") == "npm run train:ml:nifty100"
    assert npm_script("train_all", "nifty500") == "npm run train:ml:nifty500"
    assert npm_script("train_all", "all") == "npm run train:ml:all"
    assert npm_script("predict_all", "nifty50") == "npm run predict:nifty50"
    assert npm_script("predict_all", "all") == "npm run predict:all"
    assert npm_script("walk_forward", "nifty50") == "npm run walkforward:nifty50"
    assert npm_script("walk_forward", "all") == "npm run walkforward:ml"
    assert npm_script("ml_backtest", "nifty100") == "npm run backtest:ml:nifty100"
    assert npm_script("ml_backtest", "all") == "npm run backtest:ml"
    assert npm_script("train_manipulation", "nifty100") == "npm run train:ml:manipulation:nifty100"
    assert npm_script("train_manipulation", "all") == "npm run train:ml:manipulation"


def test_missing_models_message_points_at_universe_train():
    from app.jobs import missing_models_message

    assert "train:ml:nifty500" in missing_models_message("nifty500")
    assert "train:ml:nifty50" in missing_models_message("nifty50")
    assert "train:ml:all" in missing_models_message("all")


def test_parses_walkforward_folds():
    job = {"kind": "walk_forward", "percent": 0}
    apply_progress(job, "[walkforward] fold 2/4 year=2024 train=800 test=200")
    assert job["current"] == 2
    assert job["total"] == 4
    assert job["percent"] > 40


def test_train_all_splits_horizons():
    job = {"kind": "train_all", "percent": 0, "horizonsSeen": []}
    apply_progress(job, "[train] universe: 100 symbols, 1500 days, synthetic=False")
    apply_progress(job, "[train] horizon=NEXT_DAY bars=1 threshold=0.01")
    apply_progress(job, "[train] features 50/100 (kept 48, skipped 2)")
    first = job["percent"]
    apply_progress(job, "[train] horizon=NEXT_WEEK bars=5 threshold=0.02")
    apply_progress(job, "[train] features 50/100 (kept 48, skipped 2)")
    assert job["percent"] > first
    apply_progress(job, "[train] done. Predictions are probabilistic - this is not investment advice.")
    assert job["percent"] == 100


def test_parses_fundamentals_ingest_progress():
    job = {"kind": "ingest_fundamentals", "percent": 0}
    apply_progress(job, "[universe] nifty50: 50 constituents")
    apply_progress(job, "[fundamentals] 12/50 RELIANCE: 4 snapshots")
    assert job["current"] == 12
    assert job["total"] == 50
    assert job["percent"] > 0
    apply_progress(job, "[fundamentals] done ok=48 failed=2 rows=190")
    assert job["percent"] == 100


def test_parses_news_ingest_progress():
    job = {"kind": "ingest_news", "percent": 0}
    apply_progress(job, "[universe] nifty50: 50 constituents")
    apply_progress(job, "[news] 3/50 RELIANCE: 4 daily rows")
    assert job["current"] == 3
    assert job["total"] == 50
    apply_progress(job, "[news] done ok=40 failed=10 rows=80")
    assert job["percent"] == 100


def test_npm_script_alt_data_jobs():
    assert npm_script("ingest_alt_data", "nifty50") == "python -m app.ingest_alt --universe nifty50"
    assert npm_script("ingest_macro", "nifty50") == "python -m app.ingest_macro"
    assert npm_script("ingest_news", "nifty50") == "python -m app.ingest_news --universe nifty50"
    assert npm_script("ingest_social", "all") == "python -m app.ingest_social --universe all"


def test_alt_data_job_does_not_complete_on_inner_macro_done():
    job = {"kind": "ingest_alt_data", "percent": 0, "horizonsSeen": []}
    apply_progress(job, "[alt-data] step 1/3 ingest_macro")
    apply_progress(job, "[macro] done observations=100 daily=80")
    assert job["percent"] < 100
    apply_progress(job, "[alt-data] step 3/3 ingest_social")
    apply_progress(job, "[alt-data] done")
    assert job["percent"] == 100


def test_run_all_blurb_is_incremental():
    from app.jobs import JOB_SPECS

    assert "Incremental" in str(JOB_SPECS["run_all"]["blurb"])


def test_parses_run_all_steps():
    job = {"kind": "run_all", "percent": 0, "horizonsSeen": []}
    apply_progress(job, "[run-all] step 2/6 train_all")
    assert job["current"] == 2
    assert job["total"] == 6
    assert job["percent"] > 0
    apply_progress(job, "[run-all] done")
    assert job["percent"] == 100
