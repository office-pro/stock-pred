# Copy to production.sh (gitignored). Hostnames only — never put passwords here.

SSH_HOST="example.com"
SSH_USER="azureuser"
DEPLOY_PATH="/opt/stockpred"
APP_URL="https://example.com"
HEALTH_URL="https://example.com/health"
POSTGRES_HOST="stockpred-pg.postgres.database.azure.com"
POSTGRES_DB="stockpred_prod"
PUBLIC_URL="https://example.com"
CADDY_SITE="https://example.com"
