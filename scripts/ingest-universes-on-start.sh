#!/usr/bin/env bash
# Canonical universe ingest used by start:all.
# NSE_ALL, US_ALL, CRYPTO_SPOT_ALL, CRYPTO_FUTURES_ALL.
# MCX/CME stay NOT_READY unless an approved JSON feed URL is set.
set -u
cd "$(dirname "$0")/.."

if [ ! -f packages/database/dist/ingest-universes-on-start.js ]; then
  echo "==> Building @stockpred/database for universe ingest"
  npm run build -w @stockpred/database || {
    echo "WARNING: database package build failed; skipping universe ingest"
    exit 0
  }
fi

echo "==> Ingesting canonical universes (NSE / US / crypto / futures gate)"
node packages/database/dist/ingest-universes-on-start.js || {
  echo "WARNING: universe ingest exited non-zero; platform start continues"
  exit 0
}
