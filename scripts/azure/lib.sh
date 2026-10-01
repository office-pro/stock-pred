# shellcheck shell=bash
# Shared helpers for Azure deploy scripts. Never print DATABASE_URL.

set -euo pipefail

AZURE_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${AZURE_SCRIPTS_DIR}/../.." && pwd)"
DEPLOY_ROOT="${STOCKPRED_DEPLOY_ROOT:-/opt/stockpred}"

die() {
  echo "error: $*" >&2
  exit 1
}

redact() {
  sed -E 's#(postgres(ql)?://[^:]+:)[^@]+#\1***#'
}

assert_safe_argv() {
  local joined="$*"
  if echo "${joined}" | grep -Eqi 'down[[:space:]].*-v|[[:space:]]-v[[:space:]].*down'; then
    die "refusing docker compose down -v"
  fi
  if echo "${joined}" | grep -Eqi 'migrate[[:space:]]+reset|force-reset|dropdb|volume[[:space:]]+rm|prune.*--volumes|flexible-server[[:space:]]+delete'; then
    die "refusing unsafe command"
  fi
}

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || die "missing ${name}"
}

load_env_file() {
  local env_name="${1:?env name}"
  case "${env_name}" in
    development | production) ;;
    *) die "env must be development or production" ;;
  esac
  local file="${AZURE_SCRIPTS_DIR}/env/${env_name}.sh"
  if [ -f "${file}" ]; then
    # shellcheck disable=SC1090
    source "${file}"
  fi
  STOCKPRED_ENV="${env_name}"
  export STOCKPRED_ENV
}

assert_azure_database_url() {
  local url="${DATABASE_URL:-}"
  [ -n "${url}" ] || die "DATABASE_URL is not set"
  echo "${url}" | grep -qi 'azure.com' || die "DATABASE_URL must point at Azure Database for PostgreSQL"
  echo "${url}" | grep -qi 'sslmode=require' || die "DATABASE_URL must include sslmode=require"
}

compose() {
  assert_safe_argv docker compose "$@"
  docker compose -f docker-compose.yml -f docker-compose.azure.yml --profile apps "$@"
}
