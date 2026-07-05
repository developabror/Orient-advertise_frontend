---
name: docker
description: Use this skill whenever containerizing a service or writing container infrastructure — Dockerfiles (multi-stage build → runtime, non-root users, pinned bases, HEALTHCHECK), .dockerignore, docker-compose.yml (named volumes, healthchecks, depends_on conditions, resource limits, segmented frontend/backend networks), image tagging strategy (sha + semver), and BuildKit secret mounts. Read before writing or editing any Dockerfile, compose file, or container config.
---

# Docker / Containerization Skill

Goal: small images, fast builds, minimal blast radius at runtime.

---

## Multi-Stage Dockerfile Pattern

Every service uses at least two stages: **build** → **runtime**. The final stage carries only what the process needs to run.

### Node.js example
```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- build ----------
FROM node:20.11.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:20.11.1-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/server.js"]
```

### Java/Spring Boot example
```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.gradle ./gradlew bootJar -x test

FROM eclipse-temurin:21-jre-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /src/build/libs/*.jar app.jar
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health/liveness || exit 1
ENTRYPOINT ["java","-XX:MaxRAMPercentage=75","-jar","app.jar"]
```

### Hard rules
1. **Pin** base images to a digest or specific minor (`node:20.11.1-alpine`), never `latest`.
2. **Non-root** USER in every final stage. Create a dedicated `app` user.
3. **No secrets** in build args or layers. Use BuildKit secret mounts (`--mount=type=secret`).
4. Order layers by **change frequency** (deps before source) for cache hits.
5. `.dockerignore` is mandatory — see below.
6. One process per container. No supervisor / systemd.
7. `EXPOSE` documents intent only — does not publish.
8. `HEALTHCHECK` directive present.

---

## .dockerignore — mandatory baseline

```
.git
.gitignore
.github
.gitlab-ci.yml
.idea
.vscode
node_modules
dist
build
target
out
coverage
.env
.env.*
*.log
*.md
!README.md
Dockerfile*
docker-compose*.yml
.DS_Store
tmp
.cache
```

Goals: exclude VCS, local secrets, build outputs, IDE files, and the Dockerfile itself.

---

## Image Tagging Strategy

Every image gets **two** tags on push:
- `registry/app:${GIT_SHA}` — immutable, used for deploy + rollback.
- `registry/app:${SEMVER}` — human-readable, only on release tags.

Optional: `registry/app:${BRANCH}-latest` for ephemeral PR envs (auto-pruned).

Never deploy floating tags (`latest`, `main`) to staging or prod.

---

## docker-compose for Local Dev

```yaml
name: orient-advertise

services:
  api:
    build:
      context: ./api
      target: runtime
    image: orient/api:dev
    env_file: .env.local
    ports: ["8080:8080"]
    depends_on:
      db: { condition: service_healthy }
      cache: { condition: service_healthy }
    networks: [backend]
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 512M }
        reservations: { cpus: "0.25", memory: 128M }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/healthz || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 20s
    restart: unless-stopped

  web:
    build:
      context: ./web
      target: runtime
    image: orient/web:dev
    env_file: .env.local
    ports: ["3000:3000"]
    depends_on:
      api: { condition: service_healthy }
    networks: [frontend, backend]

  db:
    image: postgres:16.2-alpine
    environment:
      POSTGRES_USER: ${DB_USER}            # SECRET - use env var
      POSTGRES_PASSWORD: ${DB_PASSWORD}    # SECRET - use env var
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - db-data:/var/lib/postgresql/data
    networks: [backend]
    healthcheck:
      test: ["CMD-SHELL", "pg_isempty -U ${DB_USER} || pg_isready -U ${DB_USER}"]
      interval: 5s
      timeout: 3s
      retries: 10

  cache:
    image: redis:7.2-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - cache-data:/data
    networks: [backend]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 2s
      retries: 5

volumes:
  db-data:
  cache-data:

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: false
```

### Compose rules
- **Named volumes** for stateful services. Never bind-mount data dirs.
- **Healthchecks** on every service that has dependents.
- `depends_on` always uses `condition: service_healthy`, not bare list form.
- **Resource limits** declared (`cpus`, `memory`).
- **Networks** segmented: `frontend` for web/edge, `backend` for internal traffic. Database joins **only** the backend network.
- `env_file` for local dev; production uses real secret stores.

---

## Network Isolation

Per-stack pattern:

| Network | Members | Exposed to host |
|---|---|---|
| `frontend` | reverse proxy, web app | yes (via proxy) |
| `backend` | api, workers, db, cache, queue | no |

- Database **never** has `ports:` published on the host. Talk to it from `backend`.
- Use `internal: true` on backend networks in prod-like compose to forbid egress.

---

## Resource Limits

Every service declares:
```yaml
deploy:
  resources:
    limits:    { cpus: "1.0", memory: 512M }
    reservations: { cpus: "0.25", memory: 128M }
```

Default starting points:
| Workload | CPU limit | Memory limit |
|---|---|---|
| Stateless API | `1.0` | `512M` |
| Frontend SSR | `1.0` | `768M` |
| Worker | `0.5` | `256M` |
| DB (local only) | `2.0` | `1G` |

Tune from observed `docker stats` over a representative workload. Don't guess.

---

## Build Output Checklist

When generating a Dockerfile + compose, confirm:
- [ ] Multi-stage with explicit `AS build` / `AS runtime`
- [ ] Pinned base image (no `:latest`)
- [ ] Non-root `USER app`
- [ ] `HEALTHCHECK` directive
- [ ] `.dockerignore` present and includes `.env`, `.git`, `node_modules`
- [ ] Compose has named volumes for stateful services
- [ ] Compose has healthchecks + `depends_on: { condition: service_healthy }`
- [ ] Compose has resource `limits` and `reservations`
- [ ] Networks segmented (frontend/backend)
- [ ] Secrets referenced as `${VAR}` with `# SECRET - use env var` comment
