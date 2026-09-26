#!/usr/bin/env bash
# Confirms test-cloud env load + local-host guard without starting Docker.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(node scripts/export-stockpred-env.js test-cloud)"
db_host="$(node scripts/cloud-env-host.js database)"
redis_host="$(node scripts/cloud-env-host.js redis)"
case "${db_host}" in
  postgres|localhost|127.0.0.1|host.docker.internal)
    echo "FAIL: host still local (${db_host})" >&2
    exit 1
    ;;
esac
echo "OK db=${db_host} redis=${redis_host} profile=${STOCKPRED_ENV_PROFILE}"
