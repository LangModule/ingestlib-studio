"""Builder for the least-privilege IAM policy the wizard renders pre-filled."""
from typing import Any

from app.setup.defaults import (
    AWS_RERANK_MODEL_ID,
    AWS_RERANK_REGION,
    EMBEDDING_MODEL_ID,
    LLM_MODEL_ID,
)


def build_iam_policy(
    account_id: str,
    bucket: str,
    reranker: str,
    vector_store: str = "",
    artifact_store: str = "s3",
    ai_provider: str = "bedrock",
) -> dict[str, Any]:
    """Return the least-privilege policy for the given answers.

    The Nova model id is a cross-region inference profile, so the policy
    needs both the account-scoped profile ARN and the underlying model ARNs
    in every region the profile can route to; that is why the model ARNs use
    a wildcard region. The Bedrock statement exists only when Bedrock serves
    the LLM and embeddings (OpenAI needs no IAM at all), and the S3
    statements only when artifacts live on S3; s3:DeleteObject is included
    because the studio's document-delete feature uses it."""
    statements: list[dict[str, Any]] = []
    if ai_provider == "bedrock":
        statements.append({
            "Sid": "IngestlibBedrock",
            "Effect": "Allow",
            "Action": "bedrock:InvokeModel",
            "Resource": [
                f"arn:aws:bedrock:*::foundation-model/{LLM_MODEL_ID.removeprefix('us.')}",
                f"arn:aws:bedrock:*::foundation-model/{EMBEDDING_MODEL_ID}",
                f"arn:aws:bedrock:*:{account_id}:inference-profile/{LLM_MODEL_ID}",
            ],
        })
    if artifact_store == "s3":
        statements.append({
            "Sid": "IngestlibBucket",
            "Effect": "Allow",
            "Action": ["s3:CreateBucket", "s3:ListBucket"],
            "Resource": f"arn:aws:s3:::{bucket}",
        })
        statements.append({
            "Sid": "IngestlibObjects",
            "Effect": "Allow",
            "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
            "Resource": f"arn:aws:s3:::{bucket}/*",
        })
    if reranker == "aws":
        statements.append({
            "Sid": "IngestlibRerank",
            "Effect": "Allow",
            "Action": ["bedrock:Rerank"],
            "Resource": "*",  # bedrock:Rerank does not support resource-level scoping
        })
        statements.append({
            "Sid": "IngestlibRerankModel",
            "Effect": "Allow",
            "Action": "bedrock:InvokeModel",
            "Resource": (
                f"arn:aws:bedrock:{AWS_RERANK_REGION}::foundation-model/{AWS_RERANK_MODEL_ID}"
            ),
        })
    if vector_store == "opensearch":
        # A domain with fine-grained access control authorizes signed
        # requests by itself, so the pipeline needs no identity statements
        # to USE it. These let the same user CREATE and manage the domain
        # with the CloudFormation template the wizard offers.
        statements.append({
            "Sid": "IngestlibOpensearchStack",
            "Effect": "Allow",
            "Action": "cloudformation:*",
            "Resource": f"arn:aws:cloudformation:*:{account_id}:stack/ingestlib-opensearch/*",
        })
        statements.append({
            "Sid": "IngestlibOpensearchTemplateOps",
            "Effect": "Allow",
            "Action": ["cloudformation:ValidateTemplate", "cloudformation:GetTemplateSummary"],
            "Resource": "*",
        })
        statements.append({
            "Sid": "IngestlibOpensearchDomain",
            "Effect": "Allow",
            "Action": "es:*",
            "Resource": f"arn:aws:es:*:{account_id}:domain/ingestlib*",
        })
    return {"Version": "2012-10-17", "Statement": statements}
