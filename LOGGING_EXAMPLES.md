# Progress Bars with Detailed Logging

The progress bar scripts now log everything that's happening, with timestamps and emoji indicators.

## Logging Features

✨ **Live Logging Output**

- Timestamp for each log entry: `[HH:MM:SS]`
- Emoji indicators for log type
- Real-time progress bar updates
- All output captured and displayed

### Log Emoji Indicators

| Emoji | Meaning             | Examples                              |
| ----- | ------------------- | ------------------------------------- |
| ✓     | Success/Completion  | `[train] xgboost saved`               |
| ❌    | Error/Failure       | `ERROR:`, `Traceback`, `failed`       |
| ⚙️    | Processing/Activity | `processing`, `loading`, `predicting` |
| ⚠️    | Warning/Deprecated  | `WARNING:`, `deprecated`              |
| 📝    | Info/Other          | General messages                      |

---

## Example: Training ML Models

### Command

```bash
npm run train:ml
```

### Output (with logging)

```
🚀 Training ML Models

[10:23:45] 📝 Collecting market context...
[10:23:46] 📝 Loading 31 stocks from market-data-service...
[10:23:48] 📝 [train] horizon=short bars=5 threshold=0.001
[10:23:50] 📝 [train] loading candles for RELIANCE...
[10:23:51] 📝 [train] loading candles for TCS...
[10:23:52] 📝 [train] loading candles for INFY...
[10:23:53] 📝 Building features for 3000 samples...

📊 ML Training: [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 10%  Loading Data

[10:24:15] 📝 [train] dataset: 45230 samples x 42 features
[10:24:15] 📝 [train] class distribution: {'DOWN': 15410, 'NEUTRAL': 15120, 'UP': 14700}
[10:24:20] 📝 Scaling features...
[10:24:25] 📝 Fitting XGBoost model...

📊 ML Training: [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 20%  Building Features

[10:24:45] 📝 Training XGBoost with 45230 samples...
[10:24:55] ✓ [train] xgboost saved
[10:25:10] 📝 Training LightGBM...
[10:25:20] ✓ [train] lightgbm saved
[10:25:35] 📝 Training LSTM model...
[10:25:50] ✓ [train] lstm saved
[10:26:10] 📝 Training Transformer model...
[10:26:30] ✓ [train] transformer saved

📊 ML Training: [████████████████████░░░░░░░░░░░░░░░░░░░░░░░] 50%  Training Models

[10:26:35] 📝 Computing class move statistics...
[10:26:40] ✓ [train] scaler saved
[10:26:40] ✓ [train] metadata saved

📊 ML Training: [██████████████████████████████████████████████] 100%  Complete!

[10:26:45] ✓ Horizon short complete!
[10:26:50] 📝 [train] horizon=medium bars=20 threshold=0.002
[10:27:30] 📝 [train] dataset: 42500 samples x 42 features
[10:27:45] ✓ All models trained for horizon short

[10:27:50] 📝 [train] horizon=medium bars=20 threshold=0.002
... (medium horizon training)

[10:35:20] 📝 [train] horizon=long bars=60 threshold=0.003
... (long horizon training)

[10:42:30] ✓ All models trained successfully!

✅ Training Complete in 4m 23s

📁 Models saved to: ml-models/

Next steps:
  npm run predict           - Generate predictions
  npm run predict:view      - View prediction results
```

---

## Example: Generating Predictions

### Command

```bash
npm run predict:ml
```

### Output (with logging)

