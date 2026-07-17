# frontend

The React frontend of ingestlib-studio. The repository README covers
installing and running; this file explains how the code is organized, the
design system, and the patterns the pages share.

Vite + React 19 + TypeScript (strict) + Tailwind v4. No state library and
no test suite: state is component-local, correctness rests on the typed
API layer, and every page is exercised against the real backend.

## Layout

```
src/
├── main.tsx              React root.
├── App.tsx               Boots on /api/setup/status. Unconfigured routes
│                         everything to the wizard; configured renders the
│                         shell with the nav and the page routes.
├── index.css             The design tokens, stage lighting, animations,
│                         and markdown styles.
├── api/
│   ├── client.ts         Every backend call, plus followStageEvents, the
│   │                     SSE follower the job pages share.
│   └── types.ts          Mirrors the backend response models exactly.
├── components/
│   ├── BrandArt.tsx      The cover artwork as an inline SVG: a document
│   │                     dissolving into cubes and particles. Decorative,
│   │                     fixed bottom-right, never behind results.
│   ├── StatusPopover.tsx The header dot and its stack-status panel.
│   ├── StackChecklist.tsx The six-check list the popover and Settings share.
│   ├── Dropzone.tsx      The upload target Try it and Ingest share.
│   ├── pipeline/
│   │   └── StageStepper.tsx  Live progress from stage events. Try it
│   │                         passes three stages, Ingest five, backfill
│   │                         one per document.
│   ├── review/
│   │   ├── ReviewShell.tsx   The split-pane viewer: light table left,
│   │   │                     pipeline tabs right. Used by Try it and the
│   │   │                     Library, with optional pinned regions for
│   │   │                     Playground click-throughs.
│   │   ├── LightTable.tsx    The page render with lemon provenance
│   │   │                     highlights positioned from normalized bboxes.
│   │   ├── tabs.tsx          Parsed · Classify · Split · Chunks, mirroring
│   │   │                     the pipeline stages exactly.
│   │   └── Markdown.tsx      Library markdown; images="chip" replaces
│   │                         pictures where the vector store has none.
│   └── setup/            The wizard steps and the shared primitives
│                         (Button, Card, Field, inputs, useCheck).
│                         Step2Choices also exports the store and reranker
│                         cards that Settings reuses.
└── routes/               One file per page: Setup, Library,
                          DocumentReview, TryIt, Ingest, Playground,
                          Settings.
```

## Design system

Derived from the library's cover artwork, defined as tokens in index.css:
near-black ground, dark cards, mint `#5fd4b4` as the single interactive
accent, amber for selection and decoration, and lemon `#fde047` reserved
exclusively for provenance, meaning "this came from here" on a page.
Machine values render in the mono face; the wordmark is lowercase mono.
Animations are subtle fade-rises and respect prefers-reduced-motion.

## Patterns the pages share

- **Phase unions.** Every async page models itself as a discriminated
  union (idle, running, done, failed) and renders exactly one phase, so
  impossible states cannot render.
- **SSE follow.** Job pages call followStageEvents: replayed history plus
  live events feed the stepper, the terminal event triggers a refetch for
  the final state, and the EventSource is closed on unmount.
- **Errors are readable.** The client extracts FastAPI's detail message,
  so failure cards show the backend's own words instead of status codes.
- **The hover contract.** Hovering content highlights its source regions
  on the light table and the reverse, in both the Parsed and Chunks tabs.
  Playground click-throughs arrive with ?page= and ?regions= and land with
  the cited regions pre-lit.
- **Nothing decorative behind results.** BrandArt renders on empty and
  input states only.
