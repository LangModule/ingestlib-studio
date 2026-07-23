"""Tests for the try endpoints: the gate, validation, and missing jobs.

The full pipeline needs the OCR server and Bedrock, so it runs only in the
opt-in end-to-end test at the bottom."""
import os
import time

import pytest

# A minimal but valid single-page PDF; enough for the loader to open it.
MINIMAL_PDF = (
    b"%PDF-1.1\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
)


def test_try_routes_are_gated_while_unconfigured(client):
    response = client.post("/api/try", files={"file": ("a.pdf", MINIMAL_PDF)})
    assert response.status_code == 409


def test_unsupported_extension_is_rejected(configured_client):
    response = configured_client.post("/api/try", files={"file": ("notes.txt", b"hello")})
    assert response.status_code == 422
    assert ".pdf" in response.json()["detail"]


def test_empty_upload_is_rejected(configured_client):
    response = configured_client.post("/api/try", files={"file": ("a.pdf", b"")})
    assert response.status_code == 422


def test_unknown_job_is_404(configured_client):
    assert configured_client.get("/api/try/deadbeef").status_code == 404
    assert configured_client.delete("/api/try/deadbeef").status_code == 404


@pytest.fixture()
def stub_pipeline(monkeypatch):
    """Replace the try pipeline with a no-op so job-key tests never parse."""
    from app.pipeline import tryit as tryit_module
    from app.pipeline.jobs import TRY_JOBS

    async def instant(job):
        return None

    monkeypatch.setattr(tryit_module, "run", instant)
    yield
    for job_id in list(TRY_JOBS._jobs):
        TRY_JOBS.delete(job_id)


def test_rules_override_keys_a_distinct_job(configured_client, stub_pipeline):
    from app.pipeline.jobs import TRY_JOBS

    pdf = MINIMAL_PDF + b"%rules-key-test\n"
    rules = '{"classify": {"rules": {"invoice": "itemized charges"}}}'

    plain = configured_client.post("/api/try", files={"file": ("a.pdf", pdf)}).json()
    ruled = configured_client.post(
        "/api/try", files={"file": ("a.pdf", pdf)}, data={"rules": rules}
    ).json()
    assert plain["job_id"] != ruled["job_id"], (
        "the same file with different rules must never share a cached job"
    )
    assert plain["created"] and ruled["created"]

    again = configured_client.post(
        "/api/try", files={"file": ("a.pdf", pdf)}, data={"rules": rules}
    ).json()
    assert again["job_id"] == ruled["job_id"] and not again["created"]

    job = TRY_JOBS.get(ruled["job_id"])
    assert job.rules.classify.rules == {"invoice": "itemized charges"}


def test_empty_rules_override_joins_the_plain_job(configured_client, stub_pipeline):
    pdf = MINIMAL_PDF + b"%empty-rules-test\n"
    plain = configured_client.post("/api/try", files={"file": ("a.pdf", pdf)}).json()
    empty = configured_client.post(
        "/api/try", files={"file": ("a.pdf", pdf)}, data={"rules": "{}"}
    ).json()
    assert empty["job_id"] == plain["job_id"], "no-op overrides must not fork the job"


def test_invalid_rules_are_422(configured_client, stub_pipeline):
    bad_json = configured_client.post(
        "/api/try", files={"file": ("a.pdf", MINIMAL_PDF)}, data={"rules": "{not json"}
    )
    assert bad_json.status_code == 422

    orphan_mode = '{"split": {"categories": {}, "unmatched": "skip"}}'
    bad_rules = configured_client.post(
        "/api/try", files={"file": ("a.pdf", MINIMAL_PDF)}, data={"rules": orphan_mode}
    )
    assert bad_rules.status_code == 422


@pytest.mark.skipif(
    os.environ.get("RUN_STUDIO_TRYIT_E2E") != "1",
    reason="try-it e2e is opt-in: set RUN_STUDIO_TRYIT_E2E=1 (needs the OCR "
           "server, Bedrock, and this machine's real configuration)",
)
def test_full_try_run_end_to_end():
    from fastapi.testclient import TestClient

    from app.main import create_app

    # The machine's real configuration: ~/.ingestlib or INGESTLIB_CONFIG.
    # The context manager keeps the app's event loop alive between requests,
    # which the background pipeline task needs; a real server always does.
    with TestClient(create_app()) as client:
        started = client.post("/api/try", files={"file": ("tiny.pdf", MINIMAL_PDF)}).json()
        job_id = started["job_id"]

        deadline = time.monotonic() + 240
        body = started
        while body["status"] == "running" and time.monotonic() < deadline:
            time.sleep(2)
            body = client.get(f"/api/try/{job_id}").json()

        assert body["status"] == "done", body.get("error")
        assert body["result"]["page_count"] == 1
        image = client.get(f"/api/try/{job_id}/pages/1/image")
        assert image.status_code == 200 and image.headers["content-type"] == "image/png"
        assert client.delete(f"/api/try/{job_id}").json() == {"deleted": True}
