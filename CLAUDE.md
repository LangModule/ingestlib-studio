# ingestlib-studio

Visual review UI for [ingestlib](https://github.com/LangModule/ingestlib) —
see exactly what your documents became: page-by-page parse review with
hover-to-highlight bounding boxes, and a retrieval playground where every
answer points to its source on the page.

The sibling library repo lives at `../ingestlib` (same VS Code workspace).
The studio consumes the published package (`pip install ingestlib`), never
its internals — building this app is deliberate dogfooding of the public API.

## Architecture (decided, do not relitigate without reason)

- **Backend**: FastAPI + uvicorn, a thin wrapper over ingestlib (~6 endpoints).
  Async-native — use ingestlib's `a*` functions directly.
- **Frontend**: Vite + React + TypeScript + Tailwind + shadcn/ui.
- **No pdf.js**: parse already stores page renders as PNGs in S3 and every
  region has `bbox.normalized()` (0–1 coords). The viewer is an `<img>` with
  absolutely-positioned highlight `<div>`s in percentage units.
- **No database**: ingestlib's S3 artifact registry is the source of truth.
  In-memory job dict for ingest progress (single-user tool).
- **No auth** in v1 — local tool first.

## Build phases

1. **Read-only review** (current target): library list → document view with
   page image left / parsed chunks right → hover a chunk, highlight its
   bboxes. Works over already-ingested documents.
2. **Retrieval playground**: question → cited hits → click a hit → jump to
   page with source regions highlighted.
3. **Upload + ingest** with live per-stage progress (parse/classify/split/
   embed/upsert durations stream via SSE).

## Backend endpoints (planned shape)

```
GET  /documents                     → artifacts.list_documents()
GET  /documents/{id}                → parse structure (regions, bboxes, markdown)
GET  /documents/{id}/pages/{n}.png  → redirect to presigned S3 URL
GET  /documents/{id}/chunks         → split result with region_ids
POST /retrieve                      → retrieve() → hits + citations
POST /documents            (phase 3)→ upload → aingest background job
```

## The ingestlib API surface this app consumes

```python
from ingestlib.storage import artifacts
from ingestlib.services import retrieve  # and aretrieve

artifacts.list_documents()          # [DocumentMeta: doc_id, filename, page_count, category, sections, chunks]
artifacts.load_parse(doc_id)        # ParseResult — pages[].regions[] with bbox + region_id, markdown per page
artifacts.load_split(doc_id)        # SplitResult — chunks[] with markdown, pages, region_ids {page: [ids]}
artifacts.page_image_key(doc_id, n) # S3 key of a page render (presign via ingestlib.storage.get_s3_client())

region.bbox.normalized(page_width, page_height)  # → (x1, y1, x2, y2) in 0–1, ready for CSS %

r = retrieve("question", top_k=5)   # r.hits[]: .citation, .rerank_score, .chunk.{document_id, pages, region_ids, markdown}
```

Key data facts:
- `doc_id` = SHA-256 of file bytes (content-addressed, stable).
- `chunk.region_ids` maps `{page_num: [region_id, ...]}` — the hover-highlight
  source of truth. Standalone-split docs may have empty region_ids.
- Page images live at `documents/{doc_id}/parse/pages/page_0001.png` in the
  ingestlib S3 bucket; figure crops under `parse/figures/`.

## ingestlib config discovery (important for running the backend)

`import ingestlib` never reads config; the first call does. Discovery order:
`INGESTLIB_CONFIG` env var → `config.yaml` in CWD, then parent dirs. The
`.env` next to the discovered config auto-loads. For dev, run the backend with:

```bash
INGESTLIB_CONFIG=../ingestlib/config.yaml uvicorn ...
```

or keep a local `config.yaml` (gitignored) in this repo.

## Conventions (carried over from ingestlib)

- Tests hit real APIs, never mocks; server-dependent suites are opt-in via
  `RUN_*_E2E=1` env gates.
- Quality lives in evals (measure, report), tests assert invariants.
- Comments only for constraints the code can't express; module docstrings
  say what and why.
- Python: ruff, line-length 100. Frontend: prettier.
- Never commit `.env` or `config.yaml`; `.example` variants are tracked.
