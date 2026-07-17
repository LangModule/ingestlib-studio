"""In-memory registry for try-run jobs.

A try job holds a full ParseResult, page renders included, so memory is the
constraint: the registry keeps at most two jobs, evicts the oldest first,
and expires finished jobs after a fixed lifetime. Jobs are keyed by the
SHA-256 of the uploaded bytes, so re-uploading the same file joins the
existing run instead of starting a second one.
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

MAX_JOBS = 2
FINISHED_TTL_SECONDS = 15 * 60


class StageEvent(BaseModel):
    """One line of the SSE stream. The stage "job" carries the terminal event."""

    stage: str
    event: Literal["start", "done", "failed"]
    seconds: float | None = None
    detail: str | None = None


class TryJob:
    """One try run: the uploaded file, the event log, and the in-memory results.

    Results are plain attributes rather than typed fields because this module
    must not import ingestlib; the orchestrator assigns them and the shaping
    layer reads them."""

    def __init__(self, job_id: str, filename: str) -> None:
        self.job_id = job_id
        self.filename = filename
        self.created_at = time.monotonic()
        self.finished_at: float | None = None
        self.status: JobStatus = "running"
        self.error: str | None = None
        self.durations: dict[str, float] = {}
        self.events: list[StageEvent] = []
        self.workdir = Path(tempfile.mkdtemp(prefix="studio-try-"))
        self.upload_path = self.workdir / filename
        self.task: asyncio.Task | None = None
        self.parse_result: Any = None
        self.classify_result: Any = None
        self.split_result: Any = None
        self._changed = asyncio.Condition()

    async def emit(self, stage: str, event: Literal["start", "done", "failed"], *,
                   seconds: float | None = None, detail: str | None = None) -> None:
        async with self._changed:
            self.events.append(
                StageEvent(stage=stage, event=event, seconds=seconds, detail=detail)
            )
            self._changed.notify_all()

    async def finish(self, status: JobStatus, error: str | None = None) -> None:
        self.status = status
        self.error = error
        self.finished_at = time.monotonic()
        await self.emit("job", "done" if status == "done" else "failed", detail=error)

    async def stream(self) -> AsyncIterator[StageEvent]:
        """Yield every event from the beginning, then follow live until the
        terminal "job" event. Late subscribers replay the full history."""
        index = 0
        while True:
            async with self._changed:
                while index >= len(self.events):
                    await self._changed.wait()
            while index < len(self.events):
                event = self.events[index]
                index += 1
                yield event
                if event.stage == "job":
                    return

    def dispose(self) -> None:
        """Free everything the job holds: the background task, the uploaded
        file, and the in-memory results."""
        if self.task is not None and not self.task.done():
            self.task.cancel()
        shutil.rmtree(self.workdir, ignore_errors=True)
        self.parse_result = None
        self.classify_result = None
        self.split_result = None


class TryJobRegistry:
    """Bounded, ordered store of try jobs. Eviction always calls dispose()."""

    def __init__(self, max_jobs: int = MAX_JOBS,
                 finished_ttl_seconds: float = FINISHED_TTL_SECONDS) -> None:
        self.max_jobs = max_jobs
        self.finished_ttl_seconds = finished_ttl_seconds
        self._jobs: OrderedDict[str, TryJob] = OrderedDict()

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

    def get(self, job_id: str) -> TryJob | None:
        self._evict_expired()
        return self._jobs.get(job_id)

    def delete(self, job_id: str) -> bool:
        job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        job.dispose()
        return True


JOBS = TryJobRegistry()
