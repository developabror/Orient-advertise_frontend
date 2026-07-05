---
name: devops
description: Use this skill when generating, reviewing, or modifying anything in the build/release/run lifecycle — CI/CD pipelines (GitHub Actions, GitLab CI), deploy configs, environment promotion (dev/staging/prod), secrets handling, health/readiness/liveness probes, structured JSON logging, monitoring/SLOs, and rollback strategies. Read before writing workflow YAML, deploy scripts, or anything that ships code to an environment.
---

# DevOps Skill

Goal: every deploy is **reproducible**, **observable**, and **reversible**.

---

## CI/CD Pipelines

### GitHub Actions — baseline shape
Every workflow must include these stages, in order:

1. **Checkout** with `fetch-depth: 0` if commit metadata is needed.
2. **Setup** language/runtime with explicit version (no `latest`).
3. **Cache** dependencies keyed on lockfile hash.
4. **Lint** (fail fast).
5. **Test** with coverage upload.
6. **Build** artifact.
7. **Scan** artifact (SAST + SCA).
8. **Publish** image / artifact tagged with `${{ github.sha }}` AND a semver tag if release.
9. **Deploy** — **never** to prod from a branch other than `main` (or release branch).
10. **Smoke test** post-deploy.
11. **Notify** Slack/Teams on failure only (don't spam success).

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write     # for OIDC to cloud — no long-lived keys
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20.11.1', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm test -- --coverage
      - run: npm run build
```

### GitLab CI — equivalent shape
- Use `stages: [lint, test, build, scan, deploy]`.
- Use `rules:` not `only/except` (deprecated).
- Use `id_tokens:` for OIDC to AWS/GCP/Vault.

---

## Environment Separation

Three environments minimum: **dev**, **staging**, **prod**. Each gets:
- Its **own** secret store namespace.
- Its **own** DB / cache / queue (no shared state across envs).
- A distinct hostname (`*.dev.example.com`, `*.staging…`, `example.com`).
- A `deployments` GitHub environment with **required reviewers** on `prod`.

Promotion path: image built once on `main`, **same digest** promoted dev → staging → prod. Never rebuild per environment.

---

## Secrets Management

**Hard rules:**
1. **Never** commit secrets. Use git-secrets / gitleaks pre-commit hook.
2. **Never** hardcode in Dockerfile, compose, or YAML — only `${VAR}` placeholders.
3. **Never** log secrets. Mask in CI with `::add-mask::` or `masked: true`.
4. Source of truth options (in order of preference):
   - Cloud-native: AWS Secrets Manager, GCP Secret Manager, Azure Key Vault.
   - Self-hosted: HashiCorp Vault.
   - CI-only: GitHub Actions Secrets / GitLab CI Variables (marked masked + protected).
5. Rotation: secrets rotated every 90 days minimum, immediately on suspected leak.
6. Short-lived credentials > long-lived. Prefer OIDC federation.

In generated configs, mark every secret reference:
```yaml
DATABASE_PASSWORD: ${DATABASE_PASSWORD}   # SECRET - use env var
```

---

## Health Checks & Probes

Every service ships **three** endpoints:

| Endpoint | Purpose | Checks |
|---|---|---|
| `/healthz` | Liveness | Process is alive. Cheap. No deps. |
| `/readyz`  | Readiness | DB reachable, cache reachable, migrations applied. |
| `/startupz` | Startup | Slow init complete (warm cache, JIT, etc.). |

Kubernetes probe pattern:
```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /readyz, port: 8080 }
  periodSeconds: 5
  failureThreshold: 2
startupProbe:
  httpGet: { path: /startupz, port: 8080 }
  failureThreshold: 30
  periodSeconds: 5
```

---

## Logging Standards

- **Structured JSON only** in non-dev environments. One JSON object per line.
- Required fields:
  - `timestamp` (RFC3339, UTC)
  - `level` (`debug|info|warn|error|fatal`)
  - `service`, `version`, `env`
  - `trace_id`, `span_id` (W3C tracecontext)
  - `message`
- **Never** log: passwords, tokens, full credit card numbers, full PII. Use redaction middleware.
- Stdout/stderr only — let the platform aggregate.

```json
{"timestamp":"2026-05-06T12:34:56Z","level":"info","service":"api","version":"1.4.2","env":"prod","trace_id":"a1b2…","message":"order created","order_id":"ord_123"}
```

---

## Rollback Strategies

Every deploy plan must answer: **"how do we undo this in <5 minutes?"**

Patterns, in order of preference:

1. **Image rollback** — redeploy previous immutable image tag. Always feasible if images are tagged by SHA and retained.
2. **Blue/green** — flip load balancer weight back to old target group.
3. **Canary** — automated rollback if SLO violation in 5-minute window.
4. **Feature flag** — disable code path without redeploy. Best for forward-only schema changes.
5. **DB migrations**: ship as **two-phase expand/contract**. Forward-compatible, reversible. Never drop columns in same release that adds them.

CI must produce a reusable **rollback job** that takes a `target_sha` input and redeploys.

---

## Monitoring & SLOs

Each service declares:
- **SLI**: latency p95, error rate, saturation.
- **SLO**: e.g. "99.9% of requests <300ms over 30 days".
- **Alert**: page only on SLO burn rate (multi-window, multi-burn-rate).

Default alerts to wire up on day one:
- `error_rate > 1% for 5m`
- `p95_latency > target * 2 for 10m`
- `pod_restarts > 3 in 15m`
- `disk_usage > 85%`

---

## Pipeline Output Checklist

When generating a CI/CD config, confirm:
- [ ] Pinned runtime versions (no `latest`)
- [ ] Dependency cache configured
- [ ] Lint + test + build + scan stages present
- [ ] Image tagged with both `sha` and semver
- [ ] Secrets via env/OIDC, never inline
- [ ] Per-environment deploy gates
- [ ] Smoke test post-deploy
- [ ] Rollback job documented
- [ ] Concurrency group to cancel superseded runs
