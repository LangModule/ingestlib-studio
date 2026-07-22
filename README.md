# ingestlib-studio

Visual review UI for [ingestlib](https://github.com/LangModule/ingestlib):
see exactly what your documents became. Try-and-verify pipeline runs,
page-by-page parse review with hover-to-highlight bounding boxes, committed
ingestion with live progress, and a retrieval playground where every answer
points to its source on the page.

## Status

Every screen is working: the setup wizard, live stack status, Try it
(in-memory pipeline runs with the page-by-page review shell), Ingest
(committed runs with live five-stage progress), the Library (browse,
review, and delete stored documents), the Playground (cited retrieval
with click-through to the exact page region), and Settings (edit the
configuration without a restart, plus vector-store backfill).

## Requirements

- Python 3.12+ and [uv](https://github.com/astral-sh/uv)
- Node.js 20+ (frontend build)
- An AWS account with Bedrock access. The setup wizard walks you through
  everything else, including the IAM policy it needs.

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

Artifacts live in your S3 bucket or a plain local folder
(`~/.ingestlib/artifacts`) — pick in the wizard. With the local folder and
the SQLite vector store, AWS is needed only for Bedrock.

Other targets: `make dev-unconfigured` simulates a fresh machine even when
this one is configured; `make serve` serves the built frontend from the
backend on :8000; `make test` and `make lint` cover the backend.

## Architecture

```
backend/    FastAPI, a thin wrapper over the published ingestlib package.
            One package per feature (app/setup, app/pipeline,
            app/documents); routes stay thin. Never imports ingestlib while
            unconfigured, which is what makes zero-restart setup possible.
            The layout and design rules are explained in backend/README.md.
frontend/   Vite + React + TypeScript + Tailwind v4, in the brand derived
            from the library's cover artwork. The layout, design system,
            and shared patterns are explained in frontend/README.md.
```

## License

See [LICENSE](./LICENSE).
