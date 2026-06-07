# ML Pipeline Guide: Train & Predict for All NSE/BSE Stocks

## Overview

The ML pipeline uses **pooled ensemble training** on the entire stock universe to create shared models that can predict direction for ANY stock. This approach is more robust than per-stock models because:

- Uses all available market data to train
- Captures universal market patterns (momentum, volatility, index correlation)
- One model set works for all stocks (economies of scale)
- No overfitting to individual stock quirks

## Architecture

```
Market Data Service (129+ stocks)
          ↓
    Load Candles & Market Context (Nifty, VIX)
          ↓
    Build Features (technical + market context)
          ↓
    [TRAINING] Pool all stocks → Train 4 ensemble models per horizon
    [PREDICTION] Any stock → Score with shared models
```

### Models Per Horizon

- **XGBoost** (40% weight) - captures nonlinear patterns
- **LightGBM** (25% weight) - handles complex interactions
- **LSTM** (20% weight) - learns temporal sequences
- **Transformer** (15% weight) - attention-based relationships

### Horizons

- **NEXT_DAY**: 1-bar, 1% threshold
- **NEXT_WEEK**: 5-bar, 2% threshold

---

## Step 1: Train Models (First Time)

The first time, train on all 1500 days of history across all available stocks:

```bash
# Local training (requires installed dependencies)
npm run train:ml
# or: python ml/train.py

# Docker training (uses container environment - recommended)
npm run train:ml:docker
```

This will:

1. Fetch all symbols from running market-data-service
2. Load 1500 days of real candles per symbol
3. Skip symbols without sufficient data (prints warnings)
4. Pool features across all symbols
5. Train 4 models for each horizon
6. Save artifacts to `./ml-models/NEXT_DAY/` and `./ml-models/NEXT_WEEK/`

**Output:**

```
[train] universe: 129 symbols, 1500 days, synthetic=false
[train] horizon=NEXT_DAY bars=1 threshold=0.01
[train] dataset: 185432 samples x 28 features
[train] class distribution: {'DOWN': 61477, 'SIDEWAYS': 62188, 'UP': 61767}
[train] xgboost saved
[train] lightgbm saved
[train] lstm saved
[train] transformer saved
[train] NEXT_DAY artifacts written to ./ml-models/NEXT_DAY/
...
[train] done. Predictions are probabilistic - this is not investment advice.
```

### Retraining Strategy

- **Weekly**: `npm run train:ml` - keeps models fresh with latest data
- **Monthly**: `npm run train:ml -- --days 1500` - full retraining on extended history
- **Quick test**: `python ml/train.py --symbols RELIANCE,TCS,INFY` - validate on 3 stocks

---

## Step 2: Predict for Stocks

Once models are trained, predict for any stock:

### Single Stock

```bash
npm run predict RELIANCE
npm run predict RELIANCE TCS INFY
```

### Batch Predictions (All Stocks)

```bash
# Predict all 129 stocks, save to predictions.jsonl
npm run predict:batch

# Predict first 50 stocks (faster for quick testing)
npm run predict:batch:limit

# Predict specific stocks
python ml/batch-predict.py --symbols RELIANCE,TCS,INFY,HDFCBANK
```

### Via HTTP API (Recommended)

The ML engine is already running in the platform. Hit it directly:

```bash
curl http://localhost:3000/api/predictions/RELIANCE | jq

# Response example:
{
  "symbol": "RELIANCE",
  "direction": "UP",
  "confidence": 0.72,
  "expectedMove": 2.15,
  "horizon": "NEXT_DAY",
  "probabilities": {
    "DOWN": 0.15,
    "SIDEWAYS": 0.13,
    "UP": 0.72
  },
  "modelVersion": "ensemble-v1"
}
```

### Prediction Output

```json
{
  "symbol": "RELIANCE",
  "horizon": "NEXT_DAY", // or NEXT_WEEK
  "direction": "UP", // DOWN, SIDEWAYS, UP
  "confidence": 0.72, // 0.0 to 1.0
  "expectedMove": 2.15, // median % move if direction occurs
  "probabilities": {
    // ensemble blend
    "DOWN": 0.15,
    "SIDEWAYS": 0.13,
    "UP": 0.72
  },
  "modelVersion": "ensemble-v1"
}
```

---

## Workflow Examples

### Example 1: Weekend Training

Every Sunday night, retrain on latest data:

```bash
# Full retrain (all stocks, 1500 days)
STOCK_UNIVERSE_MODE=full-universe npm run start:all-stocks

# In another terminal
npm run train:ml

# Then generate predictions for Monday
npm run predict:batch > predictions-monday.jsonl
```

### Example 2: Continuous Predictions

The platform runs automatic predictions every 5 minutes:

- Hits the ML engine automatically
- Updates signal-engine with new probabilities
- Auto-trader uses predictions + risk rules for execution

