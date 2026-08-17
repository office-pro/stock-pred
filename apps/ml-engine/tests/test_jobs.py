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
    assert npm_script("train_all", "nifty50") == "npm run train:ml:nifty50"
    assert npm_script("train_all", "nifty100") == "npm run train:ml:nifty100"
    assert npm_script("train_all", "nifty500") == "npm run train:ml:nifty500"
    assert npm_script("train_all", "all") == "npm run train:ml:all"
    assert npm_script("predict_all", "nifty50") == "npm run predict:nifty50"
    assert npm_script("predict_all", "all") == "npm run predict:all"
    assert npm_script("train_manipulation", "nifty100") == "npm run train:ml:manipulation:nifty100"
    assert npm_script("train_manipulation", "all") == "npm run train:ml:manipulation"


def test_missing_models_message_points_at_universe_train():
    from app.jobs import missing_models_message

    assert "train:ml:nifty500" in missing_models_message("nifty500")
    assert "train:ml:nifty50" in missing_models_message("nifty50")
    assert "train:ml:all" in missing_models_message("all")


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
