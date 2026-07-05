# CLAUDE.md — Orient Advertise

Project conventions for Claude Code. **Apply these on every development task in this repo unless the user explicitly says otherwise.**

---

## Default Skills (auto-load when relevant)

These live under `.claude/skills/<name>/SKILL.md` and Claude auto-invokes them by description match. Treat them as the source of truth — read the matching skill **before** writing code in that domain, every time.

| Skill | When it applies |
|---|---|
| **frontend-design** | Any UI work — components, pages, dashboards, landings, navs, forms, layouts. Enforces the Antimetal design system. |
| **api-design**      | Any REST endpoint, controller, DTO, route, error handling, pagination, or OpenAPI work. |
| **security**        | Any code touching input, auth, sessions, JWTs, persistence, file paths, command exec, deserialization, or secrets. |
| **devops**          | Any CI/CD pipeline, deploy config, environment, secrets management, probes, logging, or rollback. |
| **docker**          | Any Dockerfile, .dockerignore, docker-compose, container, or image work. |
| **containerization**| Containerize / dockerize / "package" / "ship" an app. Inspects repo structure, emits Dockerfile(s) + .dockerignore(s) + docker-compose.yml + .env.example + Makefile mirroring the actual app layout. One-command-up. |

**Hard rule:** before producing code in one of these domains, you must read the matching SKILL.md in full. Tokens, status codes, and security defaults are not safe to recall from memory.

---

## Default Subagents (delegate proactively)

These live under `.claude/agents/<name>.md`. Delegate via the Task tool.

| Agent | Use for |
|---|---|
| **frontend-agent**   | Building or modifying any UI component / page. Outputs HTML/JSX + CSS variables + usage example, validates against Antimetal hard rules, reports tokens used. |
| **devops-agent**     | Generating CI/CD workflows, Dockerfiles, docker-compose, .env.example, rollback procedures. Always emits health checks + secret placeholders + rollback step. |
| **containerization-agent** | Producing a complete, runnable container bundle (Dockerfile(s), .dockerignore(s), docker-compose, .env.example, Makefile, README run section) that mirrors the app's actual structure. Narrower scope than devops-agent — no CI/CD. One-command-up is the contract. |
| **security-agent**   | Reviewing any code that handles input, auth, persistence, or secrets. Outputs severity-ranked findings (Critical/High/Medium/Low) with secure rewrites. |
| **fullstack-agent**  | End-to-end feature delivery (UI + container + security review). Orchestrates the three above and writes `DONE.md`. |

**Trigger heuristics:**
- Any UI ask → call `frontend-agent`.
- "Containerize / dockerize / package / ship as a container" or any Dockerfile / compose / .env.example ask → call `containerization-agent`. It mirrors the app's structure and emits a one-command-up bundle.
- Any CI/CD pipeline, deploy, environment, or rollback ask → call `devops-agent`. (For features that need both, run `containerization-agent` first, then hand off to `devops-agent`.)
- Any review of code handling input/auth/secrets → call `security-agent` (also run it before declaring a security-sensitive change done).
- "Build feature X end-to-end" or "ship X" → call `fullstack-agent`.

For narrow single-domain tasks where the right specialist is obvious, call it directly. Don't bounce through the orchestrator.

---

## Non-Negotiables (project-wide)

These come from the skills above; they're surfaced here so you don't need to load a skill to remember them:

**Design (Antimetal):**
- One dark section per page (hero only). All other sections are light.
- Never `#000000`. Foreground is always `#1b2540`.
- Never black-based shadows. Always `rgba(0,39,80, …)` / `rgba(24,37,66, …)`.
- Inputs always `border-radius: 0`. Buttons always pills (`9999px`).
- `#d0f100` is reserved for CTA button fills. Never decorative.

**Security:**
- Every endpoint authenticated by default. Public endpoints opt in.
- Parameterized queries only. No string concatenation into SQL/shell.
- Secrets never in source, images, or logs. CORS allow-list, never `*` with credentials.
- Errors returned to clients are generic. Stack traces only in server logs.

**API:**
- Plural-noun resources under `/api/v1/`. Standard error envelope `{ error: { code, message, details, traceId } }`.
- `@Valid` on inbound DTOs. Pagination capped at `size=100`.
- DTOs separate from entities, always.

**DevOps / Docker:**
- Pinned base images, multi-stage builds, non-root `USER app`, `HEALTHCHECK` directive.
- CI: lint → test → build → scan → publish. Image tagged with sha + semver.
- Rollback workflow on every deploy. No `latest` tag in staging or prod.

---

## Docker Hub Publish & Deploy

- When the user asks to **"push image to Docker Hub"** (or any phrasing of the same intent),
  follow [`docs/PUSH-IMAGE.md`](docs/PUSH-IMAGE.md) **in full**: remove → rebuild (no cache) →
  push → **then auto-deploy to `subzero`** (pull + `docker compose up -d frontend` + prune +
  verify). A push is not complete until the new image is live on the server. Target image:
  `developabror/orient-frontend:dev`; compose service `frontend`.
- **Always run the disk guard first** (`df -h /` on subzero; prune if <~500 MB free; never
  `prune -a`) — the box has hit 100% disk and crash-looped before. Mirrors the backend's
  `docs/DOCKER_HUB.md` flow.

---

## File-Layout Notes

- Skills: `.claude/skills/<name>/SKILL.md` — case-sensitive `SKILL.md`.
- Agents: `.claude/agents/<name>.md` — flat files, not subdirectories.
- This file (`CLAUDE.md`) is loaded automatically into every session in this repo.

If you add new skills or agents, update the tables above so future sessions discover them.
