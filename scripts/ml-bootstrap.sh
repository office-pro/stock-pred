#!/usr/bin/env bash
# After market-data is healthy: wait for daily history, train the configured
# universe (1500 days), then score every listed stock.
set -u
cd "$(dirname "$0")/.."

if [ -z "${SKIP_ML_BOOTSTRAP:-}" ] && [ -f .env ]; then
  skip_line=$(grep -E '^SKIP_ML_BOOTSTRAP=' .env | tail -1 || true)
  if [ -n "$skip_line" ]; then
    SKIP_ML_BOOTSTRAP="${skip_line#SKIP_ML_BOOTSTRAP=}"
    SKIP_ML_BOOTSTRAP="${SKIP_ML_BOOTSTRAP//$'\r'/}"
  fi
fi

if [ "${SKIP_ML_BOOTSTRAP:-0}" = "1" ]; then
  echo "==> Skipping ML train/predict (SKIP_ML_BOOTSTRAP=1)"
  exit 0
fi

echo "==> Waiting for historical daily candles from market-data-service"
ready=0
for i in $(seq 1 90); do
  body=$(curl -fsS --max-time 8 "http://localhost:3002/stocks/RELIANCE/candles?timeframe=1d&limit=50" 2>/dev/null || echo "")
  if echo "$body" | grep -q '"close"'; then
    ready=1
    echo "    daily history is available"
    break
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "    still waiting for candles... ($((i * 2))s)"
  fi
  sleep 2
done
if [ "$ready" != "1" ]; then
  echo "    WARNING: no RELIANCE candles yet; training will skip names without history"
fi

echo "==> Training ML models on the configured universe (1500 days)"
echo "    This can take a long time. Set SKIP_ML_BOOTSTRAP=1 to skip on the next start."
if ! docker compose exec -T ml-engine python -m app.train --days 1500; then
  echo "WARNING: train:ml:all failed inside ml-engine. Services are still running."
  echo "    Retry: npm run train:ml:docker-all"
  exit 0
fi

echo "==> Predicting every listed stock"
if ! docker compose exec -T ml-engine python -m app.batch --all; then
  echo "WARNING: predict:ml:all failed inside ml-engine. Services are still running."
  echo "    Retry: npm run predict:ml:docker-all"
  exit 0
fi

echo "==> ML bootstrap complete (train + all-stock predictions)"
echo "    Predictions are probabilistic — this is not investment advice."
