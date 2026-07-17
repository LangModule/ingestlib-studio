"""Runs a committed ingest through the library's full pipeline.

aingest() does the real work: it persists every stage's output to S3, embeds
the chunks, and upserts them into the vector store. The studio only relays
progress, by translating the library's on_stage callback into the job's
event stream with per-stage seconds added.

ingestlib is imported inside run(), not at module level, so importing the
studio's routes keeps the process free of the library until a configured
user actually starts a run.
"""
import time

from app.pipeline.jobs import IngestJob


async def run(job: IngestJob) -> None:
    """Execute the full pipeline, relaying stage progress to the job.

    aingest raises on failure, so the stage that most recently started is
    the one reported failed. A document that was already fully ingested
    returns the skipped summary without emitting any stage events."""
    from ingestlib.services.ingest import aingest

    started: dict[str, float] = {}
    current = "parse"

    def on_stage(stage: str, event: str) -> None:
        nonlocal current
        if event == "start":
            current = stage
            started[stage] = time.perf_counter()
            job.emit(stage, "start")
        elif event == "done":
            seconds = round(time.perf_counter() - started.get(stage, time.perf_counter()), 2)
            job.durations[stage] = seconds
            job.emit(stage, "done", seconds=seconds)

    try:
        result = await aingest(job.upload_path, on_stage=on_stage)
        job.summary = {
            "status": result.status,
            "doc_id": result.doc_id,
            "category": result.category,
            "confidence": result.confidence,
            "pages": result.pages,
            "sections": result.sections,
            "chunks": result.chunks,
            "vectors": result.vectors,
        }
        job.finish("done")
    except Exception as exc:  # noqa: BLE001
        detail = f"{type(exc).__name__}: {exc}"
        job.emit(current, "failed", detail=detail)
        job.finish("failed", error=detail)
