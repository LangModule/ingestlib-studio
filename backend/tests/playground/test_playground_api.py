"""Tests for the retrieve endpoint: the gate, validation, and hit shaping.

The library call and the filename lookup are stubbed, so nothing here
reaches Bedrock, the vector store, or S3."""
from types import SimpleNamespace

import pytest

from app.documents import registry
from app.routes import playground

CHUNK = SimpleNamespace(
    document_id="abc123",
    chunk_id=4,
    category="research_paper",
    section="methods",
    heading="Sampling",
    kind="figure",
    pages=[3],
    region_ids={3: [5, 6]},
    markdown="See ![Sampling](page3_region5_chart.png)",
)


@pytest.fixture()
def stub_retrieval(monkeypatch):
    async def fake_aretrieve(question, top_k):
        hit = SimpleNamespace(chunk=CHUNK, vector_score=0.71, rerank_score=0.93)
        return SimpleNamespace(question=question, hits=[hit] * min(top_k, 1))

    monkeypatch.setattr(playground, "_aretrieve", fake_aretrieve)
    monkeypatch.setattr(registry, "document_filename", lambda doc_id: "survey.pdf")


def test_retrieve_is_gated_while_unconfigured(client):
    assert client.post("/api/retrieve", json={"question": "q"}).status_code == 409


def test_blank_question_is_rejected(configured_client, stub_retrieval):
    response = configured_client.post("/api/retrieve", json={"question": "   "})
    assert response.status_code == 422


def test_top_k_bounds_are_enforced(configured_client, stub_retrieval):
    response = configured_client.post("/api/retrieve", json={"question": "q", "top_k": 50})
    assert response.status_code == 422


def test_hits_are_shaped_with_filename_and_rewritten_figures(configured_client, stub_retrieval):
    response = configured_client.post("/api/retrieve", json={"question": "how was sampling done"})
    body = response.json()
    assert body["question"] == "how was sampling done"
    hit = body["hits"][0]
    assert hit["filename"] == "survey.pdf"
    assert hit["doc_id"] == "abc123" and hit["region_ids"] == {"3": [5, 6]}
    assert hit["rerank_score"] == 0.93
    assert "](/api/documents/abc123/pages/3/figures/5/image)" in hit["markdown"]
    assert "page3_region5_chart.png" not in hit["markdown"]
