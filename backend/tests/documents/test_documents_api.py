"""Tests for the library endpoints: the gate, shapes, redirects, and delete.

The registry is stubbed out, so nothing here reaches S3 or the vector
store; the registry's real S3 behavior is exercised live through the app."""
import pytest

from app.documents import registry
from app.documents.schemas import (
    ClassifyView,
    DocumentSummary,
    DocumentView,
    PageView,
)
from app.pipeline.jobs import INGEST_JOBS

SUMMARY = DocumentSummary(
    doc_id="abc123", filename="report.pdf", page_count=3, category="earnings_report",
    sections=2, chunks=9, created_at="2026-07-16T12:00:00+00:00",
    thumbnail_url="/api/documents/abc123/pages/1/image",
)

VIEW = DocumentView(
    filename="report.pdf",
    page_count=1,
    pages=[PageView(
        page_num=1, width=1000, height=2000,
        image_url="/api/documents/abc123/pages/1/image", markdown="", text="",
    )],
    classify=ClassifyView(
        category="earnings_report", confidence=0.9, reasoning="numbers", pages_used=1,
    ),
    sections=[],
    chunks=[],
)


@pytest.fixture()
def stub_registry(monkeypatch):
    monkeypatch.setattr(registry, "list_summaries", lambda: [SUMMARY])
    monkeypatch.setattr(
        registry, "load_view", lambda doc_id: (VIEW, {(1, 5): "page1_region5_chart.png"})
    )
    monkeypatch.setattr(
        registry, "page_image",
        lambda doc_id, page_num: (f"https://s3.example/{doc_id}/p{page_num}", None),
    )


def test_document_routes_are_gated_while_unconfigured(client):
    assert client.get("/api/documents").status_code == 409


def test_list_returns_summaries(configured_client, stub_registry):
    body = configured_client.get("/api/documents").json()
    assert body == [SUMMARY.model_dump()]


def test_get_returns_the_shaped_view(configured_client, stub_registry):
    body = configured_client.get("/api/documents/abc123").json()
    assert body["filename"] == "report.pdf"
    assert body["pages"][0]["image_url"] == "/api/documents/abc123/pages/1/image"


def test_get_unknown_document_is_404(configured_client, monkeypatch):
    def missing(doc_id):
        raise LookupError(f"no document {doc_id} in the library")

    monkeypatch.setattr(registry, "load_view", missing)
    response = configured_client.get("/api/documents/nope")
    assert response.status_code == 404
    assert "no document" in response.json()["detail"]


def test_page_image_redirects_to_the_presigned_url(configured_client, stub_registry):
    response = configured_client.get(
        "/api/documents/abc123/pages/2/image", follow_redirects=False
    )
    assert response.status_code == 307
    assert response.headers["location"] == "https://s3.example/abc123/p2"


def test_figure_image_redirects_via_the_filename_map(configured_client, stub_registry, monkeypatch):
    monkeypatch.setattr(registry, "_image_payload", lambda key: (f"https://s3.example/{key}", None))
    response = configured_client.get(
        "/api/documents/abc123/pages/1/figures/5/image", follow_redirects=False
    )
    assert response.status_code == 307
    assert response.headers["location"].endswith(
        "documents/abc123/parse/figures/page1_region5_chart.png"
    )


def test_page_image_streams_bytes_on_a_local_artifact_store(configured_client, monkeypatch):
    monkeypatch.setattr(registry, "page_image", lambda doc_id, page_num: (None, b"\x89PNG-page"))
    response = configured_client.get("/api/documents/abc123/pages/2/image")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == b"\x89PNG-page"


def test_unknown_figure_is_404(configured_client, stub_registry):
    response = configured_client.get("/api/documents/abc123/pages/1/figures/99/image")
    assert response.status_code == 404


def test_delete_reports_counts_and_drops_the_ingest_record(configured_client, monkeypatch):
    monkeypatch.setattr(registry, "delete", lambda doc_id: {"vectors": 9, "objects": 14})
    INGEST_JOBS.create_or_get("abc123", "report.pdf")[0].finish("done")

    body = configured_client.delete("/api/documents/abc123").json()
    assert body == {"deleted": True, "vectors": 9, "objects": 14}
    assert INGEST_JOBS.get("abc123") is None, "re-ingesting must run fresh after delete"


def test_delete_unknown_document_is_404(configured_client, monkeypatch):
    monkeypatch.setattr(registry, "delete", lambda doc_id: {"vectors": 0, "objects": 0})
    assert configured_client.delete("/api/documents/nope").status_code == 404
