"""Tests for the setup endpoints: status, policy rendering, local checks,
and completion. Nothing here reaches the cloud."""
import json
import os
import stat

from app import bootstrap
from app.setup.policy import build_iam_policy


def test_status_unconfigured(client):
    body = client.get("/api/setup/status").json()
    assert body == {"configured": False, "config_path": None, "source": None, "checks": {}}


def test_aws_profiles_shape(client):
    body = client.get("/api/setup/aws-profiles").json()
    assert isinstance(body["profiles"], list)


def test_iam_policy_base(client):
    policy = client.get(
        "/api/setup/iam-policy",
        params={"account_id": "123456789012", "bucket": "my-bucket", "reranker": "jina"},
    ).json()
    sids = [s["Sid"] for s in policy["Statement"]]
    assert sids == ["IngestlibBedrock", "IngestlibBucket", "IngestlibObjects"]
    dumped = json.dumps(policy)
    assert "123456789012" in dumped and "arn:aws:s3:::my-bucket" in dumped
    assert "inference-profile/us.amazon.nova-2-lite-v1:0" in dumped
    assert "foundation-model/amazon.nova-2-lite-v1:0" in dumped  # us. prefix stripped
    assert "s3:DeleteObject" in dumped  # required by the studio's delete feature


def test_iam_policy_appends_rerank_for_aws():
    policy = build_iam_policy("123456789012", "b", reranker="aws")
    sids = [s["Sid"] for s in policy["Statement"]]
    assert sids[-2:] == ["IngestlibRerank", "IngestlibRerankModel"]
    rerank = policy["Statement"][-2]
    assert rerank["Resource"] == "*"  # bedrock:Rerank has no resource-level scoping


def test_iam_policy_rejects_unknown_reranker(client):
    response = client.get(
        "/api/setup/iam-policy",
        params={"account_id": "1", "bucket": "b", "reranker": "cohere"},
    )
    assert response.status_code == 422


def test_check_libreoffice_shape(client):
    body = client.get("/api/setup/check/libreoffice").json()
    assert isinstance(body["ok"], bool) and body["detail"]


def test_check_ocr_dead_port_fails_honestly(client):
    body = client.post(
        "/api/setup/check/ocr", json={"server_url": "http://127.0.0.1:59999/"}
    ).json()
    assert body["ok"] is False
    assert "Try it and Ingest" in body["detail"]


def test_check_vectordb_sqlite_needs_nothing(client):
    body = client.post("/api/setup/check/vectordb", json={"store": "sqlite"}).json()
    assert body["ok"] is True


def test_check_reranker_none_is_ok(client):
    body = client.post("/api/setup/check/reranker", json={"reranker": "none"}).json()
    assert body["ok"] is True


_ANSWERS = {
    "aws": {"profile": "test-profile", "region": "us-east-1", "account_id": "123456789012"},
    "bucket": "ingestlib-123456789012",  # equals the default, so it must not be written
    "vector_store": "sqlite",
    "reranker": "jina",
    "secrets": {"JINA_API_KEY": "jina-key"},
}


def test_complete_writes_answers_only_and_activates(client):
    body = client.post("/api/setup/complete", json=_ANSWERS).json()
    assert body["configured"] is True and body["source"] == "wizard"

    yaml_text = bootstrap.config_path().read_text()
    assert "profile: test-profile" in yaml_text
    assert "vector_store: sqlite" in yaml_text and "reranker: jina" in yaml_text
    assert "bucket" not in yaml_text, "default bucket must not be pinned"
    assert "bedrock" not in yaml_text and "paddle_vl" not in yaml_text, (
        "defaults stay in the library"
    )

    env_file = bootstrap.env_path()
    assert env_file.read_text().strip().endswith("JINA_API_KEY=jina-key")
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o600
    assert os.environ[bootstrap.CONFIG_ENV_VAR] == str(bootstrap.config_path())


def test_complete_writes_nondefault_bucket_and_paddle(client):
    answers = {
        **_ANSWERS,
        "bucket": "my-own-bucket",
        "paddle_vl": {"backend": "vllm-server", "server_url": "http://gpu-box:8111/"},
    }
    client.post("/api/setup/complete", json=answers)
    yaml_text = bootstrap.config_path().read_text()
    assert "bucket: my-own-bucket" in yaml_text
    assert "backend: vllm-server" in yaml_text and "server_url: http://gpu-box:8111/" in yaml_text


def test_complete_rejects_unknown_secret_keys(client):
    answers = {**_ANSWERS, "secrets": {"EVIL_KEY": "x"}}
    assert client.post("/api/setup/complete", json=answers).status_code == 422


def test_complete_clears_force_unconfigured_flag(client, monkeypatch):
    monkeypatch.setenv(bootstrap.FORCE_UNCONFIGURED_VAR, "1")
    assert client.get("/api/setup/status").json()["configured"] is False
    body = client.post("/api/setup/complete", json=_ANSWERS).json()
    assert body["configured"] is True, "finishing the wizard must end the simulation"


def test_status_after_complete_reports_local_checks(client):
    client.post("/api/setup/complete", json=_ANSWERS)
    checks = client.get("/api/setup/status").json()["checks"]
    assert set(checks) == {"libreoffice", "ocr"}
