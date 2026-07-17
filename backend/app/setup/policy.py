"""Builder for the least-privilege IAM policy the wizard renders pre-filled."""
from typing import Any

from app.setup.defaults import (
    AWS_RERANK_MODEL_ID,
    AWS_RERANK_REGION,
    EMBEDDING_MODEL_ID,
    LLM_MODEL_ID,
)


def build_iam_policy(account_id: str, bucket: str, reranker: str) -> dict[str, Any]:
    """Return the least-privilege policy for the given answers.

    The Nova model id is a cross-region inference profile, so the policy
    needs both the account-scoped profile ARN and the underlying model ARNs
    in every region the profile can route to; that is why the model ARNs use
    a wildcard region. s3:DeleteObject is included because the studio's
    document-delete feature uses it."""
    statements: list[dict[str, Any]] = [
        {
            "Sid": "IngestlibBedrock",
            "Effect": "Allow",
            "Action": "bedrock:InvokeModel",
            "Resource": [
                f"arn:aws:bedrock:*::foundation-model/{LLM_MODEL_ID.removeprefix('us.')}",
                f"arn:aws:bedrock:*::foundation-model/{EMBEDDING_MODEL_ID}",
                f"arn:aws:bedrock:*:{account_id}:inference-profile/{LLM_MODEL_ID}",
            ],
        },
        {
            "Sid": "IngestlibBucket",
            "Effect": "Allow",
            "Action": ["s3:CreateBucket", "s3:ListBucket"],
            "Resource": f"arn:aws:s3:::{bucket}",
        },
        {
            "Sid": "IngestlibObjects",
            "Effect": "Allow",
            "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
            "Resource": f"arn:aws:s3:::{bucket}/*",
        },
    ]
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
    return {"Version": "2012-10-17", "Statement": statements}
