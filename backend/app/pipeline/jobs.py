"""In-memory registries for pipeline jobs.

Both job kinds are keyed by the SHA-256 of the uploaded bytes, so re-uploading
the same file joins the existing job instead of starting a second one, and
both expire a fixed time after finishing. They differ in what they hold: a
try job keeps a full ParseResult in memory, page renders included, so its
registry allows at most two jobs and evicts the oldest first; an ingest job
persists everything to S3 and the vector store and keeps only a summary, but
exactly one may run at a time, because a committed run saturates the OCR
server on its own.
"""
import asyncio
import shutil
import tempfile
import time
from collections import OrderedDict
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel

JobStatus = Literal["running", "done", "failed"]

SUPPORTED_SUFFIXES = (".pdf", ".docx", ".pptx")

MAX_TRY_JOBS = 2
MAX_INGEST_JOBS = 8
FINISHED_TTL_SECONDS = 15 * 60


class StageEvent(BaseModel):
    """One line of the SSE stream. The stage "job" carries the terminal event."""

    stage: str
    event: Literal["start", "done", "failed"]
    seconds: float | None = None
    detail: str | None = None


class Job:
    """Machinery shared by every job: the uploaded file, the event log, and
    live streaming.

    emit() and finish() are synchronous so the library's on_stage callback,
    which is a plain function, can drive them directly."""

    _workdir_prefix = "studio-job-"

    def __init__(self, job_id: str, filename: str) -> None:
        self.job_id = job_id
        self.filename = filename
        self.finished_at: float | None = None
        self.status: JobStatus = "running"
        self.error: str | None = None
        self.durations: dict[str, float] = {}
        self.events: list[StageEvent] = []
        self.workdir = Path(tempfile.mkdtemp(prefix=self._workdir_prefix))
        self.upload_path = self.workdir / filename
        self.task: asyncio.Task | None = None
        self._changed = asyncio.Event()

    def emit(self, stage: str, event: Literal["start", "done", "failed"], *,
             seconds: float | None = None, detail: str | None = None) -> None:
        self.events.append(
            StageEvent(stage=stage, event=event, seconds=seconds, detail=detail)
        )
        self._changed.set()

    def finish(self, status: JobStatus, error: str | None = None) -> None:
        self.status = status
        self.error = error
        self.finished_at = time.monotonic()
        self.emit("job", "done" if status == "done" else "failed", detail=error)

    async def stream(self) -> AsyncIterator[StageEvent]:
        """Yield every event from the beginning, then follow live until the
        terminal "job" event. Late subscribers replay the full history."""
        index = 0
        while True:
            while index < len(self.events):
                event = self.events[index]
                index += 1
                yield event
                if event.stage == "job":
                    return
            self._changed.clear()
            if index >= len(self.events):
                await self._changed.wait()

    def dispose(self) -> None:
        """Free everything the job holds: the background task and the
        uploaded file. Subclasses release their results on top."""
        if self.task is not None and not self.task.done():
            self.task.cancel()
        shutil.rmtree(self.workdir, ignore_errors=True)


class TryJob(Job):
    """One try run, holding its results in memory.

    Results are plain attributes rather than typed fields because this module
    must not import ingestlib; the orchestrator assigns them and the shaping
    layer reads them."""

    _workdir_prefix = "studio-try-"

    def __init__(self, job_id: str, filename: str) -> None:
        super().__init__(job_id, filename)
        self.parse_result: Any = None
        self.classify_result: Any = None
        self.split_result: Any = None

    def dispose(self) -> None:
        super().dispose()
        self.parse_result = None
        self.classify_result = None
        self.split_result = None


class IngestJob(Job):
    """One committed run. The pipeline persists everything to S3 and the
    vector store, so the job keeps only a summary of the outcome."""

    _workdir_prefix = "studio-ingest-"

    def __init__(self, job_id: str, filename: str) -> None:
        super().__init__(job_id, filename)
        self.summary: dict[str, Any] | None = None


class JobRegistry[J: Job]:
    """Bookkeeping shared by both registries: expiry, lookup, and deletion.
    Anything that leaves the registry is disposed. Subclasses define the
    admission policy in create_or_get()."""

    def __init__(self, max_jobs: int, finished_ttl_seconds: float) -> None:
        self.max_jobs = max_jobs
        self.finished_ttl_seconds = finished_ttl_seconds
        self._jobs: OrderedDict[str, J] = OrderedDict()

    def _evict_expired(self) -> None:
        now = time.monotonic()
        for job_id in list(self._jobs):
            job = self._jobs[job_id]
            expired = (
                job.finished_at is not None
                and now - job.finished_at > self.finished_ttl_seconds
            )
            if expired:
                self._jobs.pop(job_id).dispose()

    def get(self, job_id: str) -> J | None:
        self._evict_expired()
        return self._jobs.get(job_id)

    def delete(self, job_id: str) -> bool:
        job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        job.dispose()
        return True


class TryJobRegistry(JobRegistry[TryJob]):
    """Store of try jobs: at most two, the oldest evicted first."""

    def __init__(self, max_jobs: int = MAX_TRY_JOBS,
                 finished_ttl_seconds: float = FINISHED_TTL_SECONDS) -> None:
        super().__init__(max_jobs, finished_ttl_seconds)

    def create_or_get(self, job_id: str, filename: str) -> tuple[TryJob, bool]:
        """Return (job, created). An existing job for the same content is
        reused whatever its state; the caller decides what that means."""
        self._evict_expired()
        existing = self._jobs.get(job_id)
        if existing is not None:
            self._jobs.move_to_end(job_id)
            return existing, False
        while len(self._jobs) >= self.max_jobs:
            _, oldest = self._jobs.popitem(last=False)
            oldest.dispose()
        job = TryJob(job_id, filename)
        self._jobs[job_id] = job
        return job, True


class IngestBusy(Exception):
    """Raised when a new document arrives while another ingest is running."""


class IngestJobRegistry(JobRegistry[IngestJob]):
    """Store of ingest jobs: one runs at a time, finished ones are kept
    briefly as records."""

    def __init__(self, max_jobs: int = MAX_INGEST_JOBS,
                 finished_ttl_seconds: float = FINISHED_TTL_SECONDS) -> None:
        super().__init__(max_jobs, finished_ttl_seconds)

    def running(self) -> IngestJob | None:
        for job in self._jobs.values():
            if job.status == "running":
                return job
        return None

    def create_or_get(self, job_id: str, filename: str) -> tuple[IngestJob, bool]:
        """Return (job, created). The same content joins the existing job;
        a different document while one is running raises IngestBusy."""
        self._evict_expired()
        existing = self._jobs.get(job_id)
        if existing is not None:
            self._jobs.move_to_end(job_id)
            return existing, False
        active = self.running()
        if active is not None:
            raise IngestBusy(
                f"{active.filename} is still ingesting; wait for it to finish"
            )
        # Everything in the registry is finished here, so eviction is safe.
        while len(self._jobs) >= self.max_jobs:
            _, oldest = self._jobs.popitem(last=False)
            oldest.dispose()
        job = IngestJob(job_id, filename)
        self._jobs[job_id] = job
        return job, True


TRY_JOBS = TryJobRegistry()
INGEST_JOBS = IngestJobRegistry()
# Backfill runs are ingest-shaped (an event log plus a summary), and the
# one-at-a-time admission rule fits them for the same reason.
BACKFILL_JOBS = IngestJobRegistry()
