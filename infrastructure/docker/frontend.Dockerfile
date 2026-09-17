# Frontend build + nginx serve.
# docker build -f infrastructure/docker/frontend.Dockerfile --build-arg VITE_API_BASE_URL=http://localhost:3000 .
FROM node:20-alpine AS build
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    NPM_CONFIG_FETCH_TIMEOUT=1200000 \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=180000
WORKDIR /repo

# Manifests only first — keep npm ci cached when only source changes.
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

# Retry npm ci once on transient registry idle timeouts (common on Windows/Docker Desktop).
RUN npm ci --ignore-scripts \
 || (echo "npm ci failed — retrying once after 15s..." && sleep 15 && npm ci --ignore-scripts)

COPY packages ./packages
COPY apps ./apps

RUN npm run build -w @stockpred/shared-types \
 && npm run build -w @stockpred/frontend-react

FROM nginx:1.27-alpine
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend-react/dist /usr/share/nginx/html
EXPOSE 80
