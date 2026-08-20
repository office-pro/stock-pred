# Copy to development.sh (gitignored) on the operator laptop / CI does not need this.
# Hostnames only — never put passwords here.

SSH_HOST="dev.example.com"
SSH_USER="azureuser"
DEPLOY_PATH="/opt/stockpred"
APP_URL="https://dev.example.com"
HEALTH_URL="https://dev.example.com/health"
POSTGRES_HOST="stockpred-pg.postgres.database.azure.com"
POSTGRES_DB="stockpred_dev"
PUBLIC_URL="https://dev.example.com"
CADDY_SITE="https://dev.example.com"
