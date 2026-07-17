"""Model identifiers and endpoints that mirror the ingestlib defaults.

The wizard verifies, and grants permissions for, exactly what the pipeline
will later invoke, so these values must match the library's.
"""

LLM_MODEL_ID = "us.amazon.nova-2-lite-v1:0"
EMBEDDING_MODEL_ID = "amazon.nova-2-multimodal-embeddings-v1:0"
AWS_RERANK_MODEL_ID = "amazon.rerank-v1:0"
AWS_RERANK_REGION = "us-west-2"
JINA_BASE_URL = "https://api.jina.ai/v1"
JINA_RERANK_MODEL_ID = "jina-reranker-v3"
OCR_DEFAULT_URL = "http://localhost:8111/"
