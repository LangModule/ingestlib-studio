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

export interface StageEvent {
  stage: string;
  event: "start" | "done" | "failed";
  seconds: number | null;
  detail: string | null;
}

export interface RegionView {
  region_id: number;
  region_type: string;
  text: string;
  content: string;
  bbox: [number, number, number, number];
  image_url: string | null;
}

export interface PageView {
  page_num: number;
  width: number;
  height: number;
  image_url: string;
  markdown: string;
  text: string;
  regions: RegionView[];
}

export interface ClassifyView {
  category: string;
  confidence: number;
  reasoning: string;
  alternatives: { label: string; score: number }[];
  pages_used: number;
}

export interface SectionView {
  name: string;
  description: string;
  pages: number[];
  chunk_ids: number[];
}

export interface ChunkView {
  chunk_id: number;
  section: string;
  heading: string;
  kind: string;
  token_estimate: number;
  pages: number[];
  region_ids: Record<number, number[]>;
  markdown: string;
  text: string;
}

export interface DocumentView {
  filename: string;
  page_count: number;
  pages: PageView[];
  classify: ClassifyView;
  sections: SectionView[];
  chunks: ChunkView[];
}

export interface TryJobResponse {
  job_id: string;
  filename: string;
  status: "running" | "done" | "failed";
  created: boolean;
  error: string | null;
  durations: Record<string, number>;
  result: DocumentView | null;
}
