# ingestlib-studio

Visual review UI for [ingestlib](https://github.com/LangModule/ingestlib):
see exactly what your documents became. Try-and-verify pipeline runs,
page-by-page parse review with hover-to-highlight bounding boxes, committed
ingestion with live progress, and a retrieval playground where every answer
points to its source on the page.

## Status

The setup wizard, live stack status, Try it (in-memory pipeline runs with
the page-by-page review shell), and Ingest (committed runs with live
five-stage progress) are working. Library, Settings, and the retrieval
playground are being built slice by slice.

## Requirements

- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Node.js 20+ (frontend build)
- An AWS account with Bedrock access — the setup wizard walks you through
  everything else, including the IAM policy it needs

## Run

```bash
git clone https://github.com/LangModule/ingestlib-studio.git
cd ingestlib-studio
(cd backend && uv sync)
(cd frontend && npm install)
make dev          # backend :8000 + frontend :5173
```

Open http://localhost:5173. On a machine without ingestlib configuration the
setup wizard opens automatically; it verifies your AWS access, storage, and
reranker with real calls, then writes `~/.ingestlib/{config.yaml,.env}` and
activates them without a restart.

Other targets: `make dev-unconfigured` simulates a fresh machine even when
this one is configured; `make serve` serves the built frontend from the
backend on :8000; `make test` and `make lint` cover the backend.

## Architecture

```
backend/    FastAPI, a thin wrapper over the published ingestlib package.
            One package per feature (app/setup, later app/documents,
            app/pipeline); routes stay thin. Never imports ingestlib while
            unconfigured, which is what makes zero-restart setup possible.
frontend/   Vite + React + TypeScript + Tailwind v4, in the brand derived
            from the library's cover artwork.
```

## License

See [LICENSE](./LICENSE).