```
🚀 Generating Predictions

[14:30:15] 📝 Loading trained models...
[14:30:20] ✓ Loaded scaler
[14:30:22] ✓ Loaded short horizon models
[14:30:24] ✓ Loaded medium horizon models
[14:30:26] ✓ Loaded long horizon models

🔮 Predictions: [██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 5%  Loading models

[14:30:30] 📝 Fetching market data from market-data-service...
[14:30:32] 📝 Loading 120 stocks...
[14:30:35] ✓ Loaded stock universe (120 stocks)
[14:30:40] 📝 Loading latest candles for each stock...

🔮 Predictions: [████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 12%  Loading data

[14:30:50] 📝 Building features for predictions...
[14:30:52] 📝 Processing RELIANCE...
[14:30:53] 📝 Processing TCS...
[14:30:54] 📝 Processing INFY...
[14:30:55] 📝 Processing WIPRO...
[14:30:56] 📝 Processing BAJAJFINSV...

🔮 Predictions: [██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 18%  Computing features

[14:31:20] 📝 Running model predictions...
[14:31:22] 📝 Predicting for short horizon...
[14:31:25] 📝 [1/120] RELIANCE: UP (confidence: 0.87)
[14:31:26] 📝 [2/120] TCS: NEUTRAL (confidence: 0.65)
[14:31:27] 📝 [3/120] INFY: DOWN (confidence: 0.72)
[14:31:28] 📝 [4/120] WIPRO: UP (confidence: 0.58)
[14:31:29] 📝 [5/120] BAJAJFINSV: UP (confidence: 0.81)

🔮 Predictions: [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 25%  Running Predictions

[14:31:45] 📝 [25/120] BHARTIARTL: UP (confidence: 0.73)
[14:31:46] 📝 [26/120] HEROMOTOCORP: NEUTRAL (confidence: 0.61)
[14:31:47] 📝 [27/120] TATAMOTORS: DOWN (confidence: 0.68)
[14:31:48] 📝 [28/120] MARUTI: UP (confidence: 0.79)

🔮 Predictions: [████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 50%  Processing 54/120 stocks

[14:32:15] 📝 [50/120] KOTAK: UP (confidence: 0.84)
[14:32:16] 📝 [51/120] SBIN: NEUTRAL (confidence: 0.62)
[14:32:17] 📝 [52/120] ICICIBANK: UP (confidence: 0.75)

🔮 Predictions: [████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 70%  Processing 92/120 stocks

[14:32:40] 📝 [100/120] ADANIGREEN: UP (confidence: 0.71)
[14:32:41] 📝 [101/120] POWERGRID: NEUTRAL (confidence: 0.64)
[14:32:42] 📝 [120/120] NESTLEIND: UP (confidence: 0.88)

🔮 Predictions: [████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░] 85%  Processing 120/120 stocks

[14:32:50] 📝 Computing statistics...
[14:32:52] ✓ Summary: UP: 65 stocks, NEUTRAL: 35 stocks, DOWN: 20 stocks
[14:32:55] 📝 Writing results to predictions.jsonl...
[14:33:00] ✓ Saved 120 predictions

🔮 Predictions: [██████████████████████████████████████████████] 100%  Complete!

[14:33:05] ✓ Predictions generated successfully!

✅ Predictions Generated in 2m 15s

📊 Results saved to: predictions.jsonl

Next steps:
  npm run predict:view      - View predictions
  npm run predict:view:html - Export as HTML
  npm run predict:view:csv  - Export as CSV
```

---

## Example: Error Handling

### Command with error

```bash
npm run train:ml
```

### Output (with error logging)

```
🚀 Training ML Models

[15:10:30] 📝 Loading market context...
[15:10:35] 📝 Loading stocks from market-data-service...
[15:10:40] ❌ ERROR: Connection refused (market-data-service not running)
[15:10:40] ❌ Traceback (most recent call last):
[15:10:40] ❌   File "ml/train.py", line 45, in <module>
[15:10:40] ❌     market = load_market_context(1500)
[15:10:40] ❌ ConnectionRefusedError: [Errno 111] Connection refused

📊 ML Training: [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 15%  Loading Data

❌ Training Failed (exit code 1)

Troubleshooting:
  1. Start the platform: npm run start:all
  2. Wait for market-data-service to be healthy
  3. Try again: npm run train:ml
```

---

## Example: Batch Processing

