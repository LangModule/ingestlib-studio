export type VectorStore = "sqlite" | "pinecone" | "qdrant" | "pgvector" | "mongodb" | "milvus";
export type Reranker = "jina" | "aws" | "none";

export type FailureKind = "ok" | "credentials" | "access-denied" | "model-access" | "error";

export interface CheckResult {
  ok: boolean;
  detail: string;
  kind: FailureKind;
  data: Record<string, unknown>;
}

export interface SetupStatus {
  configured: boolean;
  config_path: string | null;
  source: "wizard" | "env-var" | "cwd" | null;
  checks: Record<string, string>;
}

export interface CompleteRequest {
  aws: { profile: string; region: string; account_id: string };
  bucket: string;
  vector_store: VectorStore;
  reranker: Reranker;
  secrets: Record<string, string>;
  paddle_vl?: { backend: "mlx-vlm-server" | "vllm-server"; server_url: string };
}
