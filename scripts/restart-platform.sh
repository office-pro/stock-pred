#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/stop-platform.sh
./scripts/start-platform.sh
