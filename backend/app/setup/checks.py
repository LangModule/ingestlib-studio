"""Verification checks for the setup wizard.

Each check talks to AWS, a vector database, or an HTTP service directly, and
uses the same model identifiers and endpoints as the library, so a passing
check means the pipeline itself will work. Checks return a CheckResult
instead of raising; every failure becomes a guidance card in the UI rather
than an HTTP 500.
"""
import configparser
import shutil
from pathlib import Path
from typing import Any

import boto3
import httpx
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError, ProfileNotFound

from app.setup.defaults import (
    AWS_RERANK_MODEL_ID,
    AWS_RERANK_REGION,
    EMBEDDING_MODEL_ID,
    JINA_BASE_URL,
    JINA_RERANK_MODEL_ID,
    LLM_MODEL_ID,
)
from app.setup.schemas import CheckResult

_BOTO_CFG = BotoConfig(retries={"total_max_attempts": 2}, connect_timeout=5, read_timeout=30)


def list_aws_profiles() -> list[str]:
    """Return profile names from ~/.aws/credentials and ~/.aws/config."""
    profiles: list[str] = []
    creds = Path.home() / ".aws" / "credentials"
    if creds.is_file():
        parser = configparser.ConfigParser()
        parser.read(creds)
        profiles.extend(parser.sections())
    cfg = Path.home() / ".aws" / "config"
    if cfg.is_file():
        parser = configparser.ConfigParser()
        parser.read(cfg)
        for section in parser.sections():
            name = section.removeprefix("profile ").strip()
            if name and name not in profiles:
                profiles.append(name)
    return profiles


def _session(profile: str, region: str) -> boto3.Session:
    return boto3.Session(profile_name=profile or None, region_name=region)


def _classify_aws_error(exc: Exception) -> CheckResult:
    """Convert an AWS exception into a CheckResult with a failure kind.

    Bedrock also raises AccessDeniedException when model access has not been
    enabled, but in that case the message names the model. Model access is
    granted in the Bedrock console rather than through IAM, so it is
    reported as its own kind."""
    if isinstance(exc, (ProfileNotFound, NoCredentialsError)):
        return CheckResult(ok=False, kind="credentials", detail=str(exc))
    if isinstance(exc, ClientError):
        code = exc.response.get("Error", {}).get("Code", "")
        message = exc.response.get("Error", {}).get("Message", str(exc))
        if code in ("ExpiredToken", "ExpiredTokenException", "InvalidClientTokenId",
                    "UnrecognizedClientException"):
            return CheckResult(ok=False, kind="credentials", detail=f"{code}: {message}")
        if code == "AccessDeniedException":
            if "model" in message.lower():
                return CheckResult(ok=False, kind="model-access", detail=message)
            return CheckResult(ok=False, kind="access-denied", detail=message)
        if code in ("ResourceNotFoundException", "ValidationException"):
            return CheckResult(ok=False, kind="model-access", detail=f"{code}: {message}")
        return CheckResult(ok=False, kind="error", detail=f"{code}: {message}")
    if isinstance(exc, BotoCoreError):
        return CheckResult(ok=False, kind="error", detail=str(exc))
    return CheckResult(ok=False, kind="error", detail=f"{type(exc).__name__}: {exc}")


def check_aws(profile: str, region: str) -> CheckResult:
    """Verify the profile with STS and return the account id and ARN.

    Bedrock is checked separately, after the user has applied the IAM
    policy."""
    try:
        sts = _session(profile, region).client("sts", config=_BOTO_CFG)
        identity = sts.get_caller_identity()
        return CheckResult(
            ok=True,
            detail=f"authenticated as {identity['Arn']}",
            data={"account_id": identity["Account"], "arn": identity["Arn"]},
        )
    except Exception as exc:  # noqa: BLE001
        return _classify_aws_error(exc)


