# Push image to Docker Hub → auto-deploy to subzero

Blueprint for rebuilding, publishing, **and deploying** the Orient Advertise frontend image.

> **Standing instruction:** when the user says *"push image to Docker Hub"* (or any phrasing of
> the same intent), do the full sequence below — build → push → **pull & rerun on the `subzero`
> server**. Pushing is not "done" until the new image is live on subzero.

## Current image

- **Repository:** `developabror/orient-frontend`
- **Tag:** `dev`  → full reference `developabror/orient-frontend:dev`
- **Compose service on subzero:** `frontend` (container `orient-frontend`, port 3000, `/healthz`)

## Workflow

1. Remove the existing local image.
2. Rebuild from the current source tree (no cache).
3. Push to Docker Hub.
4. **Deploy to subzero:** pull the new image, recreate the container, prune the old image, verify.

### 1–3. Build & push

Run from the repo root (`Orient-advertise-frontend/`):

```bash
# 1. Remove old local image (ignore error if absent)
docker rmi developabror/orient-frontend:dev || true

# 2. Rebuild fresh from current source
DOCKER_BUILDKIT=1 docker build --no-cache -t developabror/orient-frontend:dev .

# 3. Push to Docker Hub  (login once per machine: docker login -u developabror)
docker push developabror/orient-frontend:dev
```

### 4. Deploy to subzero (do this every time, automatically)

```bash
# 4a. DISK GUARD FIRST — the subzero box is an 8 GB disk that has hit 100% and crash-looped
#     postgres before. Check headroom; if under ~500 MB free, reclaim space before pulling.
ssh subzero 'df -h / | tail -1'
ssh subzero 'cd ~/orient-advertise && docker image prune -f'   # frees dangling old images (never -a)

# 4b. Pull the new image, recreate only the frontend container, drop the now-dangling old image.
ssh subzero 'cd ~/orient-advertise && docker compose pull frontend && docker compose up -d frontend && docker image prune -f'

# 4c. Verify it came up healthy and is serving.
ssh subzero 'cd ~/orient-advertise && docker compose ps'
ssh subzero 'curl -s -o /dev/null -w "fe healthz: %{http_code}\n" --max-time 8 http://127.0.0.1:3000/healthz'
```

The frontend image is small (~80 MB) and recreates in seconds — expect near-zero downtime.
`ssh subzero` is key-based and non-interactive. The `frontend` service has `pull_policy: always`,
so the explicit `pull` + `up -d` swaps the container cleanly.

### Makefile shortcut

`make release` (build + `docker compose push`) covers build+push only — it does **not** deploy.
The canonical flow is the four steps above; step 4 is what makes "push" actually go live.

## Notes

- **Disk is the #1 risk on subzero.** Never skip 4a, and never use `docker image prune -a`
  (it would evict the postgres/redis/minio base images and force slow re-pulls).
- `VITE_API_URL` / `VITE_WS_URL` are **not** baked into the image — they're substituted at
  container start by `docker/entrypoint.sh` from the server's `.env`. The image is portable;
  changing the API URL is a server `.env` edit + `docker compose up -d frontend`, no rebuild.
- Tag `dev` is the rolling dev tag. Versioned release: `IMAGE_TAG=1.0.0 make release` or
  `-t developabror/orient-frontend:1.0.0` on the build step (and pull that tag on subzero).
- Full deploy/verify/rollback procedure (and the subzero server reference) lives in
  `DEPLOY-subzero.md` at the repo-set root and the backend's `docs/DOCKER_HUB.md` (mirror flow).
