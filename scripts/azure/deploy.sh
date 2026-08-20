#!/usr/bin/env bash
# Deploy StockPred to an Azure VM without deleting Postgres data or secrets.
#
#   ./scripts/azure/deploy.sh --env development
#   ./scripts/azure/deploy.sh --env production --force
#   ./scripts/azure/deploy.sh --env production --dry-run
#   ./scripts/azure/deploy.sh --on-server --env development --force
#
# GitHub Actions rsyncs the repo then runs this with --on-server.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

ENV_NAME="development"
FORCE=0
DRY=0
ON_SERVER=0
SECRETS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env)
      ENV_NAME="${2:?}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --dry-run)
      DRY=1
      shift
      ;;
    --on-server)
      ON_SERVER=1
      shift
      ;;
    --secrets)
      SECRETS=1
      shift
      ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      die "unknown flag $1"
      ;;
  esac
done

load_env_file "${ENV_NAME}"
SSH_HOST="${SSH_HOST:-}"
SSH_USER="${SSH_USER:-azureuser}"
DEPLOY_PATH="${DEPLOY_PATH:-${DEPLOY_ROOT}}"
APP_URL="${APP_URL:-}"
HEALTH_URL="${HEALTH_URL:-${APP_URL:+${APP_URL}/health}}"

run() {
  if [ "${DRY}" = 1 ]; then
    echo "dry-run: $*"
    return 0
  fi
  "$@"
}

forbidden_in_git() {
  [ -d "${REPO_ROOT}/.git" ] || return 0
  git -C "${REPO_ROOT}" ls-files --error-unmatch .env >/dev/null 2>&1 && die ".env is tracked in git — aborting"
  return 0
}

sync_code() {
  require_env SSH_HOST
  local exclude="${SCRIPT_DIR}/rsync-exclude.txt"
  echo "rsync ${REPO_ROOT}/ -> ${SSH_USER}@${SSH_HOST}:${DEPLOY_PATH}/"
  run ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${SSH_HOST}" "mkdir -p ${DEPLOY_PATH}"
  run rsync -az --delete --exclude-from="${exclude}" \
    "${REPO_ROOT}/" "${SSH_USER}@${SSH_HOST}:${DEPLOY_PATH}/"
}

copy_secrets() {
  local src="${REPO_ROOT}/azure.${ENV_NAME}.env"
  [ -f "${src}" ] || src="${REPO_ROOT}/azure.env"
  [ -f "${src}" ] || die "missing azure.${ENV_NAME}.env or azure.env (copy from azure.env.example)"
  grep -q 'sslmode=require' "${src}" || die "${src} DATABASE_URL must include sslmode=require"
  require_env SSH_HOST
  echo "installing VM .env from $(basename "${src}") (mode 600) — not via rsync"
  run scp -o StrictHostKeyChecking=accept-new "${src}" "${SSH_USER}@${SSH_HOST}:${DEPLOY_PATH}/.env"
  run ssh "${SSH_USER}@${SSH_HOST}" "chmod 600 ${DEPLOY_PATH}/.env"
}

sha_local() {
  git -C "${REPO_ROOT}" rev-parse HEAD
}

on_server_deploy() {
  cd "${DEPLOY_PATH}"
  [ -f .env ] || die "missing ${DEPLOY_PATH}/.env — create it once (never rsynced)"
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  assert_azure_database_url
  local incoming="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
  local current=""
  [ -f .deploy-sha ] && current="$(cat .deploy-sha)"
  if [ "${FORCE}" != 1 ] && [ -n "${current}" ] && [ "${current}" = "${incoming}" ]; then
    echo "up to date (${incoming})"
    echo "app: ${APP_URL:-${PUBLIC_URL:-}}"
    echo "health: ${HEALTH_URL:-${PUBLIC_URL:-}/health}"
    exit 0
  fi
  echo "building images (sha ${incoming})"
  compose build
  echo "starting stack (no volume wipe)"
  compose up -d --remove-orphans
  echo "prisma migrate deploy"
  compose run --rm migrate
  echo "${incoming}" >.deploy-sha
  local health="${HEALTH_URL:-http://127.0.0.1/health}"
  echo "health check ${health}"
  if [ "${DRY}" != 1 ]; then
    curl -fsS "${health}" >/dev/null || curl -fsS http://127.0.0.1/health >/dev/null || die "health check failed"
  fi
  echo "deployed ${incoming}"
  echo "app: ${PUBLIC_URL:-${APP_URL:-http://127.0.0.1}}"
  echo "health: ${health}"
}

forbidden_in_git

if [ "${SECRETS}" = 1 ]; then
  copy_secrets
  exit 0
fi

if [ "${ON_SERVER}" = 1 ]; then
  on_server_deploy
  exit 0
fi

require_env SSH_HOST
if [ "${FORCE}" != 1 ] && [ "${DRY}" != 1 ]; then
  remote_sha="$(ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${SSH_HOST}" "cat ${DEPLOY_PATH}/.deploy-sha 2>/dev/null" || true)"
  local_sha="$(sha_local)"
  if [ -n "${remote_sha}" ] && [ "${remote_sha}" = "${local_sha}" ]; then
    echo "up to date (${local_sha}) — pass --force to rebuild"
    echo "app: ${APP_URL}"
    echo "health: ${HEALTH_URL}"
    exit 0
  fi
fi

sync_code
run ssh "${SSH_USER}@${SSH_HOST}" "chmod +x ${DEPLOY_PATH}/scripts/azure/*.sh"
extra_flags=""
[ "${FORCE}" = 1 ] && extra_flags="${extra_flags} --force"
[ "${DRY}" = 1 ] && extra_flags="${extra_flags} --dry-run"
local_sha="$(sha_local)"
run ssh "${SSH_USER}@${SSH_HOST}" \
  "GITHUB_SHA='${local_sha}' STOCKPRED_DEPLOY_ROOT=${DEPLOY_PATH} ${DEPLOY_PATH}/scripts/azure/deploy.sh --on-server --env ${ENV_NAME}${extra_flags}"
