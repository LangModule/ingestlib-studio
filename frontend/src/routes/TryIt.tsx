import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, followStageEvents } from "../api/client";
import type { StageEvent, TryJobResponse } from "../api/types";
import { BrandArt } from "../components/BrandArt";
import { Dropzone } from "../components/Dropzone";
import { StageStepper } from "../components/pipeline/StageStepper";
import { ReviewShell } from "../components/review/ReviewShell";
import { Button, Card } from "../components/setup/ui";

/* Try it: run the pipeline on a file without storing anything, then inspect
   the result in the review shell. "Looks right → Ingest it" promotes the
   reviewed file into a committed run on the Ingest page. */

const STAGES = ["parse", "classify", "split"];

type Phase =
  | { name: "idle" }
  | { name: "running"; job: TryJobResponse; events: StageEvent[] }
  | { name: "done"; job: TryJobResponse }
  | { name: "failed"; error: string };

export default function TryIt() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [promoting, setPromoting] = useState(false);
  const [ocrOnline, setOcrOnline] = useState<boolean | null>(null);
  const source = useRef<EventSource | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.status().then((status) => setOcrOnline(status.checks.ocr === "ok"));
    return () => source.current?.close();
  }, []);

  const follow = (job: TryJobResponse) => {
    source.current = followStageEvents(
      api.tryEventsUrl(job.job_id),
      (events) => setPhase({ name: "running", job, events }),
      async () => {
        const finished = await api.tryGet(job.job_id);
        setPhase(
          finished.status === "done"
            ? { name: "done", job: finished }
            : { name: "failed", error: finished.error ?? "the run failed" },
        );
      },
      () =>
        setPhase({
          name: "failed",
          error: "lost the event stream; the backend may have restarted",
        }),
    );
    setPhase({ name: "running", job, events: [] });
  };

  const uploadFile = async (file: File) => {
    try {
      const job = await api.tryStart(file);
      // Re-uploading a file that already finished skips straight to review.
      if (job.status === "done") setPhase({ name: "done", job });
      else if (job.status === "failed") setPhase({ name: "failed", error: job.error ?? "failed" });
      else follow(job);
    } catch (error) {
      setPhase({ name: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const discard = async () => {
    if (phase.name === "done") await api.tryDelete(phase.job.job_id).catch(() => undefined);
    setPhase({ name: "idle" });
  };

  const ingestIt = async () => {
    if (phase.name !== "done") return;
    setPromoting(true);
    try {
      // The backend still holds the try upload, so no re-upload is needed.
      const job = await api.ingestFromTry(phase.job.job_id);
      navigate(`/ingest?job=${job.job_id}`);
    } catch (error) {
      setPromoting(false);
      setPhase({ name: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  };

  if (phase.name === "done" && phase.job.result) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <ReviewShell
          document={phase.job.result}
          footer={
            <div className="flex justify-between border-t border-line pt-4">
              <Button kind="ghost" onClick={discard}>Discard</Button>
              <Button onClick={ingestIt} disabled={promoting}>
                {promoting ? "Starting…" : "Looks right → Ingest it"}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <BrandArt />
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Try it</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Runs parse, classify, and split on your file entirely in memory. Nothing is
          written to S3 or the vector store; documents up to 50 pages.
        </p>
      </header>

      {ocrOnline === false && (
        <Card className="mb-4 border-fail bg-fail-soft">
          <p className="text-sm">
            The OCR server is offline, and Try it needs it. Start it, then check again.
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
          <Button kind="ghost" className="mt-3" onClick={() => setPhase({ name: "idle" })}>
            Try another file
          </Button>
        </Card>
      )}

      {phase.name === "idle" && (
        <Dropzone
          hint="PDF · DOCX · PPTX, up to 50 pages"
          disabled={ocrOnline === false}
          onFile={uploadFile}
        />
      )}
    </div>
  );
}
