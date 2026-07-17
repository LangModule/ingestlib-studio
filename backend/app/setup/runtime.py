"""Reads the active configuration the same way the library would, without
importing it.

The status endpoints probe the exact targets the pipeline will use, so they
need the configured values: the OCR server URL, the store choice, the bucket,
and the secrets. Parsing the files directly keeps this package free of
ingestlib imports.
"""
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from dotenv import dotenv_values

from app import bootstrap
from app.setup.defaults import OCR_DEFAULT_URL


@dataclass(frozen=True)
class RuntimeConfig:
    profile: str
    region: str
    bucket: str
    vector_store: str
    reranker: str
    ocr_url: str
    secrets: dict[str, str] = field(default_factory=dict)


def read_runtime_config() -> RuntimeConfig | None:
    """Return the effective configuration, or None while unconfigured.

    Defaults mirror the library's: an omitted key resolves to the same value
    the pipeline will use."""
    configured, path, _ = bootstrap.resolve()
    if not configured or path is None:
        return None
    config_path = Path(path)
    try:
        data = yaml.safe_load(config_path.read_text()) or {}
    except OSError:
        return None

    aws = data.get("aws") or {}
    s3 = data.get("s3") or {}
    paddle = data.get("paddle_vl") or {}
    account_id = str(aws.get("account_id", ""))
    secrets = {
        key: value
        for key, value in dotenv_values(config_path.parent / ".env").items()
        if value
    }
    return RuntimeConfig(
        profile=str(aws.get("profile", "")),
        region=str(aws.get("region", "us-east-1")),
        bucket=str(s3.get("bucket", f"ingestlib-{account_id}")),
        vector_store=str(data.get("vector_store", "pinecone")),
        reranker=str(data.get("reranker", "jina")),
        ocr_url=str(paddle.get("server_url", OCR_DEFAULT_URL)),
        secrets=secrets,
    )
