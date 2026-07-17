# backend

The FastAPI backend of ingestlib-studio. The repository README covers
installing and running; this file explains how the code is organized and
the rules it follows.

## The rule everything follows

The library reads its configuration the first time it is used, so this
process must not touch ingestlib until valid configuration files exist.
Nothing in this codebase imports ingestlib at module level: the setup
package never imports it at all, and the pipeline and documents packages
import it inside the functions that run after setup is complete. This is
what makes zero-restart activation possible. The wizard writes the files,
sets `INGESTLIB_CONFIG` in the running process, and the library loads
everything correctly on its first use.

## Layout

```
app/
├── main.py           Application factory: CORS, the six routers, and the
│                     built SPA when frontend/dist exists.
├── bootstrap.py      Decides whether the studio is configured and where the
│                     configuration lives. Provides require_configured, the
│                     HTTP 409 gate on every router except setup.
├── setup/            The wizard and the health checks. Never imports ingestlib.
│   ├── checks.py     Real-call probes: STS, Bedrock, S3, the six vector
│   │                 stores, the rerankers, the OCR server, LibreOffice.
│   ├── policy.py     Builds the least-privilege IAM policy, pre-filled.
│   ├── writer.py     Writes config.yaml (answers only) and .env (mode 600).
│   │                 The wizard and the Settings page share it.
│   ├── runtime.py    Reads the active configuration the way the library
│   │                 would, resolving the same defaults.
│   ├── defaults.py   Model identifiers that mirror the library's.
│   └── schemas.py    Request and response models for the setup API.
├── pipeline/         In-memory jobs around the library's pipeline.
│   ├── jobs.py       The job base (event log, synchronous emit, SSE
│   │                 streaming) and the bounded registries.
│   ├── tryit.py      parse → classify → split entirely in memory. A try
│   │                 run never writes to S3 or the vector store.
│   ├── ingest.py     The committed run through aingest(). The library
│   │                 persists everything; the studio relays stage events.
│   └── backfill.py   Rebuilds the configured vector store from the S3
│                     split artifacts. No re-parse, no OCR server.
├── documents/        Stored documents become UI views.
│   ├── shaping.py    Library models to view models. Pure transformation.
│   ├── registry.py   Reads the S3 artifact registry, caches shaped views,
│   │                 presigns image URLs, and deletes everywhere.
│   └── schemas.py    The view models the frontend renders.
└── routes/           One thin router per page; handlers delegate.
    ├── setup.py      /api/setup: status, health, checks, iam-policy, complete.
    ├── tryit.py      /api/try: run, events, page and figure images.
    ├── ingest.py     /api/ingest: run, events, from-try promotion.
    ├── documents.py  /api/documents: list, view, image redirects, delete.
    ├── playground.py /api/retrieve: cited hits for a question.
    ├── settings.py   /api/settings: view, edit, backfill.
    ├── sse.py        The event-stream response both job routers share.
    └── uploads.py    The upload validation both job routers share.
```

## Design rules

- **Routes stay thin.** Handlers validate, delegate to a feature package,
  and translate failures into HTTP status codes. Logic lives in the
  packages, where the tests exercise it directly.
- **The library did the hard work; the studio makes it visible.** No
  parsing, no model calls, and no data transformation beyond presentation
  shaping. If the studio needs something the public API cannot give, that
  is a library gap to fix in ingestlib.
- **Jobs live in memory.** Try and ingest runs are keyed by content hash,
  backfill runs by their target store, so a repeated request joins the
  running job. All of them stream progress over SSE with full replay for
  late subscribers and expire after they finish. A restart clears them,
  which is acceptable: S3 self-heals, and an interrupted ingest is retried
  because the library treats an incomplete run as not ingested.
- **S3 is the source of truth.** The vector store is a derived, rebuildable
  index; backfill proves it. Image bytes never pass through this process
  for stored documents, because the routes redirect to presigned S3 URLs.
- **Blocking calls stay off the event loop.** boto3 and the store SDKs are
  synchronous, so every handler that touches them goes through
  asyncio.to_thread.

## Tests

`tests/` mirrors the app packages. Every test runs hermetically inside a
scratch configuration directory; network-touching layers are stubbed at
module seams. Two end-to-end tests are opt-in because they need this
machine's real stack: `RUN_STUDIO_TRYIT_E2E=1` runs a full try, and
`RUN_STUDIO_INGEST_E2E=1` commits one tiny document. A subprocess test
pins the rule that building the app never imports ingestlib.
