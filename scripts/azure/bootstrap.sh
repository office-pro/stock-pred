#!/usr/bin/env bash
# Idempotent first-time Azure resources. Never deletes a server, VM, or database.
#
#   ./scripts/azure/bootstrap.sh
#
# Requires: az login, ssh-keygen, optional local pg_dump for --restore-local

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib.sh"

PREFIX="${AZURE_PREFIX:-stockpred}"
LOCATION="${AZURE_LOCATION:-centralindia}"
RG="${AZURE_RESOURCE_GROUP:-rg-${PREFIX}}"
PG_NAME="${AZURE_PG_NAME:-${PREFIX}-pg}"
PG_SKU="${AZURE_PG_SKU:-Standard_B1ms}"
PG_STORAGE_MB="${AZURE_PG_STORAGE_MB:-32768}"
VM_DEV="${AZURE_VM_DEV:-${PREFIX}-dev}"
VM_PROD="${AZURE_VM_PROD:-${PREFIX}-prod}"
VM_DEV_SIZE="${AZURE_VM_DEV_SIZE:-Standard_B2ats_v2}"
VM_PROD_SIZE="${AZURE_VM_PROD_SIZE:-Standard_B2s}"
ADMIN_USER="${AZURE_ADMIN_USER:-azureuser}"
RESTORE_LOCAL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --restore-local)
      RESTORE_LOCAL=1
      shift
      ;;
    --replace-remote-db)
      die "--replace-remote-db is disabled in bootstrap (would wipe cloud data). Use backup-db.sh + a manual restore with --no-owner only onto an empty database."
      ;;
    *)
      die "unknown flag $1"
      ;;
  esac
done

command -v az >/dev/null || die "install Azure CLI (az)"

echo "resource group ${RG} (${LOCATION})"
az group show --name "${RG}" >/dev/null 2>&1 || az group create --name "${RG}" --location "${LOCATION}" --output none

OPERATOR_IP="$(curl -4 -fsS https://api.ipify.org 2>/dev/null || true)"
SSH_SOURCE="Internet"
if [ -n "${OPERATOR_IP}" ]; then
  SSH_SOURCE="${OPERATOR_IP}/32"
  echo "SSH NSG source ${SSH_SOURCE}"
fi

ensure_vm() {
  local name="$1"
  local size="$2"
  local nsg="${name}-nsg"
  if az vm show --resource-group "${RG}" --name "${name}" >/dev/null 2>&1; then
    echo "vm ${name} exists — not deleted"
  else
    echo "creating vm ${name} (${size})"
    az vm create \
      --resource-group "${RG}" \
      --name "${name}" \
      --image Ubuntu2204 \
      --size "${size}" \
      --admin-username "${ADMIN_USER}" \
      --generate-ssh-keys \
      --public-ip-sku Standard \
      --nsg "${nsg}" \
      --output none
  fi
  az network nsg rule create --resource-group "${RG}" --nsg-name "${nsg}" --name allow-ssh-admin \
    --priority 1000 --access Allow --protocol Tcp --destination-port-ranges 22 --source-address-prefixes "${SSH_SOURCE}" \
    --output none >/dev/null 2>&1 || true
  az network nsg rule create --resource-group "${RG}" --nsg-name "${nsg}" --name allow-http \
    --priority 1010 --access Allow --protocol Tcp --destination-port-ranges 80 --source-address-prefixes Internet \
    --output none >/dev/null 2>&1 || true
  az network nsg rule create --resource-group "${RG}" --nsg-name "${nsg}" --name allow-https \
    --priority 1020 --access Allow --protocol Tcp --destination-port-ranges 443 --source-address-prefixes Internet \
    --output none >/dev/null 2>&1 || true
}

ensure_docker() {
  local name="$1"
  echo "ensuring docker on ${name}"
  az vm run-command invoke \
    --resource-group "${RG}" \
    --name "${name}" \
    --command-id RunShellScript \
    --scripts "set -e
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
apt-get update -y && apt-get install -y docker-compose-plugin
usermod -aG docker ${ADMIN_USER} || true
mkdir -p /opt/stockpred
chown ${ADMIN_USER}:${ADMIN_USER} /opt/stockpred
chmod 755 /opt/stockpred" \
    --output none
}

vm_ip() {
  az vm show --resource-group "${RG}" --name "$1" --show-details --query publicIps -o tsv
}

