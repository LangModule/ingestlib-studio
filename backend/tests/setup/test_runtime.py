"""Tests for the runtime configuration reader. No network, no ingestlib."""
from app import bootstrap
from app.setup import runtime

_MINIMAL = """\
aws:
  profile: p
  region: us-east-1
  account_id: "123456789012"
"""


def _write(scratch, yaml_text: str, env_text: str = "") -> None:
    directory = bootstrap.config_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "config.yaml").write_text(yaml_text)
    if env_text:
        (directory / ".env").write_text(env_text)


def test_unconfigured_returns_none(scratch):
    assert runtime.read_runtime_config() is None


def test_minimal_config_resolves_library_defaults(scratch):
    _write(scratch, _MINIMAL)
    config = runtime.read_runtime_config()
    assert config is not None
    assert config.profile == "p"
    assert config.bucket == "ingestlib-123456789012"
    assert config.vector_store == "pinecone"
    assert config.reranker == "jina"
    assert config.ocr_url == "http://localhost:8111/"
    assert config.secrets == {}


def test_overrides_and_secrets_are_read(scratch):
    _write(
        scratch,
        _MINIMAL
        + "vector_store: sqlite\nreranker: none\n"
        + "s3:\n  bucket: my-bucket\n"
        + "paddle_vl:\n  server_url: http://gpu-box:8111/\n",
        env_text="JINA_API_KEY=abc\nEMPTY_KEY=\n",
    )
    config = runtime.read_runtime_config()
    assert config is not None
    assert config.vector_store == "sqlite"
    assert config.reranker == "none"
    assert config.bucket == "my-bucket"
    assert config.ocr_url == "http://gpu-box:8111/"
    assert config.secrets == {"JINA_API_KEY": "abc"}, "blank values are dropped"


def test_health_endpoint_is_gated_while_unconfigured(client):
    assert client.get("/api/setup/health").status_code == 409
