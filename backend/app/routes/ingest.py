"""Endpoints for Ingest: run the full pipeline and commit the result.

One document ingests at a time; a second upload of the same content joins
the running job, and a different document is refused with HTTP 409 until
the current run finishes. A finished try run can be promoted without
re-uploading, because the studio still holds its file.
"""
import asyncio
import hashlib
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import bootstrap
from app.pipeline import ingest
from app.pipeline.jobs import INGEST_JOBS, TRY_JOBS, IngestBusy, IngestJob, JobStatus
from app.routes.sse import stage_events
from app.routes.uploads import read_document

router = APIRouter(
    prefix="/api/ingest", tags=["ingest"],
    dependencies=[Depends(bootstrap.require_configured)],
)


class IngestSummary(BaseModel):
    """The library's IngestResult, trimmed to what the UI shows.

    The status "skipped" means this exact content was already fully ingested,
    so the pipeline did not run again."""

    status: Literal["ingested", "skipped"]
    doc_id: str
    category: str
    confidence: float
    pages: int
    sections: int
    chunks: int
    vectors: int


class IngestJobResponse(BaseModel):
    job_id: str
    filename: str
    status: JobStatus
    created: bool = False
    error: str | None = None
    durations: dict[str, float] = Field(default_factory=dict)
    summary: IngestSummary | None = None


def _get_job(job_id: str) -> IngestJob:
    job = INGEST_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such ingest job (it may have expired)")
    return job


def _response(job: IngestJob, created: bool = False) -> IngestJobResponse:
    return IngestJobResponse(
        job_id=job.job_id, filename=job.filename, status=job.status,
        created=created, error=job.error, durations=job.durations,
        summary=IngestSummary(**job.summary) if job.summary else None,
    )


def _start(filename: str, content: bytes) -> IngestJobResponse:
    job_id = hashlib.sha256(content).hexdigest()
    try:
        job, created = INGEST_JOBS.create_or_get(job_id, filename)
    except IngestBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if created:
        job.upload_path.write_bytes(content)
        job.task = asyncio.create_task(ingest.run(job))
    return _response(job, created=created)


@router.post("", response_model=IngestJobResponse)
async def start(file: UploadFile) -> IngestJobResponse:
    filename, content = await read_document(file)
    return _start(filename, content)


@router.post("/from-try/{try_job_id}", response_model=IngestJobResponse)
async def start_from_try(try_job_id: str) -> IngestJobResponse:
    """Promote a try run: ingest the same file without re-uploading it.

    Declared async so that _start can schedule the pipeline task on the
    running event loop; a sync handler would execute on a worker thread."""
    try_job = TRY_JOBS.get(try_job_id)
    if try_job is None or not try_job.upload_path.is_file():
        raise HTTPException(
            status_code=404, detail="the try job has expired; upload the file again"
        )
    return _start(try_job.filename, try_job.upload_path.read_bytes())


@router.get("/{job_id}", response_model=IngestJobResponse)
def get(job_id: str) -> IngestJobResponse:
    return _response(_get_job(job_id))


@router.get("/{job_id}/events")
async def events(job_id: str) -> StreamingResponse:
    return stage_events(_get_job(job_id))
