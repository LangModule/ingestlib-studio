"""Endpoints for the Settings page: view, edit, and backfill.

Edits are allowed only for the wizard-written configuration; a file
managed through INGESTLIB_CONFIG or discovered in the working directory
belongs to whoever put it there, so it renders read-only. Saving rewrites
~/.ingestlib through the same writer the wizard uses, then resets the
library's cached configuration, so the change applies in-process with no
restart.
"""
import asyncio
import sys

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import bootstrap
from app.documents import registry
from app.pipeline import backfill
from app.pipeline.jobs import BACKFILL_JOBS, IngestBusy, IngestJob, JobStatus
from app.routes.sse import stage_events
from app.setup import runtime, writer
from app.setup.schemas import CompleteRequest

router = APIRouter(
    prefix="/api/settings", tags=["settings"],
    dependencies=[Depends(bootstrap.require_configured)],
)


class SettingsView(BaseModel):
    source: str
    config_path: str
    editable: bool
    profile: str
    region: str
    account_id: str
    bucket: str
    vector_store: str
    reranker: str
    ocr_backend: str
    ocr_url: str
    # Names of the secrets present in .env; the values never leave the backend.
    secrets_set: list[str]


class BackfillStatus(BaseModel):
    store: str
    documents: int
    in_store: int
    missing: int


class BackfillSummary(BaseModel):
    documents: int
    vectors: int
    store: str


class BackfillJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    error: str | None = None
    durations: dict[str, float] = Field(default_factory=dict)
    # Filenames still to process, in run order; the UI feeds them to the stepper.
    pending: list[str] = Field(default_factory=list)
    summary: BackfillSummary | None = None


def _view() -> SettingsView:
    _, path, source = bootstrap.resolve()
    config = runtime.read_runtime_config()
    if config is None or path is None:
        raise HTTPException(status_code=500, detail="the configuration file is unreadable")
    return SettingsView(
        source=source or "wizard",
        config_path=path,
        editable=source == "wizard",
        profile=config.profile,
        region=config.region,
        account_id=config.account_id,
        bucket=config.bucket,
        vector_store=config.vector_store,
        reranker=config.reranker,
        ocr_backend=config.ocr_backend,
        ocr_url=config.ocr_url,
        secrets_set=sorted(config.secrets),
    )


def _reset_library() -> None:
    """Make the running library re-read the files on its next use.

    Skipped when the library was never imported: there is nothing cached
    yet, and importing it here just to reset it would be backwards."""
    if "ingestlib" in sys.modules:
        from ingestlib.config import reset_config

        reset_config()


@router.get("", response_model=SettingsView)
def get_settings() -> SettingsView:
    return _view()


@router.put("", response_model=SettingsView)
def update_settings(body: CompleteRequest) -> SettingsView:
    current = _view()
    if not current.editable:
        raise HTTPException(
            status_code=409,
            detail=f"this configuration is managed externally ({current.source}); "
                   f"edit {current.config_path} where it lives",
        )
    # The UI sends only the secrets the user typed; everything already in
    # .env is kept, so masked values survive a save and a store switched
    # away from keeps its key for backfilling back.
    existing = runtime.read_runtime_config()
    merged = dict(existing.secrets if existing else {})
    merged.update({key: value for key, value in body.secrets.items() if value})
    try:
        writer.write_and_activate(body.model_copy(update={"secrets": merged}))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _reset_library()
    registry.clear_caches()
    return _view()


@router.get("/backfill", response_model=BackfillStatus)
async def backfill_status() -> BackfillStatus:
    status, _ = await asyncio.to_thread(backfill.pending)
    return BackfillStatus(**status)


def _get_job(job_id: str) -> IngestJob:
    job = BACKFILL_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such backfill run (it may have expired)")
    return job


def _job_response(job: IngestJob, pending: list[str] | None = None) -> BackfillJobResponse:
    return BackfillJobResponse(
        job_id=job.job_id, status=job.status, error=job.error,
        durations=job.durations, pending=pending or [],
        summary=BackfillSummary(**job.summary) if job.summary else None,
    )


@router.post("/backfill", response_model=BackfillJobResponse)
async def backfill_start() -> BackfillJobResponse:
    status, missing = await asyncio.to_thread(backfill.pending)
    store = str(status["store"])
    if not missing:
        raise HTTPException(
            status_code=409,
            detail=f"every ingested document is already in {store}",
        )
    # Keyed by target store: re-posting joins the running run for that store.
    try:
        job, created = BACKFILL_JOBS.create_or_get(f"backfill-{store}", store)
    except IngestBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if created:
        job.task = asyncio.create_task(backfill.run(job, missing))
    return _job_response(job, pending=[filename for _, filename in missing])


@router.get("/backfill/{job_id}", response_model=BackfillJobResponse)
def backfill_get(job_id: str) -> BackfillJobResponse:
    return _job_response(_get_job(job_id))


@router.get("/backfill/{job_id}/events")
async def backfill_events(job_id: str) -> StreamingResponse:
    return stage_events(_get_job(job_id))
