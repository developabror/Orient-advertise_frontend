---
name: containerization
description: Use this skill whenever the user wants to containerize, dockerize, "package", or "ship" an application — from greenfield setup to retrofitting existing code. Inspects the repo, infers the app shape (frontend / backend / fullstack / monorepo) and runtime stack (Node, Vite, Next, Spring Boot, Python, Go), then emits a complete, runnable bundle: Dockerfile(s), .dockerignore(s), docker-compose.yml, .env.example, Makefile shortcuts, and a copy-paste run section. Always reads `.claude/skills/docker/SKILL.md` and `.claude/skills/devops/SKILL.md` for the underlying rules.
---

# Containerization Skill

Goal: turn any repo in this project into a one-command-up stack. The output must mirror the **actual application structure** (no generic boilerplate) and be runnable with `docker compose up` after copying `.env.example` to `.env.local`.

This skill is the *workflow*. The hard rules (multi-stage, non-root, healthcheck, network segmentation, etc.) live in `.claude/skills/docker/SKILL.md` and **must be loaded** before producing any container artifact.

---

## Required Workflow (every task)

1. **Load underlying skills.** Read `.claude/skills/docker/SKILL.md` in full, plus `.claude/skills/devops/SKILL.md` when CI/deploy is in scope. Do not paraphrase rules from memory.
2. **Map the application.** Walk the repo and answer:
   - Is this a single service or a monorepo (`apps/*`, `services/*`, `packages/*`, root `package.json` + `workspaces`)?
   - What runtime(s)? Detect by manifest: `package.json` (and `engines.node`), `pom.xml`, `build.gradle*`, `pyproject.toml`/`requirements.txt`, `go.mod`, `Cargo.toml`.
   - What kind of frontend? Vite, Next.js (SSR vs static), CRA, SvelteKit, Astro. The build output dir and runtime differ.
   - What kind of backend? Spring Boot (`bootJar`), Express/Fastify (`dist/server.js`), FastAPI (`uvicorn`), etc.
   - Stateful deps from code/config: Postgres, MySQL, Redis, Mongo, RabbitMQ, Kafka, MinIO. Grep for connection strings and driver imports.
   - Required ports and env vars (parse `.env*`, `application.yml`, `vite.config.*`, framework defaults).
3. **Pick the topology** (see *Topologies* below). For a monorepo, scope per-service Dockerfiles to each service folder; the compose lives at the repo root.
4. **Generate the bundle** in this exact order so later files can reference earlier ones:
   1. Per-service `Dockerfile`
   2. Per-service `.dockerignore`
   3. Root `docker-compose.yml` (dev) — and `docker-compose.prod.yml` only if requested
   4. `.env.example` at repo root (all required vars, blank values, `# SECRET - use env var` on sensitive ones)
   5. `Makefile` with `up`, `down`, `logs`, `rebuild`, `ps`, `sh-<service>` targets
   6. A `## Run with Docker` section appended to the existing `README.md` (create one only if absent)
5. **Self-validate** against the *Output Checklist* at the bottom.
6. **Print the run summary** in the format at the end of this file.

Never write secret values. Never use `:latest`. Never expose database ports on the host. These rules come from the docker skill and are non-negotiable here too.

---

## Application Structure → Container Layout

Mirror what's already there. Don't invent folders.

### Single frontend (e.g. this repo: Vite + React)
```
./Dockerfile          # multi-stage: node build → nginx:alpine serve OR node preview
./.dockerignore
./docker-compose.yml  # one service: web
./.env.example
./Makefile
```

### Single backend (e.g. Spring Boot or Express API)
```
./Dockerfile
./.dockerignore
./docker-compose.yml  # api + db (+ cache if used)
./.env.example
./Makefile
```

### Fullstack split repo (frontend repo here, backend elsewhere)
Single `Dockerfile` for the FE. Compose can stub the API via a `profile: with-api` service that pulls a published image, or document running the API repo separately.

### Monorepo (`apps/web`, `apps/api`, `apps/worker`, …)
```
./apps/web/Dockerfile         ./apps/web/.dockerignore
./apps/api/Dockerfile         ./apps/api/.dockerignore
./apps/worker/Dockerfile      ./apps/worker/.dockerignore
./docker-compose.yml          # all services + db + cache, with build.context per service
./.env.example
./Makefile
```

For Turborepo / pnpm workspaces, copy only the relevant package + the lockfile + workspace manifests in the build stage to keep the cache hot.

---

## Stack Recipes (use these as starting points, then tune)

### Vite / React (static, served by nginx)
```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20.11.1-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:20.11.1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/dist /usr/share/nginx/html
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  location / { try_files $uri /index.html; }
  location /healthz { return 200 "ok"; add_header Content-Type text/plain; }
}
EOF
RUN chown -R app:app /var/cache/nginx /var/run /etc/nginx/conf.d
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
```

### Next.js (standalone output)
Same shape, but `runtime` is `node:20.11.1-alpine`, copy `.next/standalone`, `.next/static`, `public`, and `CMD ["node","server.js"]`.

### Spring Boot
Use the Java example in `.claude/skills/docker/SKILL.md`. Healthcheck hits `/actuator/health/liveness`.

