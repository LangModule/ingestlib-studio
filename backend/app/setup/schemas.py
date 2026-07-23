"""Request and response models for the setup API."""
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

VectorStore = Literal[
    "sqlite", "pinecone", "qdrant", "pgvector", "mongodb", "milvus",
    "opensearch", "weaviate",
]
Reranker = Literal["jina", "aws", "none"]
ArtifactStore = Literal["s3", "local"]
AiProvider = Literal["bedrock", "openai"]

# The only keys the wizard may write to .env. Anything else is rejected.
ALLOWED_SECRET_KEYS = (
    "JINA_API_KEY",
    "OPENAI_API_KEY",
    "PINECONE_API_KEY",
    "QDRANT_URL",
    "QDRANT_API_KEY",
    "PGVECTOR_URL",
    "MONGODB_URL",
    "MILVUS_URL",
    "MILVUS_TOKEN",
    "OPENSEARCH_URL",
    "WEAVIATE_URL",
    "WEAVIATE_API_KEY",
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
    profile: str = ""           # used when the store is an Amazon OpenSearch domain
    region: str = "us-east-1"


class RerankerCheckRequest(BaseModel):
    reranker: Reranker
    api_key: str = ""           # used when reranker is "jina"
    profile: str = ""           # used when reranker is "aws"
    region: str = "us-east-1"   # session region; the rerank call itself uses us-west-2


class OcrCheckRequest(BaseModel):
    server_url: str = "http://localhost:8111/"


class OpenAiCheckRequest(BaseModel):
    api_key: str = ""


# --- content rules (rules.yaml) — caps and grammar mirror the library's ---

UnmatchedMode = Literal["require", "other", "skip"]

MAX_CLASSIFY_RULES = 20
MAX_SPLIT_CATEGORIES = 50


def _check_page_spec(spec: str) -> None:
    """Reject what the library's parse_page_spec would reject: non-numeric
    tokens, pages below 1, and reversed ranges — a saved preset must never
    be one the pipeline chokes on."""
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        low_text, dash, high_text = token.partition("-")
        try:
            low = int(low_text)
            high = int(high_text) if dash else low
        except ValueError:
            raise ValueError(
                f"bad target_pages token {token!r} — expected a 1-based page "
                f"number or range like '1,3,5-7'"
            ) from None
        if low < 1 or high < low:
            raise ValueError(
                f"bad target_pages token {token!r} — pages are 1-based and "
                f"ranges must ascend"
            )


class ClassifyRules(BaseModel):
    """The classify preset: closed-set rules plus page settings."""

    rules: dict[str, str] = Field(default_factory=dict)
    target_pages: str = ""
    max_pages: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _valid(self) -> "ClassifyRules":
        if len(self.rules) > MAX_CLASSIFY_RULES:
            raise ValueError(
                f"{len(self.rules)} classification rules — the limit is {MAX_CLASSIFY_RULES}"
            )
        if self.target_pages:
            _check_page_spec(self.target_pages)
        return self


class SplitRules(BaseModel):
    """The split preset: user section vocabulary plus the unmatched policy."""

    categories: dict[str, str] = Field(default_factory=dict)
    unmatched: UnmatchedMode = "other"

    @model_validator(mode="after")
    def _valid(self) -> "SplitRules":
        if len(self.categories) > MAX_SPLIT_CATEGORIES:
            raise ValueError(
                f"{len(self.categories)} split categories — the limit is "
                f"{MAX_SPLIT_CATEGORIES}"
            )
        if not self.categories and self.unmatched != "other":
            raise ValueError(
                "unmatched applies only with split categories — add categories "
                "or leave the default 'other'"
            )
        return self


class RulesConfig(BaseModel):
    """Both presets together — the shape rules.yaml holds, the Settings
    editor edits, and Try-it accepts as a per-run override."""

    classify: ClassifyRules = Field(default_factory=ClassifyRules)
    split: SplitRules = Field(default_factory=SplitRules)

    def is_empty(self) -> bool:
        return (
            not self.classify.rules
            and not self.classify.target_pages
            and not self.classify.max_pages
            and not self.split.categories
        )


class RulesView(BaseModel):
    editable: bool
    rules: RulesConfig


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
    artifact_store: ArtifactStore = "s3"
    ai_provider: AiProvider = "bedrock"
    secrets: dict[str, str] = Field(default_factory=dict)
    paddle_vl: PaddleAnswers | None = None
