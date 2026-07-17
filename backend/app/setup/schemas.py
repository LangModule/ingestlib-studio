"""Request and response models for the setup API."""
from typing import Any, Literal

from pydantic import BaseModel, Field

VectorStore = Literal["sqlite", "pinecone", "qdrant", "pgvector", "mongodb", "milvus"]
Reranker = Literal["jina", "aws", "none"]

# The only keys the wizard may write to .env. Anything else is rejected.
ALLOWED_SECRET_KEYS = (
    "JINA_API_KEY",
    "PINECONE_API_KEY",
    "QDRANT_URL",
    "QDRANT_API_KEY",
    "PGVECTOR_URL",
    "MONGODB_URL",
    "MILVUS_URL",
    "MILVUS_TOKEN",
)


class CheckResult(BaseModel):
    """Result of one verification check.

    The kind field tells the UI which guidance card to show:
        credentials    the profile is missing or the session expired;
                       return to the Connect AWS step
        access-denied  the IAM policy has not been applied yet;
                       show the policy card
        model-access   Bedrock model access is not enabled; it is granted in
                       the Bedrock console, not through IAM
        error          anything else; the detail is shown as-is
    """

    ok: bool
    detail: str = ""
    kind: Literal["ok", "credentials", "access-denied", "model-access", "error"] = "ok"
    data: dict[str, Any] = Field(default_factory=dict)


class SetupStatus(BaseModel):
    configured: bool
    config_path: str | None = None
    source: Literal["wizard", "env-var", "cwd"] | None = None
    checks: dict[str, str] = Field(default_factory=dict)


class AwsCheckRequest(BaseModel):
    profile: str
    region: str = "us-east-1"


class S3CheckRequest(BaseModel):
    profile: str
    region: str = "us-east-1"
    bucket: str


class VectorDbCheckRequest(BaseModel):
    store: VectorStore
    secrets: dict[str, str] = Field(default_factory=dict)


class RerankerCheckRequest(BaseModel):
    reranker: Reranker
    api_key: str = ""           # used when reranker is "jina"
    profile: str = ""           # used when reranker is "aws"
    region: str = "us-east-1"   # session region; the rerank call itself uses us-west-2


class OcrCheckRequest(BaseModel):
    server_url: str = "http://localhost:8111/"


class AwsAnswers(BaseModel):
    profile: str
    region: str
    account_id: str


class PaddleAnswers(BaseModel):
    backend: Literal["mlx-vlm-server", "vllm-server"] = "mlx-vlm-server"
    server_url: str = "http://localhost:8111/"


class CompleteRequest(BaseModel):
    """The wizard's collected answers.

    Only these values are written to config.yaml; every omitted key falls
    back to the library's defaults."""

    aws: AwsAnswers
    bucket: str
    vector_store: VectorStore
    reranker: Reranker
    secrets: dict[str, str] = Field(default_factory=dict)
    paddle_vl: PaddleAnswers | None = None
