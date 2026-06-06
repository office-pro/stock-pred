# Frontend build + nginx serve.
# docker build -f infrastructure/docker/frontend.Dockerfile --build-arg VITE_API_BASE_URL=http://localhost:3000 .
FROM node:20-alpine AS build
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm ci --ignore-scripts \
 && npm run build -w @stockpred/shared-types \
 && npm run build -w @stockpred/frontend-react

FROM nginx:1.27-alpine
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend-react/dist /usr/share/nginx/html
EXPOSE 80