Check the auto-trader logs:

```bash
docker-compose logs auto-trader | tail -20
```

### Example 3: Research/Backtesting

```bash
# Train on first 1000 days only (for holdout testing)
python ml/train.py --days 1000

# Predict on last 500 days (unseen by model)
npm run predict RELIANCE > holdout-predictions.jsonl

# Backtest against real returns
npm run backtest
```

---

## Troubleshooting

### "No trained models for NEXT_DAY"

Models haven't been trained yet.

```bash
npm run train:ml
```

### "Not enough feature history for SYMBOL"

Symbol needs at least 30 days of data (SEQUENCE_LENGTH).

- Check: `curl http://localhost:3002/stocks/SYMBOL/candles?limit=60`
- If empty: symbol not yet in market-data cache, wait for it to populate

### "No real market data available"

Market-data-service is offline or symbol has no data.

- Check service: `docker-compose logs market-data-service`
- Check data: `curl http://localhost:3002/stocks | head -20`

### Training hangs on a symbol

Set a timeout or skip problematic symbols:

```bash
python ml/train.py --symbols RELIANCE,TCS,INFY,HDFCBANK
```

---

## Model Artifacts

After training, you have:

```
./ml-models/
├── NEXT_DAY/
│   ├── xgboost.json          # Tree ensemble
│   ├── lightgbm.txt          # Gradient boosting
│   ├── lstm.pt               # RNN weights
│   ├── transformer.pt        # Attention weights
│   ├── scaler.json           # Feature normalization
│   └── metadata.json         # Training stats
└── NEXT_WEEK/
    ├── xgboost.json
    ├── lightgbm.txt
    ├── lstm.pt
    ├── transformer.pt
    ├── scaler.json
    └── metadata.json
```

Inspect training stats:

```bash
cat ml-models/NEXT_DAY/metadata.json | jq
```

---

## Performance Tips

1. **Parallel Training**: Train on Docker (faster, uses GPU if available)

   ```bash
   npm run train:ml:docker
   ```

2. **Batch Predictions**: Use `batch-predict.py` for all stocks at once

   ```bash
   npm run predict:batch > predictions.jsonl
   ```

3. **Reuse Models**: Models are cached in memory after first load

   ```bash
   npm run predict RELIANCE TCS INFY  # All use same cached models
   ```

4. **API Caching**: The platform caches predictions for 5 minutes
   ```bash
   curl http://localhost:3000/api/predictions/RELIANCE  # First call: ~100ms
   curl http://localhost:3000/api/predictions/RELIANCE  # Second call: <1ms
   ```

---

## Integration with Auto-Trader

The auto-trader uses ML predictions automatically:

1. Every 5 minutes (configurable), fetch predictions for all signals
2. Apply ensemble predictions + risk rules (position size, max loss)
3. Execute trades if conditions met

Check the flow:

```bash
docker-compose logs signal-engine | grep -i "ml\|prediction"
docker-compose logs auto-trader | grep -i "execute\|trade"
```

---

## FAQ

**Q: Why pool all stocks instead of per-stock models?**
A: Universal patterns are stronger than individual stock quirks. Pooling gives:

- 10x more training data (129 stocks × 1500 days = 185k samples)
- Better generalization (less overfitting)
- No need to retrain when adding new stocks

**Q: How often should I retrain?**
A: Weekly is good. Monthly for deeper analysis. The models adapt to recent market regimes.

**Q: Can I weight certain stocks higher?**
A: Currently no, but you can train on a subset: `python ml/train.py --symbols RELIANCE,TCS,INFY`

**Q: What's the expected accuracy?**
A: Direction prediction (UP/DOWN/SIDEWAYS) is ~55-60% on unseen data. The confidence score reflects uncertainty.

**Q: Can I use synthetic data?**
A: Yes, for testing offline: `python ml/train.py --synthetic`. Real data is always preferred.

---

## Full Command Reference

| Task                         | Command                                               |
| ---------------------------- | ----------------------------------------------------- |
| Train on all stocks          | `npm run train:ml`                                    |
| Train via Docker             | `npm run train:ml:docker`                             |
| Train on subset              | `python ml/train.py --symbols RELIANCE,TCS,INFY`      |
| Train on synthetic (offline) | `python ml/train.py --synthetic`                      |
| Predict one stock            | `npm run predict RELIANCE`                            |
| Predict multiple             | `npm run predict RELIANCE TCS INFY`                   |
| Predict all stocks           | `npm run predict:batch`                               |
| Predict first 50             | `npm run predict:batch:limit`                         |
| Via API                      | `curl http://localhost:3000/api/predictions/RELIANCE` |
| Check models                 | `cat ml-models/NEXT_DAY/metadata.json`                |
| View training code           | `vi apps/ml-engine/app/train.py`                      |
| View prediction code         | `vi apps/ml-engine/app/predict.py`                    |