### FastAPI / Python
```dockerfile
FROM python:3.12-slim AS build
WORKDIR /app
RUN pip install --upgrade pip
COPY pyproject.toml uv.lock* requirements.txt* ./
RUN pip install --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runtime
RUN useradd -r -u 10001 app
WORKDIR /app
COPY --from=build /install /usr/local
COPY --chown=app:app . .
USER app
EXPOSE 8080
HEALTHCHECK CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### Worker / queue consumer
No `EXPOSE`, no host port, no public network. Healthcheck via a script that touches a liveness file the worker updates.

---

## Compose Topology (defaults)

```yaml
name: orient-advertise

services:
  web:
    build: { context: ./apps/web, target: runtime }   # or ./ for single-service repos
    image: orient/web:dev
    env_file: .env.local
    ports: ["3000:8080"]
    networks: [frontend]
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/healthz || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
    deploy:
      resources:
        limits:    { cpus: "1.0", memory: 512M }
        reservations: { cpus: "0.25", memory: 128M }
    restart: unless-stopped

  api:
    build: { context: ./apps/api, target: runtime }
    image: orient/api:dev
    env_file: .env.local
    networks: [frontend, backend]
    depends_on:
      db:    { condition: service_healthy }
      cache: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/actuator/health/liveness || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 30s
    deploy:
      resources:
        limits:    { cpus: "1.0", memory: 768M }
        reservations: { cpus: "0.25", memory: 256M }
    restart: unless-stopped

  db:
    image: postgres:16.2-alpine
    environment:
      POSTGRES_USER:     ${DB_USER}      # SECRET - use env var
      POSTGRES_PASSWORD: ${DB_PASSWORD}  # SECRET - use env var
      POSTGRES_DB:       ${DB_NAME}
    volumes: [db-data:/var/lib/postgresql/data]
    networks: [backend]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 3s
      retries: 10

  cache:
    image: redis:7.2-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes: [cache-data:/data]
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
  frontend: { driver: bridge }
  backend:  { driver: bridge }
```

Drop services that the app doesn't actually use. Don't add Postgres "just in case".

---

## Makefile (always emit)

```makefile
SHELL := /bin/bash
COMPOSE ?= docker compose

.PHONY: up down logs ps rebuild clean env

env:
	@test -f .env.local || cp .env.example .env.local && echo "Created .env.local from template — fill in secrets."

up: env
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=200

ps:
	$(COMPOSE) ps

rebuild:
	$(COMPOSE) build --no-cache

clean:
	$(COMPOSE) down -v --remove-orphans

sh-%:
	$(COMPOSE) exec $* sh
```

`make up` is the contract: a fresh clone is one command from running.

---

## .env.example Conventions

- Every variable referenced in compose or app config appears here, with a blank value.
- Sensitive vars get `# SECRET - use env var (do not commit real values)` on the line above.
- Group with comments: `# --- Database ---`, `# --- Auth ---`, `# --- Frontend ---`.
- Include a `COMPOSE_PROJECT_NAME=` line so `docker compose` picks a stable name.

---

## README "Run with Docker" section (template)

```markdown
## Run with Docker

```bash
cp .env.example .env.local   # fill in secrets
make up                      # build + start the full stack
make logs                    # tail logs
make down                    # stop
make clean                   # stop + remove volumes (destroys local data)
```

Services:
- Web: http://localhost:3000
- API: http://localhost:8080  (health: /actuator/health/liveness)
- Postgres + Redis are internal-only (no host ports).
```

Adapt service list to what was actually generated.

---

## Output Checklist (run before printing the summary)

Structure:
- [ ] Dockerfile location matches the service it builds (per-service in monorepo)
- [ ] `.dockerignore` next to each Dockerfile
- [ ] Single root `docker-compose.yml` covering all services
- [ ] `.env.example` lists every variable used in compose + code
- [ ] `Makefile` with `up`/`down`/`logs`/`rebuild`/`clean`/`sh-<svc>`

Per Dockerfile:
- [ ] Multi-stage `AS build` / `AS runtime`, pinned base, non-root `USER app`, `HEALTHCHECK`
- [ ] No `:latest`, no `ARG SECRET`, no committed `.env`

Per compose service:
- [ ] Healthcheck on services with dependents
- [ ] `depends_on: { condition: service_healthy }`
- [ ] Resource `limits` + `reservations`
- [ ] On the right network(s); DB on `backend` only, no `ports:`
- [ ] `env_file: .env.local`
- [ ] Secrets annotated `# SECRET - use env var`

Run experience:
- [ ] `make up` works on a fresh clone after `cp .env.example .env.local`
- [ ] README has a `Run with Docker` section pointing at the Makefile

---

## Summary Format (always print after writing files)

```
Containerized as: <single-frontend | single-backend | fullstack | monorepo>
Detected stack:   <e.g. Vite + React + Node 20, Spring Boot 3 + Postgres 16, …>

Generated:
  - <path>  (<one-line purpose>)
  …

Required env vars (fill in .env.local):
  - DB_USER
  - DB_PASSWORD
  - …

Run:
  cp .env.example .env.local
  make up
  open http://localhost:3000

Stop / reset:
  make down       # stop containers
  make clean      # stop + drop volumes (wipes local data)
```
