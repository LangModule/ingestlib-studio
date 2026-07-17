"""Tests for the settings endpoints: view, edit rules, secret merging, and
backfill. The backfill scan and runner are stubbed; nothing here reaches
AWS or a vector store."""
import pytest

from app import bootstrap
from app.pipeline import backfill
from app.pipeline.jobs import BACKFILL_JOBS

_ANSWERS = {
    "aws": {"profile": "p2", "region": "us-east-2", "account_id": "1"},
    "bucket": "my-bucket",
    "vector_store": "sqlite",
    "reranker": "jina",
    "secrets": {"JINA_API_KEY": "jina-key"},
}


@pytest.fixture(autouse=True)
def clean_backfill_jobs():
    yield
    for job_id in list(BACKFILL_JOBS._jobs):
        BACKFILL_JOBS.delete(job_id)


def test_settings_are_gated_while_unconfigured(client):
    assert client.get("/api/settings").status_code == 409


def test_view_resolves_defaults_for_the_minimal_config(configured_client):
    body = configured_client.get("/api/settings").json()
    assert body["source"] == "wizard" and body["editable"] is True
    assert body["profile"] == "p" and body["account_id"] == "1"
    assert body["bucket"] == "ingestlib-1"
    assert body["vector_store"] == "pinecone" and body["reranker"] == "jina"
    assert body["ocr_backend"] == "mlx-vlm-server"
    assert body["secrets_set"] == []


def test_update_rewrites_the_files_and_reports_the_new_state(configured_client):
    body = configured_client.put("/api/settings", json=_ANSWERS).json()
    assert body["bucket"] == "my-bucket" and body["vector_store"] == "sqlite"
    assert body["secrets_set"] == ["JINA_API_KEY"]
    yaml_text = bootstrap.config_path().read_text()
    assert "bucket: my-bucket" in yaml_text and "vector_store: sqlite" in yaml_text


def test_update_keeps_secrets_the_body_omits(configured_client):
    configured_client.put("/api/settings", json=_ANSWERS)
    again = {**_ANSWERS, "vector_store": "pinecone",
             "secrets": {"PINECONE_API_KEY": "pc-key"}}
    body = configured_client.put("/api/settings", json=again).json()
    assert body["secrets_set"] == ["JINA_API_KEY", "PINECONE_API_KEY"], (
        "a key typed earlier must survive a save that omits it"
    )


def test_update_refuses_externally_managed_config(scratch, monkeypatch):
    external = scratch / "external.yaml"
    external.write_text('aws:\n  profile: p\n  region: us-east-1\n  account_id: "1"\n')
    monkeypatch.setenv(bootstrap.CONFIG_ENV_VAR, str(external))
    from fastapi.testclient import TestClient

    from app.main import create_app

    client = TestClient(create_app())
    assert client.get("/api/settings").json()["editable"] is False
    response = client.put("/api/settings", json=_ANSWERS)
    assert response.status_code == 409
    assert "managed externally" in response.json()["detail"]


def test_backfill_status_shape(configured_client, monkeypatch):
    monkeypatch.setattr(backfill, "pending", lambda: (
        {"store": "SqliteStore", "documents": 3, "in_store": 1, "missing": 2}, [],
    ))
    body = configured_client.get("/api/settings/backfill").json()
    assert body == {"store": "SqliteStore", "documents": 3, "in_store": 1, "missing": 2}


def test_backfill_with_nothing_missing_is_409(configured_client, monkeypatch):
    monkeypatch.setattr(backfill, "pending", lambda: (
        {"store": "SqliteStore", "documents": 2, "in_store": 2, "missing": 0}, [],
    ))
    assert configured_client.post("/api/settings/backfill").status_code == 409


def test_backfill_runs_the_missing_documents(configured, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app

    missing = [("d1", "a.pdf"), ("d2", "b.pdf")]
    monkeypatch.setattr(backfill, "pending", lambda: (
        {"store": "SqliteStore", "documents": 2, "in_store": 0, "missing": 2}, missing,
    ))

    async def fake_run(job, documents):
        for _, filename in documents:
            job.emit(filename, "start")
            job.emit(filename, "done", seconds=0.1)
            job.durations[filename] = 0.1
        job.summary = {"documents": len(documents), "vectors": 5, "store": "SqliteStore"}
        job.finish("done")

    monkeypatch.setattr(backfill, "run", fake_run)

    with TestClient(create_app()) as client:
        started = client.post("/api/settings/backfill").json()
        assert started["pending"] == ["a.pdf", "b.pdf"]

        body = client.get(f"/api/settings/backfill/{started['job_id']}").json()
        assert body["status"] == "done"
        assert body["summary"] == {"documents": 2, "vectors": 5, "store": "SqliteStore"}

        events = client.get(f"/api/settings/backfill/{started['job_id']}/events").text
        assert '"stage": "a.pdf"' in events and '"stage": "job"' in events
