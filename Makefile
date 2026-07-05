SHELL   := /bin/bash
COMPOSE ?= docker compose
SERVICE ?= frontend

# `mock` is a Compose profile that gates the optional mock-api service.
# Without it, only the frontend container is brought up — the SPA talks to
# whatever real backend VITE_API_URL points at.
MOCK_PROFILE := --profile mock

.PHONY: help env build up up-mock down down-all logs logs-mock ps sh sh-mock rebuild rebuild-mock prune clean login push release

help:
	@echo "Orient Advertise — Frontend container targets"
	@echo ""
	@echo "Default flow (talks to your real backend):"
	@echo "  make up            Build (if needed) and start the SPA on http://localhost:3000"
	@echo "  make down          Stop the frontend"
	@echo "  make rebuild       Force a no-cache rebuild + recreate (frontend only)"
	@echo "  make logs          Tail frontend logs"
	@echo "  make ps            Show container status (all services in this project)"
	@echo "  make sh            Shell into the frontend"
	@echo ""
	@echo "Mock backend (opt-in via the 'mock' compose profile):"
	@echo "  make up-mock       Start frontend + mock-api on http://localhost:8090"
	@echo "  make rebuild-mock  No-cache rebuild of both services + recreate"
	@echo "  make logs-mock     Tail mock-api logs"
	@echo "  make sh-mock       Shell into the mock-api"
	@echo "  make down-all      Stop everything (frontend + mock if running)"
	@echo ""
	@echo "Housekeeping:"
	@echo "  make prune         Drop dangling images / build cache"
	@echo "  make clean         Stop + remove containers/networks (no volumes used)"
	@echo ""
	@echo "Docker Hub:"
	@echo "  make login         docker login to Docker Hub"
	@echo "  make push          Push images to Docker Hub (uses DOCKERHUB_USERNAME + IMAGE_TAG from .env)"
	@echo "  make release       Build + push in one go (IMAGE_TAG=<tag> make release)"
	@echo ""
	@echo "Tip: when using the mock, point VITE_API_URL at http://localhost:8090."

env:
	@if [ ! -f .env ]; then \
		cp .env.docker.example .env; \
		echo "Created .env from .env.docker.example — fill in VITE_API_URL and VITE_WS_URL before 'make up'."; \
		exit 1; \
	fi

build:
	$(COMPOSE) build

# Default: frontend only. `mock-api` has `profiles: ["mock"]` so it stays
# out unless explicitly enabled via the `mock` profile (see up-mock).
up: env
	$(COMPOSE) up -d --build $(SERVICE)
	@echo ""
	@echo "Frontend starting on http://localhost:3000"
	@echo "Health:  curl -fsS http://localhost:3000/healthz"
	@echo "Logs:    make logs"

up-mock: env
	$(COMPOSE) $(MOCK_PROFILE) up -d --build
	@echo ""
	@echo "Frontend  : http://localhost:3000"
	@echo "Mock API  : http://localhost:8090   (creds: admin/operator/viewer/advertiser, password: 'password')"
	@echo "Tip       : set VITE_API_URL=http://localhost:8090 in .env, then 'make rebuild' to point the SPA here."

# Stop the default service. Mock-api stays up (if running) — use down-all
# to stop everything.
down:
	$(COMPOSE) stop $(SERVICE)
	$(COMPOSE) rm -f $(SERVICE) >/dev/null 2>&1 || true

# Stop both services (whichever are running).
down-all:
	$(COMPOSE) $(MOCK_PROFILE) down

logs:
	$(COMPOSE) logs -f --tail=200 $(SERVICE)

logs-mock:
	$(COMPOSE) $(MOCK_PROFILE) logs -f --tail=200 mock-api

# `ps` lists everything in the project, including profile-gated services
# that happen to be running.
ps:
	$(COMPOSE) $(MOCK_PROFILE) ps

sh:
	$(COMPOSE) exec $(SERVICE) sh

sh-mock:
	$(COMPOSE) $(MOCK_PROFILE) exec mock-api sh

rebuild:
	$(COMPOSE) build --no-cache $(SERVICE)
	$(COMPOSE) up -d --force-recreate $(SERVICE)

rebuild-mock:
	$(COMPOSE) $(MOCK_PROFILE) build --no-cache
	$(COMPOSE) $(MOCK_PROFILE) up -d --force-recreate

prune:
	docker image prune -f
	docker builder prune -f

clean:
	$(COMPOSE) $(MOCK_PROFILE) down --remove-orphans

# --- Docker Hub publishing -------------------------------------------------
# Image names in docker-compose.yml resolve from DOCKERHUB_USERNAME + IMAGE_TAG
# in .env, so `docker compose push` pushes to Docker Hub once you're logged in.
# Override the tag inline: `IMAGE_TAG=1.0.0 make push`.

login:
	docker login

# Push frontend (default). `make push SERVICE=mock-api` or use `--profile mock`.
push: env
	$(COMPOSE) push $(SERVICE)

# Build + push in one go. Tag the release explicitly:
#   IMAGE_TAG=1.0.0 make release
release: env
	$(COMPOSE) build $(SERVICE)
	$(COMPOSE) push $(SERVICE)
	@echo ""
	@echo "Pushed $${DOCKERHUB_USERNAME:-developabror}/orient-frontend:$${IMAGE_TAG:-dev}"
