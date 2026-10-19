# Multi-stage build for any Node microservice in the monorepo.
# Usage: docker build -f infrastructure/docker/node-service.Dockerfile --build-arg APP=api-gateway .

# ---------- build stage (keeps dev deps: used by the compose `migrate` job) ----------
FROM node:20-alpine AS build
ENV NPM_CONFIG_FETCH_TIMEOUT=1200000 \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=180000
WORKDIR /repo

# Manifests only first — shared npm ci layer across services when lockfile unchanged.
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-utils/package.json packages/shared-utils/
COPY packages/shared-events/package.json packages/shared-events/
COPY packages/database/package.json packages/database/
COPY packages/broker-sdk/package.json packages/broker-sdk/
COPY apps/api-gateway/package.json apps/api-gateway/
COPY apps/auth-service/package.json apps/auth-service/
COPY apps/market-data-service/package.json apps/market-data-service/
COPY apps/signal-engine/package.json apps/signal-engine/
COPY apps/pattern-engine/package.json apps/pattern-engine/
COPY apps/backtest-service/package.json apps/backtest-service/
COPY apps/auto-trader/package.json apps/auto-trader/
COPY apps/notification-service/package.json apps/notification-service/
COPY apps/trader-agent/package.json apps/trader-agent/
COPY apps/frontend-react/package.json apps/frontend-react/

# --ignore-scripts skips husky's prepare hook inside the container.
# Retry once on EIDLETIMEOUT / flaky registry (common on first Windows builds).
RUN npm ci --ignore-scripts \
 || (echo "npm ci failed — retrying once after 15s..." && sleep 15 && npm ci --ignore-scripts)

COPY packages ./packages
COPY apps ./apps

RUN npm run build:packages

# Per-app layer only from here on (ARG placement keeps the cache shared).
ARG APP=api-gateway
RUN npm run build -w @stockpred/${APP}

# ---------- prune stage ----------
FROM build AS pruned
# Drop dev dependencies for the runtime image (Prisma's generated client
# lives in node_modules/.prisma and survives the prune).
RUN npm prune --omit=dev --ignore-scripts

# ---------- runtime stage ----------
FROM node:20-alpine
ARG APP=api-gateway
ENV NODE_ENV=production \
    APP_NAME=${APP}
WORKDIR /repo

COPY --from=pruned /repo/node_modules ./node_modules
COPY --from=pruned /repo/packages ./packages
COPY --from=pruned /repo/apps/${APP} ./apps/${APP}
COPY --from=pruned /repo/package.json ./package.json

# Writable runtime data for non-root `node` (Focus Universe, ledger, soak).
USER root
RUN mkdir -p ./apps/${APP}/data && chown -R node:node ./apps/${APP}/data

# Non-root runtime (security spec).
USER node

CMD ["sh", "-c", "node apps/${APP_NAME}/dist/main.js"]
