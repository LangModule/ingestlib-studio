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


def test_iam_policy_appends_opensearch_deploy_statements():
    built = build_iam_policy("123456789012", "b", reranker="jina", vector_store="opensearch")
    sids = [s["Sid"] for s in built["Statement"]]
    assert sids[-3:] == [
        "IngestlibOpensearchStack",
        "IngestlibOpensearchTemplateOps",
        "IngestlibOpensearchDomain",
    ]
    dumped = json.dumps(built)
    assert "stack/ingestlib-opensearch" in dumped and "domain/ingestlib*" in dumped


def test_opensearch_template_prefills_the_master_user(client):
    response = client.get(
        "/api/setup/opensearch-template",
        params={"master_user_arn": "arn:aws:iam::123456789012:user/me"},
    )
    assert response.status_code == 200
    assert "AWS::OpenSearchService::Domain" in response.text
    assert "arn:aws:iam::123456789012:user/me" in response.text
    assert "REPLACE_WITH_YOUR_IAM_ARN" not in response.text


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


def test_check_vectordb_opensearch_requires_url(client):
    body = client.post("/api/setup/check/vectordb", json={"store": "opensearch"}).json()
    assert body["ok"] is False and "OPENSEARCH_URL" in body["detail"]


def test_check_vectordb_weaviate_dead_port_fails_honestly(client):
    body = client.post("/api/setup/check/vectordb", json={
        "store": "weaviate", "secrets": {"WEAVIATE_URL": "http://127.0.0.1:59998"},
    }).json()
    assert body["ok"] is False


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


def test_complete_writes_local_artifact_store_and_defaults_stay_unwritten(client):
    client.post("/api/setup/complete", json={**_ANSWERS, "artifact_store": "local"})
    yaml_text = bootstrap.config_path().read_text()
    assert "artifact_store: local" in yaml_text

    client.post("/api/setup/complete", json=_ANSWERS)  # s3 is the default
    assert "artifact_store" not in bootstrap.config_path().read_text()


def test_iam_policy_omits_s3_statements_for_local_artifacts(client):
    from app.setup.policy import build_iam_policy

    policy = build_iam_policy("123456789012", "ingestlib", "jina", artifact_store="local")
    sids = [s["Sid"] for s in policy["Statement"]]
    assert "IngestlibBucket" not in sids and "IngestlibObjects" not in sids
    assert "IngestlibBedrock" in sids


def test_iam_policy_omits_bedrock_statement_for_openai(client):
    policy = build_iam_policy("123456789012", "ingestlib", "jina", ai_provider="openai")
    sids = [s["Sid"] for s in policy["Statement"]]
    assert "IngestlibBedrock" not in sids
    assert "IngestlibBucket" in sids, "S3 artifacts still need their statements"


def test_iam_policy_can_be_empty_for_a_zero_aws_choice_set(client):
    policy = build_iam_policy(
        "123456789012", "ingestlib", "none", artifact_store="local", ai_provider="openai"
    )
    assert policy["Statement"] == []


def test_check_openai_without_a_key_fails_before_the_network(client):
    body = client.post("/api/setup/check/openai", json={"api_key": ""}).json()
    assert body["ok"] is False and body["kind"] == "credentials"


def test_complete_writes_openai_providers_and_defaults_stay_unwritten(client):
    answers = {**_ANSWERS, "ai_provider": "openai",
               "secrets": {"JINA_API_KEY": "j", "OPENAI_API_KEY": "sk-test"}}
    client.post("/api/setup/complete", json=answers)
    yaml_text = bootstrap.config_path().read_text()
    assert "llm_provider: openai" in yaml_text
    assert "embedding_provider: openai" in yaml_text
    assert bootstrap.env_path().read_text().count("OPENAI_API_KEY=sk-test") == 1

    client.post("/api/setup/complete", json=_ANSWERS)  # bedrock is the default
    assert "provider" not in bootstrap.config_path().read_text()


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
