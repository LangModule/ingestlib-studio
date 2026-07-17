"""Tests for the job registries: dedup, eviction, and event streaming.

Pure asyncio and filesystem; no network, no ingestlib."""
import asyncio

import pytest

from app.pipeline.jobs import IngestBusy, IngestJobRegistry, TryJobRegistry


@pytest.fixture()
def registry():
    reg = TryJobRegistry(max_jobs=2, finished_ttl_seconds=15 * 60)
    yield reg
    for job_id in list(reg._jobs):
        reg.delete(job_id)


@pytest.fixture()
def ingest_registry():
    reg = IngestJobRegistry(max_jobs=3, finished_ttl_seconds=15 * 60)
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


def test_finished_jobs_expire_but_running_jobs_do_not(registry):
    registry.finished_ttl_seconds = 0.0
    finished, _ = registry.create_or_get("done", "d.pdf")
    finished.finish("done")
    running, _ = registry.create_or_get("running", "r.pdf")
    assert registry.get("done") is None, "a finished job past its lifetime expires"
    assert registry.get("running") is running, "a running job never expires"


async def test_stream_replays_history_and_ends_at_the_terminal_event(registry):
    job, _ = registry.create_or_get("abc", "a.pdf")
    job.emit("parse", "start")
    job.emit("parse", "done", seconds=1.5)

    async def finish_later():
        await asyncio.sleep(0.01)
        job.finish("done")

    task = asyncio.create_task(finish_later())
    received = [(event.stage, event.event) async for event in job.stream()]
    await task
    assert received == [("parse", "start"), ("parse", "done"), ("job", "done")]


async def test_two_subscribers_both_receive_every_event(registry):
    job, _ = registry.create_or_get("abc", "a.pdf")
    job.emit("parse", "start")

    async def collect():
        return [event.event async for event in job.stream()]

    first = asyncio.create_task(collect())
    second = asyncio.create_task(collect())
    await asyncio.sleep(0.01)
    job.finish("done")
    assert await first == ["start", "done"]
    assert await second == ["start", "done"]


async def test_failed_job_carries_the_error(registry):
    job, _ = registry.create_or_get("abc", "a.pdf")
    job.finish("failed", error="parse blew up")
    assert job.status == "failed" and job.error == "parse blew up"
    events = [event async for event in job.stream()]
    assert events[-1].stage == "job" and events[-1].event == "failed"
    assert events[-1].detail == "parse blew up"


def test_ingest_same_content_joins_the_running_job(ingest_registry):
    first, created_first = ingest_registry.create_or_get("abc", "a.pdf")
    second, created_second = ingest_registry.create_or_get("abc", "a.pdf")
    assert created_first is True and created_second is False
    assert first is second


def test_ingest_refuses_a_second_document_while_one_runs(ingest_registry):
    ingest_registry.create_or_get("abc", "a.pdf")
    with pytest.raises(IngestBusy, match="a.pdf"):
        ingest_registry.create_or_get("def", "b.pdf")


def test_ingest_accepts_a_new_document_after_the_run_finishes(ingest_registry):
    job, _ = ingest_registry.create_or_get("abc", "a.pdf")
    job.finish("done")
    _, created = ingest_registry.create_or_get("def", "b.pdf")
    assert created is True


def test_ingest_evicts_only_finished_jobs_at_the_cap(ingest_registry):
    oldest, _ = ingest_registry.create_or_get("one", "1.pdf")
    oldest.finish("done")
    for job_id in ("two", "three"):
        job, _ = ingest_registry.create_or_get(job_id, f"{job_id}.pdf")
        job.finish("done")
    ingest_registry.create_or_get("four", "4.pdf")
    assert ingest_registry.get("one") is None, "the oldest finished job is evicted"
    assert not oldest.workdir.exists(), "eviction must remove the uploaded file"
    assert ingest_registry.get("four") is not None
