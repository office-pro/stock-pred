# ML Pipeline Quick Start

## TL;DR

```bash
# 1. Start platform with all 129+ stocks (already running)
npm run start:all-stocks

# 2. Train models on all stocks (pooled ensemble)
npm run train:ml

# 3. Predict for any stock
npm run predict RELIANCE TCS INFY
# or batch predict all
npm run predict:batch

# 4. Check results via API
curl http://localhost:3000/api/predictions/RELIANCE | jq '.direction, .confidence'
```

## How It Works

```
┌─────────────────────────────────────────┐
│ Market Data Service (129+ NSE/BSE stocks)
└────────────────┬────────────────────────┘
                 │ Load Candles (1500 days)
                 ↓
┌─────────────────────────────────────────┐
│ TRAINING: Pool all stocks               │
│ ├─ Technical features (RSI, MACD, etc)  │
│ ├─ Market context (Nifty, VIX trends)  │
│ └─ Train 4 ensemble models per horizon  │
└────────────────┬────────────────────────┘
                 │ Save models to ./ml-models/
                 ↓
┌─────────────────────────────────────────┐
│ PREDICTION: Score ANY stock             │
│ ├─ Input: Symbol, historical candles   │
│ ├─ Ensemble vote: XGB, LGBM, LSTM, TXF │
│ └─ Output: Direction, Confidence       │
└─────────────────────────────────────────┘
```

## Key Insight

**One model set works for ALL stocks** because they're trained on pooled data from the entire universe. This is better than per-stock models because:

- ✅ More training data (185k samples vs 1.5k per stock)
- ✅ Captures universal market patterns
- ✅ No overfitting to individual stocks
- ✅ Automatically works for new stocks when added

## Predictions Include

```json
{
  "symbol": "RELIANCE",
  "direction": "UP", // DOWN, SIDEWAYS, UP
  "confidence": 0.72, // 0-1, higher is more certain
  "expectedMove": 2.15, // median % move if correct
  "horizon": "NEXT_DAY", // NEXT_DAY or NEXT_WEEK
  "probabilities": {
    "DOWN": 0.15,
    "SIDEWAYS": 0.13,
    "UP": 0.72
  }
}
```

## Use Cases

### Case 1: Pre-market Screening (Daily)

```bash
# Every morning, get predictions for all 129 stocks
npm run predict:batch > today-predictions.jsonl

# Filter high-confidence predictions
cat today-predictions.jsonl | jq 'select(.confidence > 0.65)'
```

### Case 2: Signal Integration

The auto-trader automatically uses predictions:

```bash
# Check what the auto-trader is doing
docker-compose logs auto-trader -f | grep -i prediction
```

### Case 3: Research

```bash
# Train on first 1000 days
python ml/train.py --days 1000

# Predict on remaining 500 days (holdout test)
npm run predict:batch > research-predictions.jsonl

# Compare against actual returns
npm run backtest
```

## First-Time Setup Checklist

- [x] Platform running (`npm run start:all-stocks`)
- [ ] Train models: `npm run train:ml` (takes 2-5 minutes)
- [ ] Test prediction: `npm run predict RELIANCE`
- [ ] Check API: `curl http://localhost:3000/api/predictions/RELIANCE`
- [ ] View details: `cat ml-models/NEXT_DAY/metadata.json | jq`

## Common Commands

```bash
# Training
npm run train:ml                    # Train on all stocks
npm run train:ml -- --days 1000     # Custom history depth
python ml/train.py --symbols A,B,C  # Specific stocks only

# Prediction
npm run predict RELIANCE TCS        # Single + batch
npm run predict:batch               # All 129 stocks
npm run predict:batch:limit         # First 50 (faster)

# API
curl http://localhost:3000/api/predictions/RELIANCE
curl http://localhost:3000/api/predictions?symbols=RELIANCE,TCS

# Inspect
cat ml-models/NEXT_DAY/metadata.json
docker-compose logs ml-engine -f
```

## What Happens During Training

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
```

## Troubleshooting

| Issue                         | Solution                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| "No trained models"           | Run `npm run train:ml`                                                   |
| "Not enough feature history"  | Symbol needs 30+ days of data. Wait for market-data-service to populate. |
| "market-data-service offline" | Check: `docker-compose logs market-data-service`                         |
| Prediction takes forever      | First load: 5-10s (models load from disk). Subsequent: <100ms (cached).  |

## Files Structure

```
stock-pred/
├── ml/
│   ├── train.py                    # Wrapper (delegates to ml-engine)
│   ├── predict.py                  # Wrapper (delegates to ml-engine)
│   └── batch-predict.py            # NEW: Batch predict all stocks
├── apps/ml-engine/
│   └── app/
│       ├── train.py                # Training pipeline
│       ├── predict.py              # Prediction pipeline
│       ├── features.py             # Feature engineering
│       ├── data.py                 # Data loading (candles, universe)
│       └── models/                 # XGB, LGBM, LSTM, Transformer
├── ml-models/                       # Generated after training
│   ├── NEXT_DAY/
│   │   ├── xgboost.json
│   │   ├── lightgbm.txt
│   │   ├── lstm.pt
│   │   ├── transformer.pt
│   │   ├── scaler.json
│   │   └── metadata.json
│   └── NEXT_WEEK/
│       └── (same structure)
└── ML_PIPELINE_GUIDE.md            # Full documentation
```

## Next Steps

1. **Train**: `npm run train:ml` (2-5 min)
2. **Verify**: `npm run predict RELIANCE` (should show UP/DOWN/SIDEWAYS)
3. **Batch**: `npm run predict:batch > all-predictions.jsonl` (1-2 min for 129 stocks)
4. **Integrate**: Auto-trader uses predictions automatically
5. **Monitor**: `docker-compose logs auto-trader -f`

## Expected Performance

- **Accuracy**: ~55-60% direction prediction (better than random)
- **Confidence**: Reflects model uncertainty (higher = more certain)
- **Latency**:
  - First prediction: 5-10s (models load)
  - Subsequent: <100ms (cached)
  - Batch 129 stocks: 1-2 minutes

---

For detailed docs, see: **ML_PIPELINE_GUIDE.md**
