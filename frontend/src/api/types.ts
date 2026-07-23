export type VectorStore =
  | "sqlite"
  | "pinecone"
  | "qdrant"
  | "pgvector"
  | "mongodb"
  | "milvus"
  | "opensearch"
  | "weaviate";
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

export type ArtifactStore = "s3" | "local";
export type AiProvider = "bedrock" | "openai";
export type UnmatchedMode = "require" | "other" | "skip";

export interface ClassifyRules {
  rules: Record<string, string>;
  target_pages: string;
  max_pages: number;
}

export interface SplitRules {
  categories: Record<string, string>;
  unmatched: UnmatchedMode;
}

export interface RulesConfig {
  classify: ClassifyRules;
  split: SplitRules;
}

export interface RulesView {
  editable: boolean;
  rules: RulesConfig;
}

export interface CompleteRequest {
  aws: { profile: string; region: string; account_id: string };
  bucket: string;
  vector_store: VectorStore;
  reranker: Reranker;
  artifact_store: ArtifactStore;
  ai_provider: AiProvider;
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

export interface IngestSummary {
  status: "ingested" | "skipped";
  doc_id: string;
  category: string;
  confidence: number;
  pages: number;
  sections: number;
  chunks: number;
  vectors: number;
}

export interface IngestJobResponse {
  job_id: string;
  filename: string;
  status: "running" | "done" | "failed";
  created: boolean;
  error: string | null;
  durations: Record<string, number>;
  summary: IngestSummary | null;
}

export interface DocumentSummary {
  doc_id: string;
  filename: string;
  page_count: number;
  category: string;
  sections: number;
  chunks: number;
  created_at: string;
  thumbnail_url: string;
}

export interface SettingsView {
  source: "wizard" | "env-var" | "cwd";
  config_path: string;
  editable: boolean;
  profile: string;
  region: string;
  account_id: string;
  bucket: string;
  vector_store: VectorStore;
  reranker: Reranker;
  artifact_store: ArtifactStore;
  ai_provider: AiProvider;
  ocr_backend: "mlx-vlm-server" | "vllm-server";
  ocr_url: string;
  secrets_set: string[];
}

export interface BackfillStatus {
  store: string;
  documents: number;
  in_store: number;
  missing: number;
}

export interface BackfillJobResponse {
  job_id: string;
  status: "running" | "done" | "failed";
  error: string | null;
  durations: Record<string, number>;
  pending: string[];
  summary: { documents: number; vectors: number; store: string } | null;
}

export interface HitView {
  doc_id: string;
  chunk_id: number;
  filename: string;
  category: string;
  section: string;
  heading: string;
  kind: string;
  pages: number[];
  region_ids: Record<number, number[]>;
  markdown: string;
  vector_score: number;
  rerank_score: number | null;
}

export interface RetrieveResponse {
  question: string;
  hits: HitView[];
}