def check_bedrock(profile: str, region: str) -> CheckResult:
    """Send a one-token chat and a single embedding request to Bedrock.

    A passing check proves the two invoke permissions the pipeline needs.
    Listing foundation models would prove less and would require an extra
    IAM action just for the check."""
    try:
        session = _session(profile, region)
        runtime = session.client("bedrock-runtime", config=_BOTO_CFG)
        runtime.converse(
            modelId=LLM_MODEL_ID,
            messages=[{"role": "user", "content": [{"text": "hi"}]}],
            inferenceConfig={"maxTokens": 16},
        )
        runtime.invoke_model(
            modelId=EMBEDDING_MODEL_ID,
            body=(
                '{"taskType": "SINGLE_EMBEDDING", "singleEmbeddingParams": '
                '{"embeddingPurpose": "GENERIC_INDEX", "embeddingDimension": 256, '
                '"text": {"truncationMode": "END", "value": "hello"}}}'
            ),
            contentType="application/json",
            accept="application/json",
        )
        return CheckResult(ok=True, detail=f"Nova LLM + embeddings reachable in {region}")
    except Exception as exc:  # noqa: BLE001
        return _classify_aws_error(exc)


def check_s3(profile: str, region: str, bucket: str) -> CheckResult:
    """Check bucket ownership with HeadBucket.

    Three outcomes: the bucket exists and belongs to this account; it does
    not exist yet and will be created on first use; or another account owns
    the name, since bucket names are global across AWS."""
    try:
        s3 = _session(profile, region).client("s3", config=_BOTO_CFG)
        s3.head_bucket(Bucket=bucket)
        return CheckResult(ok=True, detail=f"bucket {bucket!r} exists and is yours")
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchBucket"):
            return CheckResult(ok=True, detail=f"bucket {bucket!r} will be created on first use")
        if code == "403":
            return CheckResult(
                ok=False, kind="error",
                detail=f"bucket {bucket!r} belongs to another AWS account "
                       f"(names are global); pick a different name",
            )
        return _classify_aws_error(exc)
    except Exception as exc:  # noqa: BLE001
        return _classify_aws_error(exc)


