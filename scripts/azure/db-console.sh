#!/usr/bin/env bash
# Private psql console: SSH tunnel via the env VM (Postgres is not public).
#
#   ./scripts/azure/db-console.sh --env development
#   ./scripts/azure/db-console.sh --env production --print
#
# Then in another tool: host 127.0.0.1 port 5433, SSL on, user/password from azure.env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

ENV_NAME="development"
PRINT_ONLY=0
LOCAL_PORT="${LOCAL_PORT:-5433}"

while [ $# -gt 0 ]; do
  case "$1" in
    --env)
      ENV_NAME="${2:?}"
      shift 2
      ;;
    --print)
      PRINT_ONLY=1
      shift
      ;;
    *)
      die "unknown flag $1"
      ;;
  esac
done

load_env_file "${ENV_NAME}"
require_env SSH_HOST
require_env POSTGRES_HOST
SSH_USER="${SSH_USER:-azureuser}"

echo "tunnel ${SSH_USER}@${SSH_HOST}  127.0.0.1:${LOCAL_PORT} -> ${POSTGRES_HOST}:5432"
echo "DBeaver / Azure Data Studio: host=127.0.0.1 port=${LOCAL_PORT} SSL=require database=${POSTGRES_DB:-stockpred_${ENV_NAME}}"
echo "Use the read-only role stockpred_readonly when possible (SELECT only)."

if [ "${PRINT_ONLY}" = 1 ]; then
  echo "ssh -N -L ${LOCAL_PORT}:${POSTGRES_HOST}:5432 ${SSH_USER}@${SSH_HOST}"
  exit 0
fi

ssh -N -L "${LOCAL_PORT}:${POSTGRES_HOST}:5432" "${SSH_USER}@${SSH_HOST}" &
tunnel_pid=$!
trap 'kill ${tunnel_pid} 2>/dev/null || true' EXIT
sleep 2

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

if command -v psql >/dev/null && [ -n "${DATABASE_URL:-}" ]; then
  local_url="$(echo "${DATABASE_URL}" | sed -E "s#@[^/]+/#@127.0.0.1:${LOCAL_PORT}/#")"
  echo "psql (password taken from azure.env, not printed)"
  psql "${local_url}"
else
  echo "tunnel is up (pid ${tunnel_pid}). Connect on 127.0.0.1:${LOCAL_PORT} then Ctrl+C to close."
  wait "${tunnel_pid}"
fi
