"""Endpoints for Try it: run the pipeline on an upload without storing anything.

Uploads are hashed, so re-sending the same file joins the existing job. Page
and figure images stream straight from the in-memory ParseResult, so they
disappear with the job when it is evicted or deleted; that is by design.
"""
import asyncio
import hashlib

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from app import bootstrap
from app.documents.schemas import DocumentView
from app.documents.shaping import shape_document
from app.pipeline import tryit
from app.pipeline.jobs import TRY_JOBS, JobStatus, TryJob
from app.routes.sse import stage_events
from app.routes.uploads import read_document
from app.setup.schemas import RulesConfig

router = APIRouter(
    prefix="/api/try", tags=["try"],
    dependencies=[Depends(bootstrap.require_configured)],
)


class TryJobResponse(BaseModel):
    job_id: str
    filename: str
    status: JobStatus
    created: bool = False
    error: str | None = None
    durations: dict[str, float] = Field(default_factory=dict)
    result: DocumentView | None = None


def _get_job(job_id: str) -> TryJob:
    job = TRY_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such try job (it may have expired)")
    return job


def _get_page(job_id: str, page_num: int):
    """The parsed page for an image route, with the shared failure handling."""
    job = _get_job(job_id)
    if job.parse_result is None:
        raise HTTPException(status_code=409, detail="the parse stage has not finished yet")
    try:
        return job.parse_result.page_by_num(page_num)
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _response(job: TryJob, created: bool = False) -> TryJobResponse:
    result = None
    if job.status == "done":
        result = shape_document(
            job.filename, job.parse_result, job.classify_result, job.split_result,
            base_url=f"/api/try/{job.job_id}",
        )
    return TryJobResponse(
        job_id=job.job_id, filename=job.filename, status=job.status,
        created=created, error=job.error, durations=job.durations, result=result,
    )


@router.post("", response_model=TryJobResponse)
async def start(file: UploadFile, rules: str | None = Form(None)) -> TryJobResponse:
    """Run the try pipeline, optionally with per-run rule overrides.

    `rules` is a JSON-encoded RulesConfig riding alongside the file in the
    multipart form. It shapes the job key: the same document tried with
    different rules is a different job, never a cached result."""
    filename, content = await read_document(file)
    overrides: RulesConfig | None = None
    if rules:
        try:
            overrides = RulesConfig.model_validate_json(rules)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if overrides.is_empty():
            overrides = None

    hasher = hashlib.sha256(content)
    if overrides is not None:
        hasher.update(overrides.model_dump_json().encode())
    job_id = hasher.hexdigest()

    job, created = TRY_JOBS.create_or_get(job_id, filename)
    if created:
        job.rules = overrides
        job.upload_path.write_bytes(content)
        job.task = asyncio.create_task(tryit.run(job))
    return _response(job, created=created)


@router.get("/{job_id}", response_model=TryJobResponse)
def get(job_id: str) -> TryJobResponse:
    return _response(_get_job(job_id))


@router.get("/{job_id}/events")
async def events(job_id: str) -> StreamingResponse:
    return stage_events(_get_job(job_id))


@router.get("/{job_id}/pages/{page_num}/image")
def page_image(job_id: str, page_num: int) -> Response:
    page = _get_page(job_id, page_num)
    if page.image_bytes is None:
        raise HTTPException(status_code=404, detail=f"page {page_num} has no render")
    return Response(content=page.image_bytes, media_type="image/png")


@router.get("/{job_id}/pages/{page_num}/figures/{region_id}/image")
def figure_image(job_id: str, page_num: int, region_id: int) -> Response:
    page = _get_page(job_id, page_num)
    for figure in page.figures:
        if figure.region_id == region_id and figure.image_bytes:
            return Response(content=figure.image_bytes, media_type="image/png")
    raise HTTPException(status_code=404, detail=f"no figure {region_id} on page {page_num}")


@router.delete("/{job_id}")
def delete(job_id: str) -> dict[str, bool]:
    if not TRY_JOBS.delete(job_id):
        raise HTTPException(status_code=404, detail="no such try job")
    return {"deleted": True}
