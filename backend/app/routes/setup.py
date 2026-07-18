"""Endpoints for the setup wizard.

These are the only routes available before the studio is configured. The
handlers delegate to the app.setup package, which talks to AWS and the other
services directly rather than through ingestlib.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app import bootstrap
from app.setup import checks, policy, runtime, writer
from app.setup.defaults import OCR_DEFAULT_URL
from app.setup.schemas import (
    AwsCheckRequest,
    CheckResult,
    CompleteRequest,
    OcrCheckRequest,
    RerankerCheckRequest,
    S3CheckRequest,
    SetupStatus,
    VectorDbCheckRequest,
)

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status", response_model=SetupStatus)
def status() -> SetupStatus:
    configured, path, source = bootstrap.resolve()
    probes: dict[str, str] = {}
    if configured:
        # Only fast local probes run here; the header status dot and the page
        # banners poll them. Cloud services are checked on demand through
        # /health, never on a timer.
        config = runtime.read_runtime_config()
        ocr_url = config.ocr_url if config else OCR_DEFAULT_URL
        probes["libreoffice"] = "ok" if checks.check_libreoffice().ok else "missing"
        probes["ocr"] = "ok" if checks.check_ocr(ocr_url).ok else "offline"
    return SetupStatus(configured=configured, config_path=path, source=source, checks=probes)


@router.get("/health", dependencies=[Depends(bootstrap.require_configured)])
def health() -> dict[str, CheckResult]:
    """Run every check the pipeline depends on, using the active configuration.

    The Bedrock and reranker probes each make one real, tiny call, so this
    endpoint backs an explicit refresh in the UI rather than a poll."""
    config = runtime.read_runtime_config()
    if config is None:
        raise HTTPException(status_code=500, detail="the configuration file is unreadable")
    return {
        "bedrock": checks.check_bedrock(config.profile, config.region),
        "s3": checks.check_s3(config.profile, config.region, config.bucket),
        "vectordb": checks.check_vectordb(
            config.vector_store, config.secrets, config.profile, config.region,
        ),
        "reranker": checks.check_reranker(
            config.reranker, config.secrets.get("JINA_API_KEY", ""),
            config.profile, config.region,
        ),
        "ocr": checks.check_ocr(config.ocr_url),
        "libreoffice": checks.check_libreoffice(),
    }


@router.get("/aws-profiles")
def aws_profiles() -> dict[str, list[str]]:
    return {"profiles": checks.list_aws_profiles()}


@router.post("/check/aws", response_model=CheckResult)
def check_aws(body: AwsCheckRequest) -> CheckResult:
    return checks.check_aws(body.profile, body.region)


@router.get("/iam-policy")
def iam_policy(
    account_id: str, bucket: str, reranker: str = "jina", vector_store: str = ""
) -> dict:
    if reranker not in ("jina", "aws", "none"):
        raise HTTPException(status_code=422, detail=f"unknown reranker {reranker!r}")
    return policy.build_iam_policy(account_id, bucket, reranker, vector_store)


_OPENSEARCH_TEMPLATE = Path(__file__).parent.parent / "setup" / "opensearch-domain.yaml"


@router.get("/opensearch-template")
def opensearch_template(master_user_arn: str = "") -> Response:
    """The CloudFormation template for the cheapest k-NN-capable domain,
    with the caller's identity pre-filled as the domain's master user."""
    text = _OPENSEARCH_TEMPLATE.read_text()
    if master_user_arn:
        text = text.replace("REPLACE_WITH_YOUR_IAM_ARN", master_user_arn)
    return Response(
        content=text,
        media_type="application/x-yaml",
        headers={"Content-Disposition": 'attachment; filename="ingestlib-opensearch.yaml"'},
    )


@router.post("/check/bedrock", response_model=CheckResult)
def check_bedrock(body: AwsCheckRequest) -> CheckResult:
    return checks.check_bedrock(body.profile, body.region)


@router.post("/check/s3", response_model=CheckResult)
def check_s3(body: S3CheckRequest) -> CheckResult:
    return checks.check_s3(body.profile, body.region, body.bucket)


@router.post("/check/vectordb", response_model=CheckResult)
def check_vectordb(body: VectorDbCheckRequest) -> CheckResult:
    return checks.check_vectordb(body.store, body.secrets, body.profile, body.region)


@router.post("/check/reranker", response_model=CheckResult)
def check_reranker(body: RerankerCheckRequest) -> CheckResult:
    return checks.check_reranker(body.reranker, body.api_key, body.profile, body.region)


@router.post("/check/ocr", response_model=CheckResult)
def check_ocr(body: OcrCheckRequest) -> CheckResult:
    return checks.check_ocr(body.server_url)


@router.get("/check/libreoffice", response_model=CheckResult)
def check_libreoffice() -> CheckResult:
    return checks.check_libreoffice()


@router.post("/complete", response_model=SetupStatus)
def complete(body: CompleteRequest) -> SetupStatus:
    try:
        writer.write_and_activate(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return status()
