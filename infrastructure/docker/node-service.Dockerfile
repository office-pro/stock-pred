# Multi-stage build for any Node microservice in the monorepo.
# Usage: docker build -f infrastructure/docker/node-service.Dockerfile --build-arg APP=api-gateway .

# ---------- build stage (keeps dev deps: used by the compose `migrate` job) ----------
FROM node:20-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

# Shared layers: identical for every service image, so BuildKit caches the
# expensive install + package builds once across all 8 microservice builds.
# --ignore-scripts skips husky's prepare hook inside the container.
RUN npm ci --ignore-scripts
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

# Non-root runtime (security spec).
USER node

CMD ["sh", "-c", "node apps/${APP_NAME}/dist/main.js"]
