#!/usr/bin/env bash
# Complete clean start: kill all, clear cache, and restart
# Use when start:all is stuck or stale state is causing issues
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> StockPred clean start (kill all + clear cache + restart)"

# 1: Stop all services and remove containers
echo "==> Stopping all services..."
docker compose --profile apps stop -t 5 2>/dev/null || true
docker compose --profile apps down -v 2>/dev/null || true

# 2: Kill any lingering node processes
echo "==> Killing lingering node processes..."
pkill -f "node" 2>/dev/null || true
sleep 1

# 3: Clear build and cache artifacts
echo "==> Clearing build artifacts and caches..."
find apps packages -type d \( -name "dist" -o -name "build" -o -name ".cache" -o -name ".turbo" \) -exec rm -rf {} + 2>/dev/null || true
rm -rf .turbo 2>/dev/null || true

# Clear npm cache
npm cache clean --force 2>/dev/null || true

# 4: Remove docker volumes for fresh database state
echo "==> Removing docker volumes (fresh database)..."
docker volume rm stockpred_postgres-data 2>/dev/null || true
docker volume rm stockpred_kafka-data 2>/dev/null || true
docker volume rm stockpred_redis-data 2>/dev/null || true

echo "==> Clean state ready, starting fresh..."
echo ""

# 5: Start everything
npm run start:all
