# Orient Advertise — Frontend

A Vite + React 18 + TypeScript SPA. Served in production by Nginx inside a
container; uses `react-router-dom` BrowserRouter, so the server falls back any
unknown path to `/index.html`.

---

## Local development (Node)

```bash
cp .env.example .env.local       # set VITE_API_URL / VITE_WS_URL
npm install
npm run dev                      # http://localhost:5173
```

Required env vars (consumed by `src/api/env.ts`, throws on boot if missing):

- `VITE_API_URL` — REST base, e.g. `http://localhost:8080/api`
- `VITE_WS_URL`  — WebSocket endpoint, e.g. `ws://localhost:8080/ws`

---

## Run with Docker

One image, one command up. The same image is portable across staging /
production — env vars are injected **at container start**, not at build time
(see "Runtime-config pattern" below).

### Quick start

```bash
cp .env.docker.example .env      # fill in VITE_API_URL / VITE_WS_URL
make up                          # build image + start on :3000
```

Then verify:

```bash
curl -fsS http://localhost:3000/healthz                 # → ok
curl -fsS http://localhost:3000/                        # → SPA index.html
curl -fsS http://localhost:3000/some/deep/route         # → SPA index.html (router fallback)
```

Open <http://localhost:3000>.

### Make targets

| Target          | What it does                                              |
| --------------- | --------------------------------------------------------- |
| `make up`       | Build (if needed) and start in the background.            |
| `make down`     | Stop the container.                                       |
| `make logs`     | Tail container logs.                                      |
| `make ps`       | Show container status.                                    |
| `make sh`       | Open a shell inside the running container.                |
| `make rebuild`  | No-cache rebuild + force-recreate.                        |
| `make prune`    | Drop dangling images + build cache.                       |
| `make clean`    | Stop + remove the container/network.                      |

### Runtime-config pattern

Vite normally inlines `import.meta.env.VITE_*` into the bundle at build time,
which would lock the image to one backend URL. Instead:

1. The `Dockerfile` build stage builds with **placeholder** values
   (`__VITE_API_URL__`, `__VITE_WS_URL__`) so the bundle compiles.
2. `docker/entrypoint.sh` runs at container start, reads `VITE_API_URL` and
   `VITE_WS_URL` from the container environment, and rewrites the placeholders
   inside `dist/assets/*.js` and `dist/index.html`.
3. Nginx then takes over (`nginx -g 'daemon off;'`) on port `3000`.

That means: **same image, different envs — no rebuild required.** Set the
values in your `.env` (for compose) or via `docker run -e VITE_API_URL=...`
when running the image directly.

If either var is missing at start time, the entrypoint fails fast with a clear
error before nginx boots, mirroring the SPA's own boot-time guard in
`src/api/env.ts`.

### SPA fallback

`react-router-dom` BrowserRouter relies on the server returning `index.html`
for any unknown path. The container's `nginx.conf` enforces this:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Without it, a hard refresh on a deep route (e.g. `/devices/123`) would 404.

### Image facts

- Build stage: `node:20.19.0-alpine`
- Runtime stage: `nginx:1.27.3-alpine`, runs as the non-root `nginx` user.
- Listens on `3000` inside the container (unprivileged); `docker-compose.yml`
  publishes `3000:3000` on the host.
- `HEALTHCHECK` hits `/healthz` every 30s.
- Read-only root filesystem with `tmpfs` mounts for nginx's writable paths.

### Files

```
Dockerfile               # multi-stage build → nginx runtime
nginx.conf               # listen 3000, gzip, cache headers, SPA fallback, /healthz, CSP
docker/entrypoint.sh     # runtime env substitution
docker-compose.yml       # single 'frontend' service
.dockerignore
.env.docker.example      # template for compose env (copy to .env)
Makefile                 # up / down / logs / sh / rebuild / clean
```
