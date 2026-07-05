# syntax=docker/dockerfile:1.7
#
# Tiny mock backend for the SPA. Single-file Node 20 server, no dependencies,
# no build step — just copy and run.
#

FROM node:20.19.0-alpine

WORKDIR /app
COPY server.mjs ./

# Run as the non-root `node` user that ships with the official image.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server.mjs"]
