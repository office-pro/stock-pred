# Azure deploy (development + production)

Cheap layout: **Azure Database for PostgreSQL** (two databases) + **two Linux VMs** running Docker Compose. Kafka and Redis stay on the VM. Postgres data is never stored on the VM disk.

|                    | Development                                    | Production                                  |
| ------------------ | ---------------------------------------------- | ------------------------------------------- |
| Git branch         | `develop`                                      | `main`                                      |
| GitHub Environment | `development`                                  | `production`                                |
| Database           | `stockpred_dev`                                | `stockpred_prod`                            |
| App URL            | `https://dev.yourdomain` or `http://DEV_VM_IP` | `https://yourdomain` or `http://PROD_VM_IP` |
| Health             | `/health`                                      | `/health`                                   |
| ML Lab             | `/ml-lab`                                      | `/ml-lab`                                   |

## First time

```bash
az login
./scripts/azure/bootstrap.sh
cp azure.env.example azure.development.env
cp azure.env.example azure.production.env   # different DATABASE_URL (stockpred_prod)
cp scripts/azure/env/development.example.sh scripts/azure/env/development.sh
cp scripts/azure/env/production.example.sh scripts/azure/env/production.sh
# set SSH_HOST to each VM public IP printed by bootstrap
./scripts/azure/deploy.sh --env development --secrets
./scripts/azure/deploy.sh --env development --force
```

Restore local candles/users into **production** only (no `--clean`, does not drop remote objects first):

```bash
pg_dump -Fc "$LOCAL_DATABASE_URL" > stockpred.pgdump
pg_restore --no-owner -d "$PROD_DATABASE_URL" stockpred.pgdump
```

Development can stay empty schema (`prisma migrate deploy` only) or restore a subset.

## Every code change

- Merge a PR into **`develop`** → GitHub Action **deploy** → development VM.
- Merge a PR into **`main`** → same workflow → production (enable required reviewers on the GitHub Environment).
- Or Actions → **deploy** → Run workflow → pick the environment.

Locally:

```bash
./scripts/azure/deploy.sh --env development
./scripts/azure/deploy.sh --env production --force
./scripts/azure/deploy.sh --env production --dry-run
```

The script **refuses** `compose down -v`, `prisma migrate reset`, `dropdb`, and Azure server delete. It only runs `prisma migrate deploy`. `.env` and `ml-models/` are not rsynced with `--delete`.

## GitHub secrets (per Environment)

Create Environments `development` and `production`. Add:

| Secret            | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `SSH_HOST`        | VM public IP or DNS                                        |
| `SSH_USER`        | `azureuser`                                                |
| `SSH_PRIVATE_KEY` | deploy key (not your daily laptop key if you can avoid it) |

| Variable     | Example                          |
| ------------ | -------------------------------- |
| `APP_URL`    | `https://dev.example.com`        |
| `HEALTH_URL` | `https://dev.example.com/health` |

Do **not** put `DATABASE_URL` or JWT secrets in GitHub. Those live in `/opt/stockpred/.env` on the VM (`chmod 600`).

## Inspect data (private)

```bash
./scripts/azure/db-console.sh --env production
# or --print for DBeaver: 127.0.0.1:5433 SSL=require
```

Postgres port 5432 is not opened on the NSG. Optional `scripts/azure/readonly-role.sql` creates a SELECT-only login.

## Backup

```bash
./scripts/azure/backup-db.sh --env production
```

Writes a custom-format dump. It never restores over the live database.
