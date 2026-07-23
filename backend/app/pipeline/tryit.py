"""Runs the try pipeline: parse, classify, split, entirely in memory.

Deliberately composed from the standalone operations instead of ingest():
a try run must never write to S3 or the vector store. The results stay on
the job so the routes can serve page images and shaped views from memory.

ingestlib is imported inside run(), not at module level, so importing the
studio's routes keeps the process free of the library until a configured
user actually starts a run.
"""
import time
from pathlib import Path

from app.pipeline.jobs import TryJob

# A ParseResult with page renders for a large document is heavy, and OCR time
# grows linearly; beyond this cap the honest answer is "use Ingest".
PAGE_CAP = 50


def count_pdf_pages(path: Path) -> int | None:
    """Page count for PDFs, None for office files.

    Office files would need a LibreOffice conversion just to count, so their
    cap is enforced after parsing instead."""
    if path.suffix.lower() != ".pdf":
        return None
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(path))
    try:
        return len(document)
    finally:
        document.close()


async def run(job: TryJob) -> None:
    """Execute the three stages, emitting start/done/failed events with
    durations. Any failure marks the job failed with the stage's error."""
    from ingestlib.operations import aclassify, aparse, asplit

    stage = "parse"
    try:
        pages = count_pdf_pages(job.upload_path)
        if pages is not None and pages > PAGE_CAP:
            raise ValueError(
                f"{pages} pages is over the try limit of {PAGE_CAP}; "
                f"use Ingest for big documents"
            )

        job.emit(stage, "start")
        started = time.perf_counter()
        job.parse_result = await aparse(job.upload_path)
        job.durations[stage] = round(time.perf_counter() - started, 2)
        if job.parse_result.page_count > PAGE_CAP:
            raise ValueError(
                f"{job.parse_result.page_count} pages is over the try limit of "
                f"{PAGE_CAP}; use Ingest for big documents"
            )
        job.emit(stage, "done", seconds=job.durations[stage])

        # Per-run rule overrides: explicit arguments beat any rules.yaml
        # preset (the library guarantees the precedence). No override →
        # None arguments → the preset (or open-ended) applies as usual.
        rules = job.rules

        stage = "classify"
        job.emit(stage, "start")
        started = time.perf_counter()
        job.classify_result = await aclassify(
            job.parse_result,
            categories=dict(rules.classify.rules) if rules and rules.classify.rules else None,
            target_pages=(rules.classify.target_pages or None) if rules else None,
            max_pages=(rules.classify.max_pages or None) if rules else None,
        )
        job.durations[stage] = round(time.perf_counter() - started, 2)
        job.emit(stage, "done", seconds=job.durations[stage])

        stage = "split"
        job.emit(stage, "start")
        started = time.perf_counter()
        job.split_result = await asplit(
            job.parse_result,
            category=job.classify_result.category,
            vocabulary=dict(rules.split.categories) if rules and rules.split.categories else None,
            unmatched=(rules.split.unmatched if rules and rules.split.categories else None),
        )
        job.durations[stage] = round(time.perf_counter() - started, 2)
        job.emit(stage, "done", seconds=job.durations[stage])

        job.finish("done")
    except Exception as exc:  # noqa: BLE001
        # ValueErrors carry our own user-facing messages, such as the page
        # cap; other exceptions keep their type name for diagnosis.
        detail = str(exc) if isinstance(exc, ValueError) else f"{type(exc).__name__}: {exc}"
        job.emit(stage, "failed", detail=detail)
        job.finish("failed", error=detail)
