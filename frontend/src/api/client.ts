import type {
  ArtifactStore,
  BackfillJobResponse,
  BackfillStatus,
  CheckResult,
  CompleteRequest,
  DocumentSummary,
  DocumentView,
  IngestJobResponse,
  Reranker,
  RetrieveResponse,
  SettingsView,
  SetupStatus,
  StageEvent,
  TryJobResponse,
  VectorStore,
} from "./types";

// FastAPI puts human-readable messages in the detail field; anything else
// (validation objects, empty bodies) falls back to the status code.
async function errorFrom(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null);
  const detail = payload?.detail;
  return new Error(typeof detail === "string" ? detail : fallback);
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw await errorFrom(response, `${path} responded with ${response.status}`);
  }
  return response.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await errorFrom(response, `${path} responded with ${response.status}`);
  }
  return response.json();
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(path, { method: "POST", body: form });
  if (!response.ok) {
    throw await errorFrom(response, `upload failed with ${response.status}`);
  }
  return response.json();
}

export const api = {
  status: () => get<SetupStatus>("/api/setup/status"),
  awsProfiles: () => get<{ profiles: string[] }>("/api/setup/aws-profiles"),
  checkAws: (profile: string, region: string) =>
    post<CheckResult>("/api/setup/check/aws", { profile, region }),
  iamPolicy: (
    accountId: string,
    bucket: string,
    reranker: Reranker,
    store: VectorStore,
    artifactStore: ArtifactStore,
  ) =>
    get<object>(
      `/api/setup/iam-policy?account_id=${encodeURIComponent(accountId)}` +
        `&bucket=${encodeURIComponent(bucket)}&reranker=${reranker}&vector_store=${store}` +
        `&artifact_store=${artifactStore}`,
    ),
  opensearchTemplateUrl: (masterUserArn: string) =>
    `/api/setup/opensearch-template?master_user_arn=${encodeURIComponent(masterUserArn)}`,
  checkBedrock: (profile: string, region: string) =>
    post<CheckResult>("/api/setup/check/bedrock", { profile, region }),
  checkS3: (profile: string, region: string, bucket: string) =>
    post<CheckResult>("/api/setup/check/s3", { profile, region, bucket }),
  checkVectorDb: (
    store: VectorStore,
    secrets: Record<string, string>,
    profile: string,
    region: string,
  ) => post<CheckResult>("/api/setup/check/vectordb", { store, secrets, profile, region }),
  checkReranker: (reranker: Reranker, apiKey: string, profile: string, region: string) =>
    post<CheckResult>("/api/setup/check/reranker", {
      reranker,
      api_key: apiKey,
      profile,
      region,
    }),
  checkOcr: (serverUrl: string) =>
    post<CheckResult>("/api/setup/check/ocr", { server_url: serverUrl }),
  checkLibreOffice: () => get<CheckResult>("/api/setup/check/libreoffice"),
  health: () => get<Record<string, CheckResult>>("/api/setup/health"),
  complete: (body: CompleteRequest) => post<SetupStatus>("/api/setup/complete", body),

  tryStart: (file: File) => upload<TryJobResponse>("/api/try", file),
  tryGet: (jobId: string) => get<TryJobResponse>(`/api/try/${jobId}`),
  tryEventsUrl: (jobId: string) => `/api/try/${jobId}/events`,
  tryDelete: (jobId: string) =>
    fetch(`/api/try/${jobId}`, { method: "DELETE" }).then(() => undefined),

  ingestStart: (file: File) => upload<IngestJobResponse>("/api/ingest", file),
  ingestFromTry: async (tryJobId: string): Promise<IngestJobResponse> => {
    const response = await fetch(`/api/ingest/from-try/${tryJobId}`, { method: "POST" });
    if (!response.ok) {
      throw await errorFrom(response, `promotion failed with ${response.status}`);
    }
    return response.json();
  },
  ingestGet: (jobId: string) => get<IngestJobResponse>(`/api/ingest/${jobId}`),
  ingestEventsUrl: (jobId: string) => `/api/ingest/${jobId}/events`,

  retrieve: (question: string, topK: number) =>
    post<RetrieveResponse>("/api/retrieve", { question, top_k: topK }),

  documentsList: () => get<DocumentSummary[]>("/api/documents"),
  documentGet: (docId: string) => get<DocumentView>(`/api/documents/${docId}`),
  documentDelete: async (docId: string): Promise<void> => {
    const response = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
    if (!response.ok) {
      throw await errorFrom(response, `delete failed with ${response.status}`);
    }
  },

  settingsGet: () => get<SettingsView>("/api/settings"),
  settingsUpdate: async (body: CompleteRequest): Promise<SettingsView> => {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await errorFrom(response, `save failed with ${response.status}`);
    }
    return response.json();
  },
  backfillStatus: () => get<BackfillStatus>("/api/settings/backfill"),
  backfillStart: () => post<BackfillJobResponse>("/api/settings/backfill", {}),
  backfillGet: (jobId: string) => get<BackfillJobResponse>(`/api/settings/backfill/${jobId}`),
  backfillEventsUrl: (jobId: string) => `/api/settings/backfill/${jobId}/events`,
};

// Follow a job's live event stream. Stage events accumulate into onEvents;
// the terminal "job" event closes the stream and fires onTerminal, at which
// point the caller refetches the job for its final state. The returned
// source lets the caller close early on unmount.
export function followStageEvents(
  url: string,
  onEvents: (events: StageEvent[]) => void,
  onTerminal: () => void,
  onLost: () => void,
): EventSource {
  const events: StageEvent[] = [];
  const stream = new EventSource(url);
  stream.onmessage = (message) => {
    const event: StageEvent = JSON.parse(message.data);
    if (event.stage === "job") {
      stream.close();
      onTerminal();
      return;
    }
    events.push(event);
    onEvents([...events]);
  };
  stream.onerror = () => {
    stream.close();
    onLost();
  };
  return stream;
}
