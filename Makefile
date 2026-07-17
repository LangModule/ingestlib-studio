.PHONY: dev dev-unconfigured serve test build lint

# backend :8000 (reload) + frontend :5173 (vite, proxies /api)
dev:
	(cd backend && uv run uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait

# simulate a fresh laptop even though this machine has config — tests the wizard
dev-unconfigured:
	(cd backend && STUDIO_FORCE_UNCONFIGURED=1 uv run uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait

# built SPA served by FastAPI on :8000
serve: build
	cd backend && uv run uvicorn app.main:app --port 8000

build:
	cd frontend && npm run build

test:
	cd backend && uv run pytest

lint:
	cd backend && uv run ruff check app tests
