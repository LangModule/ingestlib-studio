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
