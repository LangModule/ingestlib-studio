import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, followStageEvents } from "../api/client";
import type { IngestJobResponse, StageEvent } from "../api/types";
import { BrandArt } from "../components/BrandArt";
import { Dropzone } from "../components/Dropzone";
import { StageStepper } from "../components/pipeline/StageStepper";
import { Button, Card } from "../components/setup/ui";

/* Ingest: commit a document to the stack. The library persists parsed pages
   and results to S3, then embeds the chunks and upserts them into the vector
   store; this page relays the five stages live and ends on an outcome
   summary. One document ingests at a time. */

const STAGES = ["parse", "classify", "split", "embed", "upsert"];

type Phase =
  | { name: "idle" }
  | { name: "running"; job: IngestJobResponse; events: StageEvent[] }
  | { name: "done"; job: IngestJobResponse }
  | { name: "failed"; error: string };

export default function Ingest() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [ocrOnline, setOcrOnline] = useState<boolean | null>(null);
  const source = useRef<EventSource | null>(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const settle = (job: IngestJobResponse) => {
    setPhase(
      job.status === "done"
        ? { name: "done", job }
        : { name: "failed", error: job.error ?? "the run failed" },
    );
  };

  const follow = (job: IngestJobResponse) => {
    source.current = followStageEvents(
      api.ingestEventsUrl(job.job_id),
      (events) => setPhase({ name: "running", job, events }),
      async () => settle(await api.ingestGet(job.job_id)),
      () =>
        setPhase({
          name: "failed",
          error: "lost the event stream; the backend may have restarted",
        }),
    );
    setPhase({ name: "running", job, events: [] });
  };

  useEffect(() => {
    api.status().then((status) => setOcrOnline(status.checks.ocr === "ok"));
    // Runs once on mount. Try it lands here with ?job= after promoting a
    // reviewed file; resume that job instead of starting from the dropzone.
    const jobId = params.get("job");
    if (jobId) {
      api
        .ingestGet(jobId)
        .then((job) => (job.status === "running" ? follow(job) : settle(job)))
        .catch((error) =>
          setPhase({
            name: "failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }
    return () => source.current?.close();
  }, []);

  const uploadFile = async (file: File) => {
    try {
      const job = await api.ingestStart(file);
      if (job.status === "running") follow(job);
      else settle(job);
    } catch (error) {
      setPhase({
        name: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const reset = () => {
    setParams({});
    setPhase({ name: "idle" });
  };

  if (phase.name === "done" && phase.job.summary) {
    const summary = phase.job.summary;
    const skipped = summary.status === "skipped";
    const rows: [string, string][] = [
      [
        "Category",
        skipped
          ? summary.category
          : `${summary.category} · ${(summary.confidence * 100).toFixed(0)}% confidence`,
      ],
      ["Pages", String(summary.pages)],
      ["Sections", String(summary.sections)],
      ["Chunks", String(summary.chunks)],
      ["Vectors", String(summary.vectors)],
      ["Document ID", summary.doc_id],
    ];
    const timings = STAGES.filter((stage) => stage in phase.job.durations)
      .map((stage) => `${stage} ${phase.job.durations[stage].toFixed(1)}s`)
      .join(" · ");

    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <BrandArt />
        <Card className="flex flex-col gap-4">
          <div>
            <h1 className={`text-lg font-semibold ${skipped ? "text-amber" : "text-ok"}`}>
              {skipped ? "Already in your library" : "Ingested ✓"}
            </h1>
            <p className="mono mt-1 truncate text-sm text-ink-soft">{phase.job.filename}</p>
            {skipped && (
              <p className="mt-2 text-sm text-ink-soft">
                This exact file was ingested before, so the pipeline did not run again.
              </p>
            )}
          </div>
          <dl className="flex flex-col gap-2">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-6 border-b border-line pb-2 last:border-0"
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  {label}
                </dt>
                <dd className="mono truncate text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          {timings && <p className="mono text-xs text-ink-soft">{timings}</p>}
          <div className="flex justify-between">
            <Button kind="ghost" onClick={reset}>Ingest another</Button>
            <Button onClick={() => navigate(`/documents/${summary.doc_id}`)}>
              Open the document →
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <BrandArt />
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Ingest</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Commits a document to your stack: parsed pages and results to S3, chunks and
          embeddings to your vector store. Re-ingesting the same file is skipped
          automatically.
        </p>
      </header>

      {ocrOnline === false && (
        <Card className="mb-4 border-fail bg-fail-soft">
          <p className="text-sm">
            The OCR server is offline, and Ingest needs it. Start it, then check again.
          </p>
          <Button
            kind="ghost"
            className="mt-2"
            onClick={() => api.status().then((s) => setOcrOnline(s.checks.ocr === "ok"))}
          >
            Check again
          </Button>
        </Card>
      )}

      {phase.name === "running" && (
        <Card className="flex flex-col gap-4">
          <span className="mono truncate text-sm text-ink-soft">{phase.job.filename}</span>
          <StageStepper stages={STAGES} events={phase.events} />
          <p className="text-xs text-ink-soft">
            Parsing runs the OCR server page by page; a few seconds per page is normal.
          </p>
        </Card>
      )}

      {phase.name === "failed" && (
        <Card className="mb-4 border-fail bg-fail-soft">
          <p className="text-sm text-fail">{phase.error}</p>
          <Button kind="ghost" className="mt-3" onClick={reset}>
            Start over
          </Button>
        </Card>
      )}

      {phase.name === "idle" && (
        <Dropzone
          hint="PDF · DOCX · PPTX · no page limit"
          disabled={ocrOnline === false}
          onFile={uploadFile}
        />
      )}
    </div>
  );
}