### Command

```bash
npm run predict:batch
```

### Output (with batch logging)

```
🚀 Generating Predictions

[16:45:20] 📝 Loading models from ml-models/...
[16:45:25] ✓ Models loaded (short, medium, long horizons)
[16:45:30] 📝 Processing batch mode (30 stocks per batch)...

🔮 Predictions: [██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 8%  Loading data

[16:45:40] 📝 [BATCH 1] Processing stocks 1-30...
[16:45:42] 📝 [1/30] RELIANCE
[16:45:43] 📝 [2/30] TCS
[16:45:44] 📝 [3/30] INFY
... (25 more stocks)
[16:46:20] ✓ Batch 1 complete (30 stocks)

🔮 Predictions: [████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 35%  Processing batch 1/4

[16:46:25] 📝 [BATCH 2] Processing stocks 31-60...
[16:46:27] 📝 [31/60] WIPRO
[16:46:28] 📝 [32/60] BAJAJFINSV
... (28 more stocks)
[16:47:00] ✓ Batch 2 complete (30 stocks)

🔮 Predictions: [████████████████████░░░░░░░░░░░░░░░░░░░░░░░░] 62%  Processing batch 2/4

[16:47:05] 📝 [BATCH 3] Processing stocks 61-90...
... (30 stocks)
[16:47:40] ✓ Batch 3 complete (30 stocks)

🔮 Predictions: [██████████████████████████░░░░░░░░░░░░░░░░░░░] 75%  Processing batch 3/4

[16:47:45] 📝 [BATCH 4] Processing stocks 91-120...
... (30 stocks)
[16:48:20] ✓ Batch 4 complete (30 stocks)

🔮 Predictions: [██████████████████████████████████████████████] 100%  Complete!

[16:48:25] ✓ All 120 stocks processed
[16:48:30] ✓ Results saved to predictions.jsonl

✅ Predictions Generated in 3m 10s
```

---

## Log Filtering

You can filter logs to see only specific information:

```bash
# See only training milestones
npm run train:ml 2>&1 | grep "✓\|saved\|horizon"

# See only errors
npm run train:ml 2>&1 | grep "❌"

# See only predictions
npm run predict:ml 2>&1 | grep "\[.*\/.*\]"

# Save logs to file
npm run train:ml 2>&1 | tee train.log

# Follow logs in another terminal
tail -f train.log
```

---

## Real-Time Monitoring

### Two-Terminal Setup

Terminal 1 (Run training):

```bash
npm run train:ml
```

Terminal 2 (Monitor logs):

```bash
# Watch the log file being created
tail -f train.log
```

Terminal 3 (Optional - Check system resources):

```bash
# Monitor CPU/Memory
docker compose stats
```

---

## Log Retention

Logs are displayed in real-time. To save them:

```bash
# Save to file
npm run train:ml > train-$(date +%Y%m%d-%H%M%S).log 2>&1

# Or
npm run train:ml 2>&1 | tee train-run.log

# View saved logs
cat train-run.log
```

---

## Timestamp Format

Logs use 24-hour format with millisecond precision:

```
[10:23:45] - 10 hours, 23 minutes, 45 seconds
[14:30:15] - 14 hours, 30 minutes, 15 seconds
[23:59:59] - 23 hours, 59 minutes, 59 seconds
```

---

## Summary

The updated progress bar scripts now:

✅ **Log Everything**

- Every operation logged with timestamp
- All output captured and displayed
- Errors highlighted with ❌
- Success marked with ✓

✅ **Real-Time Visibility**

- See what's happening as it happens
- Progress bar + detailed logs
- No hidden operations
- Complete transparency

✅ **Easy Debugging**

- Timestamps help identify bottlenecks
- Error messages show exactly what failed
- Log files can be saved for analysis
- Easy to track progress across runs

Try it now:

```bash
npm run train:ml    # See detailed logging with progress
npm run predict:ml  # Watch predictions being generated
```
