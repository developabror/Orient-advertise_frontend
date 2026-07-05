# syntax=docker/dockerfile:1.7
#
# Orient Advertise — Frontend (Vite + React 18 + TS SPA)
#
# Multi-stage:
#   1. deps    — install npm deps with a BuildKit cache mount.
#   2. build   — compile TS + bundle with Vite. Vite inlines VITE_* at build
#                time, so we use placeholder tokens here and substitute the
#                real values at container start (see docker/entrypoint.sh).
#                This keeps a single image portable across environments.
#   3. runtime — nginx:alpine, non-root, port 3000, /healthz endpoint.
#

# ---------- deps ----------
FROM node:20.19.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---------- build ----------
FROM node:20.19.0-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder tokens — replaced by entrypoint at container start.
# Real values are NEVER baked into this image.
ENV VITE_API_URL=__VITE_API_URL__
ENV VITE_WS_URL=__VITE_WS_URL__
RUN npm run build

# ---------- runtime ----------
FROM nginx:1.27.3-alpine AS runtime

# Toolchain for envsubst (gettext) + healthcheck client (wget is in busybox).
RUN apk add --no-cache gettext \
 && rm -rf /var/cache/apk/*

# Custom nginx config (listen 3000, SPA fallback, /healthz, gzip, headers).
COPY nginx.conf /etc/nginx/nginx.conf

# Built SPA assets.
COPY --from=build /app/dist /usr/share/nginx/html

# Entrypoint: substitute placeholders with runtime env, then exec nginx.
COPY docker/entrypoint.sh /docker-entrypoint.d/40-runtime-env.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-env.sh

# Make everything writable by the existing non-root `nginx` user, and point
# the pid file at a path that user owns.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx \
 && touch /var/run/nginx.pid \
 && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

# nginx:alpine ships an entrypoint that runs every executable in
# /docker-entrypoint.d/ before launching the daemon — our 40-runtime-env.sh
# script lands in that pipeline. Final CMD launches nginx in the foreground.
CMD ["nginx", "-g", "daemon off;"]