def check_vectordb(store: str, secrets: dict[str, str]) -> CheckResult:
    """Check that the selected vector store is reachable.

    Client libraries are imported inside each branch so that only the
    selected backend is ever loaded."""
    try:
        if store == "sqlite":
            return CheckResult(ok=True, detail="local file; nothing to reach, no keys")

        if store == "pinecone":
            from pinecone import Pinecone

            key = secrets.get("PINECONE_API_KEY", "")
            if not key:
                return CheckResult(ok=False, kind="error", detail="PINECONE_API_KEY is required")
            indexes = [i["name"] for i in Pinecone(api_key=key).list_indexes()]
            found = (
                f"{len(indexes)} index(es)" if indexes
                else "no indexes yet (created on first ingest)"
            )
            return CheckResult(ok=True, detail=f"reachable · {found}", data={"indexes": indexes})

        if store == "qdrant":
            url = secrets.get("QDRANT_URL", "http://localhost:6333").rstrip("/")
            headers = {}
            if secrets.get("QDRANT_API_KEY"):
                headers["api-key"] = secrets["QDRANT_API_KEY"]
            response = httpx.get(f"{url}/collections", headers=headers, timeout=5.0)
            response.raise_for_status()
            collections = response.json().get("result", {}).get("collections", [])
            names = [c["name"] for c in collections]
            found = (
                f"{len(names)} collection(s)" if names
                else "collection created on first ingest"
            )
            return CheckResult(ok=True, detail=f"reachable · {found}")

        if store == "pgvector":
            import psycopg

            url = secrets.get("PGVECTOR_URL", "")
            if not url:
                return CheckResult(ok=False, kind="error", detail="PGVECTOR_URL is required")
            with psycopg.connect(url, connect_timeout=5) as conn:
                available = conn.execute(
                    "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'"
                ).fetchone()
            if available is None:
                return CheckResult(
                    ok=False, kind="error",
                    detail="reachable, but this Postgres does not ship the pgvector "
                           "extension; use RDS, Supabase, Neon, or the pgvector docker image",
                )
            return CheckResult(ok=True, detail="reachable · pgvector extension available")

        if store == "mongodb":
            from pymongo import MongoClient

            url = secrets.get("MONGODB_URL", "")
            if not url:
                return CheckResult(ok=False, kind="error", detail="MONGODB_URL is required")
            client: Any = MongoClient(url, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            return CheckResult(ok=True, detail="reachable · indexes created on first ingest")

        if store == "milvus":
            from pymilvus import MilvusClient

            url = secrets.get("MILVUS_URL", "http://localhost:19530")
            client = MilvusClient(uri=url, token=secrets.get("MILVUS_TOKEN", ""))
            names = client.list_collections()
            found = (
                f"{len(names)} collection(s)" if names
                else "collection created on first ingest"
            )
            return CheckResult(ok=True, detail=f"reachable · {found}")

        return CheckResult(ok=False, kind="error", detail=f"unknown store {store!r}")
    except Exception as exc:  # noqa: BLE001
        return CheckResult(ok=False, kind="error", detail=f"{type(exc).__name__}: {exc}")


def check_reranker(reranker: str, api_key: str, profile: str, region: str) -> CheckResult:
    """Send one single-document rerank request to the chosen provider.

    The "none" choice always passes; it means retrieval keeps vector
    order."""
    if reranker == "none":
        return CheckResult(ok=True, detail="reranking disabled; retrieval uses vector order")

    if reranker == "jina":
        if not api_key:
            return CheckResult(ok=False, kind="error", detail="JINA_API_KEY is required")
        try:
            response = httpx.post(
                f"{JINA_BASE_URL}/rerank",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": JINA_RERANK_MODEL_ID, "query": "q",
                      "documents": ["d"], "return_documents": False},
                timeout=15.0,
            )
            response.raise_for_status()
            return CheckResult(ok=True, detail=f"{JINA_RERANK_MODEL_ID} responded")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                return CheckResult(ok=False, kind="credentials", detail="Jina rejected the key")
            return CheckResult(ok=False, kind="error", detail=str(exc))
        except Exception as exc:  # noqa: BLE001
            return CheckResult(ok=False, kind="error", detail=f"{type(exc).__name__}: {exc}")

    # Amazon Rerank is served by bedrock-agent-runtime, in us-west-2 only.
    try:
        client = _session(profile, region).client(
            "bedrock-agent-runtime", region_name=AWS_RERANK_REGION, config=_BOTO_CFG
        )
        model_arn = f"arn:aws:bedrock:{AWS_RERANK_REGION}::foundation-model/{AWS_RERANK_MODEL_ID}"
        client.rerank(
            queries=[{"type": "TEXT", "textQuery": {"text": "q"}}],
            sources=[{"type": "INLINE", "inlineDocumentSource": {
                "type": "TEXT", "textDocument": {"text": "d"}}}],
            rerankingConfiguration={
                "type": "BEDROCK_RERANKING_MODEL",
                "bedrockRerankingConfiguration": {"modelConfiguration": {"modelArn": model_arn}},
            },
        )
        return CheckResult(
            ok=True, detail=f"{AWS_RERANK_MODEL_ID} responded in {AWS_RERANK_REGION}"
        )
    except Exception as exc:  # noqa: BLE001
        return _classify_aws_error(exc)


def check_ocr(server_url: str) -> CheckResult:
    """Request the model list from the OCR inference server.

    This is the same request the library makes before building its
    pipeline."""
    try:
        response = httpx.get(f"{server_url.rstrip('/')}/v1/models", timeout=3.0)
        response.raise_for_status()
        models = [m.get("id", "?") for m in response.json().get("data", [])]
        return CheckResult(ok=True, detail=f"serving {', '.join(models) or 'models'}")
    except Exception as exc:  # noqa: BLE001
        return CheckResult(
            ok=False, kind="error",
            detail=f"not reachable at {server_url} ({type(exc).__name__}); browsing and "
                   f"retrieval still work, but Try it and Ingest need it",
        )


def check_libreoffice() -> CheckResult:
    """Check that the soffice binary is on PATH.

    LibreOffice is needed only to convert DOCX and PPTX files to PDF."""
    path = shutil.which("soffice")
    if path:
        return CheckResult(ok=True, detail=f"soffice found at {path}")
    return CheckResult(
        ok=False, kind="error",
        detail="soffice not on PATH; PDFs work without it, but DOCX and PPTX need it "
               "(brew install --cask libreoffice)",
    )
