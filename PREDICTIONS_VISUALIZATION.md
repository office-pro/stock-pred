# How to View & Visualize Predictions

## Quick Views (CLI)

### 1. Summary Statistics

```bash
python ml/view-predictions.py summary
```

Shows:

- Total predictions count
- Unique symbols
- Direction distribution (UP/DOWN/SIDEWAYS %)
- Confidence analysis (mean, median, min, max)
- High confidence predictions (>65%)

### 2. Predictions Table

```bash
python ml/view-predictions.py table 30
```

Shows first 30 predictions in table format.

### 3. Filter by Direction

```bash
# Show only UP predictions
python ml/view-predictions.py up

# Show only DOWN predictions
python ml/view-predictions.py down
```

### 4. Single Stock Details

```bash
python ml/view-predictions.py symbol RELIANCE
```

Shows all predictions for one symbol with probabilities.

---

## Export Formats

### CSV (For Excel/Analysis)

```bash
python ml/view-predictions.py csv
# Creates: predictions.csv
```

Then open in Excel:

- Column A: Symbol
- Column B: Horizon
- Column C: Direction
- Column D: Confidence
- Column E: Expected Move
- Column F-H: Probabilities (DOWN, SIDEWAYS, UP)

### HTML (Interactive Dashboard)

```bash
python ml/view-predictions.py html
# Creates: predictions.html
# Open in browser: file://C:/Users/asus/stock-pred/predictions.html
```

Shows:

- Summary metrics (total predictions, unique symbols)
- Color-coded direction table
- Sortable and searchable

---

## Advanced CLI Viewing

### View ALL predictions formatted

```bash
cat predictions.jsonl | jq '.'
```

### View specific horizon only

```bash
# Next day predictions
cat predictions.jsonl | jq 'select(.horizon=="NEXT_DAY")'

# Next week predictions
cat predictions.jsonl | jq 'select(.horizon=="NEXT_WEEK")'
```

### Sort by confidence (highest first)

```bash
cat predictions.jsonl | jq -s 'sort_by(-.confidence) | .[]'
```

### High confidence predictions (>70%)

```bash
cat predictions.jsonl | jq 'select(.confidence>70)'
```

### All UP predictions sorted by confidence

```bash
cat predictions.jsonl | jq -s 'map(select(.direction=="UP")) | sort_by(-.confidence) | .[]'
```

### Summary by symbol

```bash
cat predictions.jsonl | jq -s 'group_by(.symbol) | map({symbol: .[0].symbol, count: length, directions: map(.direction) | unique})'
```

---

## PowerShell Alternative (Windows)

If you prefer PowerShell:

```powershell
# Show all predictions
Get-Content predictions.jsonl | ConvertFrom-Json

# Show high confidence UP predictions
Get-Content predictions.jsonl | ConvertFrom-Json | Where-Object { $_.direction -eq "UP" -and $_.confidence -gt 65 }

# Export to CSV
$predictions = Get-Content predictions.jsonl | ConvertFrom-Json
$predictions | Export-Csv -Path predictions.csv -NoTypeInformation
```

---

## What Each Field Means

```json
{
  "symbol": "RELIANCE", // Stock symbol
  "horizon": "NEXT_DAY", // Prediction timeframe (1 day or 5 days)
  "direction": "UP", // Predicted direction (UP, DOWN, SIDEWAYS)
  "confidence": 72.5, // How certain (0-100%)
  "expectedMove": 2.15, // Median % move if direction is correct
  "probabilities": {
    "DOWN": 15.2, // Prob of going DOWN %
    "SIDEWAYS": 12.3, // Prob of staying SIDEWAYS %
    "UP": 72.5 // Prob of going UP %
  },
  "modelVersion": "ensemble-v1" // Model version used
}
```

---

## Use Cases

### Case 1: Pre-market Screening

Find high-confidence UP signals for the day:

```bash
cat predictions.jsonl | jq 'select(.horizon=="NEXT_DAY" and .direction=="UP" and .confidence>65)'
```

Output:

```
{
  "symbol": "TCS",
  "direction": "UP",
  "confidence": 78.3,
  "horizon": "NEXT_DAY"
}
```

Action: Review TCS for potential long entry.

### Case 2: Risk Management

Find stocks with very high confidence (>75%):

```bash
cat predictions.jsonl | jq 'select(.confidence>75)'
```

These are the most reliable bets.

### Case 3: Contrarian Trading

Find SIDEWAYS predictions at high confidence (conflicting signals):

```bash
cat predictions.jsonl | jq 'select(.direction=="SIDEWAYS" and .confidence>70)'
```

### Case 4: Expected Move Analysis

Find stocks with large expected moves:

```bash
cat predictions.jsonl | jq 'select(.expectedMove>2.5)'
```

These are volatile stocks with bigger potential % moves.

### Case 5: Compare Horizons

See if NEXT_DAY and NEXT_WEEK disagree:

```bash
cat predictions.jsonl | jq -s 'group_by(.symbol) | map(select(length==2 and (.[0].direction != .[1].direction)))'
```

---

## Next: Integration

Once you understand the predictions:

1. **Auto-Trader Uses Them**: The platform automatically:
   - Fetches predictions every 5 minutes
   - Applies risk rules (position sizing, max loss)
   - Executes trades if conditions are met

2. **Signal Engine Uses Them**:
   - Combines predictions with technical indicators
   - Generates trading signals

3. **Monitor Integration**:

   ```bash
   # Watch auto-trader using predictions
   docker-compose logs auto-trader -f | grep -i prediction

   # Watch signal engine
   docker-compose logs signal-engine -f | grep -i direction
   ```

---

## Quick Reference

| Command                                                | Purpose                |
| ------------------------------------------------------ | ---------------------- |
| `python ml/view-predictions.py summary`                | Show statistics        |
| `python ml/view-predictions.py table 50`               | Show predictions table |
| `python ml/view-predictions.py up`                     | Show UP predictions    |
| `python ml/view-predictions.py symbol RELIANCE`        | Show one stock         |
| `python ml/view-predictions.py csv`                    | Export to CSV          |
| `python ml/view-predictions.py html`                   | Create HTML dashboard  |
| `cat predictions.jsonl \| jq '.' \| head -20`          | View raw JSON          |
| `cat predictions.jsonl \| jq 'select(.confidence>70)'` | Filter high confidence |
