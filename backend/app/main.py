"""Application factory.

Configures CORS for the Vite dev server, registers the API routers, and
serves the built frontend when one exists. Later slices add the retrieve
router here, guarded like every non-setup router by
bootstrap.require_configured.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import bootstrap
from app.routes import documents, ingest, setup, tryit

_FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


def create_app() -> FastAPI:
    # Resolve early so INGESTLIB_CONFIG is exported before the first request.
    bootstrap.resolve()

    app = FastAPI(title="ingestlib-studio", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(setup.router)
    app.include_router(tryit.router)
    app.include_router(ingest.router)
    app.include_router(documents.router)

    # The directory exists only after a frontend build; `make serve` uses it.
    if _FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="spa")
    return app


app = create_app()
