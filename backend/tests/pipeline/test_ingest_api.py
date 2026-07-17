"""Tests for the ingest endpoints: the gate, validation, the single-run rule,
and try-job promotion. The pipeline itself is stubbed out; the opt-in
end-to-end test at the bottom runs it for real and commits a tiny document
to the machine's configured stack."""
import hashlib
import os
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.pipeline import ingest
from app.pipeline.jobs import INGEST_JOBS, TRY_JOBS
from tests.pipeline.test_tryit_api import MINIMAL_PDF


@pytest.fixture(autouse=True)
def clean_registries():
    yield
    for job_id in list(INGEST_JOBS._jobs):
        INGEST_JOBS.delete(job_id)
    for job_id in list(TRY_JOBS._jobs):
        TRY_JOBS.delete(job_id)


@pytest.fixture()
def stub_run(monkeypatch):
    """Replace the real pipeline with an instant success, so route tests
    never import ingestlib or touch the network."""

    async def fake_run(job):
        job.emit("parse", "start")
        job.emit("parse", "done", seconds=0.1)
        job.summary = {
            "status": "ingested", "doc_id": job.job_id, "category": "report",
            "confidence": 0.9, "pages": 1, "sections": 1, "chunks": 2, "vectors": 2,
        }
        job.finish("done")

    monkeypatch.setattr(ingest, "run", fake_run)


def test_ingest_routes_are_gated_while_unconfigured(client):
    response = client.post("/api/ingest", files={"file": ("a.pdf", MINIMAL_PDF)})
    assert response.status_code == 409


def test_unsupported_extension_is_rejected(configured_client):
    response = configured_client.post("/api/ingest", files={"file": ("notes.txt", b"hello")})
    assert response.status_code == 422


def test_empty_upload_is_rejected(configured_client):
    response = configured_client.post("/api/ingest", files={"file": ("a.pdf", b"")})
    assert response.status_code == 422


def test_unknown_job_is_404(configured_client):
    assert configured_client.get("/api/ingest/deadbeef").status_code == 404


def test_promoting_an_expired_try_job_is_404(configured_client):
    response = configured_client.post("/api/ingest/from-try/deadbeef")
    assert response.status_code == 404
    assert "upload the file again" in response.json()["detail"]


def test_upload_runs_to_a_summary_and_streams_events(configured, stub_run):
    with TestClient(create_app()) as client:
        started = client.post("/api/ingest", files={"file": ("a.pdf", MINIMAL_PDF)}).json()
        assert started["created"] is True

        body = client.get(f"/api/ingest/{started['job_id']}").json()
        assert body["status"] == "done"
        assert body["summary"]["status"] == "ingested"
        assert body["summary"]["chunks"] == 2

        events = client.get(f"/api/ingest/{started['job_id']}/events").text
        assert '"stage": "parse"' in events
        assert '"stage": "job"' in events, "the stream ends with the terminal event"


def test_second_document_is_refused_while_one_ingests(configured_client):
    INGEST_JOBS.create_or_get(hashlib.sha256(b"other").hexdigest(), "other.pdf")
    response = configured_client.post("/api/ingest", files={"file": ("a.pdf", MINIMAL_PDF)})
    assert response.status_code == 409
    assert "other.pdf" in response.json()["detail"]


def test_same_content_joins_the_running_ingest(configured_client):
    job_id = hashlib.sha256(MINIMAL_PDF).hexdigest()
    INGEST_JOBS.create_or_get(job_id, "a.pdf")
    body = configured_client.post(
        "/api/ingest", files={"file": ("a.pdf", MINIMAL_PDF)}
    ).json()
    assert body["created"] is False and body["job_id"] == job_id


def test_promoting_a_try_job_starts_an_ingest(configured, stub_run):
    with TestClient(create_app()) as client:
        try_job, _ = TRY_JOBS.create_or_get("t1", "a.pdf")
        try_job.upload_path.write_bytes(MINIMAL_PDF)

        body = client.post("/api/ingest/from-try/t1").json()
        assert body["created"] is True and body["filename"] == "a.pdf"
        assert body["job_id"] == hashlib.sha256(MINIMAL_PDF).hexdigest(), (
            "the ingest job is keyed by content, not by the try job id"
        )


@pytest.mark.skipif(
    os.environ.get("RUN_STUDIO_INGEST_E2E") != "1",
    reason="ingest e2e is opt-in: set RUN_STUDIO_INGEST_E2E=1 (needs the OCR "
           "server, Bedrock, and this machine's real configuration, and it "
           "commits one tiny document to the configured stack)",
)
def test_full_ingest_end_to_end():
    # The machine's real configuration: ~/.ingestlib or INGESTLIB_CONFIG.
    # The context manager keeps the app's event loop alive between requests,
    # which the background pipeline task needs; a real server always does.
    with TestClient(create_app()) as client:
        started = client.post("/api/ingest", files={"file": ("tiny.pdf", MINIMAL_PDF)}).json()
        job_id = started["job_id"]

        deadline = time.monotonic() + 300
        body = started
        while body["status"] == "running" and time.monotonic() < deadline:
            time.sleep(2)
            body = client.get(f"/api/ingest/{job_id}").json()

        assert body["status"] == "done", body.get("error")
        assert body["summary"]["status"] in ("ingested", "skipped")
        assert body["summary"]["doc_id"] == job_id

        # The same content again takes the library's skip fast path.
        INGEST_JOBS.delete(job_id)
        again = client.post("/api/ingest", files={"file": ("tiny.pdf", MINIMAL_PDF)}).json()
        deadline = time.monotonic() + 60
        while again["status"] == "running" and time.monotonic() < deadline:
            time.sleep(1)
            again = client.get(f"/api/ingest/{job_id}").json()
        assert again["summary"]["status"] == "skipped"
