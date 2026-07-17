"""Tests for the try-job registry: dedup, eviction, and event streaming.

Pure asyncio and filesystem; no network, no ingestlib."""
import asyncio

import pytest

from app.pipeline.jobs import TryJobRegistry


@pytest.fixture()
def registry():
    reg = TryJobRegistry(max_jobs=2, finished_ttl_seconds=15 * 60)
    yield reg
    for job_id in list(reg._jobs):
        reg.delete(job_id)


def test_same_content_joins_the_existing_job(registry):
    first, created_first = registry.create_or_get("abc", "a.pdf")
    second, created_second = registry.create_or_get("abc", "a.pdf")
    assert created_first is True and created_second is False
    assert first is second


def test_lru_eviction_disposes_the_oldest(registry):
    oldest, _ = registry.create_or_get("one", "1.pdf")
    registry.create_or_get("two", "2.pdf")
    registry.create_or_get("three", "3.pdf")
    assert registry.get("one") is None, "the registry holds at most two jobs"
    assert not oldest.workdir.exists(), "eviction must remove the uploaded file"


async def test_finished_jobs_expire_but_running_jobs_do_not(registry):
    registry.finished_ttl_seconds = 0.0
    finished, _ = registry.create_or_get("done", "d.pdf")
    await finished.finish("done")
    running, _ = registry.create_or_get("running", "r.pdf")
    assert registry.get("done") is None, "a finished job past its lifetime expires"
    assert registry.get("running") is running, "a running job never expires"


async def test_stream_replays_history_and_ends_at_the_terminal_event(registry):
    job, _ = registry.create_or_get("abc", "a.pdf")
    await job.emit("parse", "start")
    await job.emit("parse", "done", seconds=1.5)

    async def finish_later():
        await asyncio.sleep(0.01)
        await job.finish("done")

    task = asyncio.create_task(finish_later())
    received = [(event.stage, event.event) async for event in job.stream()]
    await task
    assert received == [("parse", "start"), ("parse", "done"), ("job", "done")]


async def test_failed_job_carries_the_error(registry):
    job, _ = registry.create_or_get("abc", "a.pdf")
    await job.finish("failed", error="parse blew up")
    assert job.status == "failed" and job.error == "parse blew up"
    events = [event async for event in job.stream()]
    assert events[-1].stage == "job" and events[-1].event == "failed"
    assert events[-1].detail == "parse blew up"