echo "creating VMs first so Postgres firewall can lock to their IPs only"
ensure_vm "${VM_DEV}" "${VM_DEV_SIZE}"
ensure_vm "${VM_PROD}" "${VM_PROD_SIZE}"
ensure_docker "${VM_DEV}"
ensure_docker "${VM_PROD}"
DEV_IP="$(vm_ip "${VM_DEV}")"
PROD_IP="$(vm_ip "${VM_PROD}")"
echo "dev ip ${DEV_IP}  prod ip ${PROD_IP}"

PG_ADMIN_USER="${AZURE_PG_ADMIN_USER:-pgadmin}"
SECRETS_FILE="${SCRIPT_DIR}/.bootstrap-secrets"
if az postgres flexible-server show --resource-group "${RG}" --name "${PG_NAME}" >/dev/null 2>&1; then
  echo "postgres ${PG_NAME} already exists — not modifying SKU or deleting"
else
  if [ -z "${AZURE_PG_ADMIN_PASSWORD:-}" ]; then
    AZURE_PG_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)Aa1"
  fi
  echo "creating postgres ${PG_NAME} (Burstable ${PG_SKU})"
  az postgres flexible-server create \
    --resource-group "${RG}" \
    --name "${PG_NAME}" \
    --location "${LOCATION}" \
    --tier Burstable \
    --sku-name "${PG_SKU}" \
    --storage-size "${PG_STORAGE_MB}" \
    --version 16 \
    --admin-user "${PG_ADMIN_USER}" \
    --admin-password "${AZURE_PG_ADMIN_PASSWORD}" \
    --public-access None \
    --yes \
    --output none
  umask 077
  {
    echo "AZURE_PG_HOST=${PG_NAME}.postgres.database.azure.com"
    echo "AZURE_PG_ADMIN_USER=${PG_ADMIN_USER}"
    echo "AZURE_PG_ADMIN_PASSWORD=${AZURE_PG_ADMIN_PASSWORD}"
  } >"${SECRETS_FILE}"
  echo "wrote admin credentials to ${SECRETS_FILE} (gitignored, not printed)"
  az postgres flexible-server parameter set \
    --resource-group "${RG}" \
    --server-name "${PG_NAME}" \
    --name require_secure_transport \
    --value on \
    --output none
fi

az postgres flexible-server firewall-rule create \
  --resource-group "${RG}" --name "${PG_NAME}" --rule-name "allow-${VM_DEV}" \
  --start-ip-address "${DEV_IP}" --end-ip-address "${DEV_IP}" --output none >/dev/null 2>&1 || true
az postgres flexible-server firewall-rule create \
  --resource-group "${RG}" --name "${PG_NAME}" --rule-name "allow-${VM_PROD}" \
  --start-ip-address "${PROD_IP}" --end-ip-address "${PROD_IP}" --output none >/dev/null 2>&1 || true

for db in stockpred_dev stockpred_prod; do
  if az postgres flexible-server db show --resource-group "${RG}" --server-name "${PG_NAME}" --database-name "${db}" >/dev/null 2>&1; then
    echo "database ${db} exists"
  else
    echo "creating database ${db}"
    az postgres flexible-server db create --resource-group "${RG}" --server-name "${PG_NAME}" --database-name "${db}" --output none
  fi
done

echo
echo "Next:"
echo "  1. Copy scripts/azure/env/*.example.sh to development.sh / production.sh"
echo "     SSH_HOST development=${DEV_IP}  production=${PROD_IP}"
echo "     POSTGRES_HOST=${PG_NAME}.postgres.database.azure.com"
echo "  2. Copy azure.env.example to azure.env, fill DATABASE_URL with sslmode=require"
echo "     development DB: stockpred_dev   production DB: stockpred_prod"
echo "     PG admin password is in scripts/azure/.bootstrap-secrets (if this run created the server)"
echo "  3. ./scripts/azure/deploy.sh --env development --secrets"
echo "     ./scripts/azure/deploy.sh --env development --force"
echo "  4. Restore local data into prod only (no --clean):"
echo "     pg_dump -Fc \"\$LOCAL_DATABASE_URL\" > stockpred.pgdump"
echo "     pg_restore --no-owner -d \"\$PROD_DATABASE_URL\" stockpred.pgdump"
echo "  5. GitHub → Settings → Environments: development, production"
echo "     Secrets: SSH_HOST, SSH_USER, SSH_PRIVATE_KEY"
echo "     Vars: APP_URL, HEALTH_URL"
echo "  App URLs until DNS: http://${DEV_IP} (dev)  http://${PROD_IP} (prod)"

if [ "${RESTORE_LOCAL}" = 1 ]; then
  echo "Run pg_dump/pg_restore yourself with --no-owner. This script will not drop remote tables."
fi
