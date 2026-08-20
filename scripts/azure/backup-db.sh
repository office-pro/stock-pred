#!/usr/bin/env bash
# Dump Azure Postgres (or local) to a file. Never drops or restores over existing data.
#
#   ./scripts/azure/backup-db.sh --env production
#   ./scripts/azure/backup-db.sh --env development --out /tmp/dev.dump

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

ENV_NAME="production"
OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env)
      ENV_NAME="${2:?}"
      shift 2
      ;;
    --out)
      OUT="${2:?}"
      shift 2
      ;;
    *)
      die "unknown flag $1"
      ;;
  esac
done

load_env_file "${ENV_NAME}"
if [ -z "${DATABASE_URL:-}" ]; then
  for f in "${REPO_ROOT}/azure.${ENV_NAME}.env" "${REPO_ROOT}/azure.env"; do
    if [ -f "${f}" ]; then
      set -a
      # shellcheck disable=SC1090
      source "${f}"
      set +a
      break
    fi
  done
fi
assert_azure_database_url
OUT="${OUT:-${REPO_ROOT}/stockpred-${ENV_NAME}-$(date -u +%Y%m%dT%H%M%SZ).pgdump}"
echo "writing dump to ${OUT} (pg_dump -Fc, no drop)"
pg_dump -Fc "${DATABASE_URL}" --no-owner --file="${OUT}"
echo "done ${OUT}"
