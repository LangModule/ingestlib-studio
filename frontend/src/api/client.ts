import type {
  CheckResult,
  CompleteRequest,
  Reranker,
  SetupStatus,
  TryJobResponse,
  VectorStore,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} responded with ${response.status}`);
  return response.json();
}

// FastAPI puts human-readable messages in the detail field; anything else
// (validation objects, empty bodies) falls back to the status code.
async function errorFrom(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null);
  const detail = payload?.detail;
  return new Error(typeof detail === "string" ? detail : fallback);
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

export const api = {
  status: () => get<SetupStatus>("/api/setup/status"),
  awsProfiles: () => get<{ profiles: string[] }>("/api/setup/aws-profiles"),
  checkAws: (profile: string, region: string) =>
    post<CheckResult>("/api/setup/check/aws", { profile, region }),
  iamPolicy: (accountId: string, bucket: string, reranker: Reranker) =>
    get<object>(
      `/api/setup/iam-policy?account_id=${encodeURIComponent(accountId)}` +
        `&bucket=${encodeURIComponent(bucket)}&reranker=${reranker}`,
    ),
  checkBedrock: (profile: string, region: string) =>
    post<CheckResult>("/api/setup/check/bedrock", { profile, region }),
  checkS3: (profile: string, region: string, bucket: string) =>
    post<CheckResult>("/api/setup/check/s3", { profile, region, bucket }),
  checkVectorDb: (store: VectorStore, secrets: Record<string, string>) =>
    post<CheckResult>("/api/setup/check/vectordb", { store, secrets }),
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

  tryStart: async (file: File): Promise<TryJobResponse> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/try", { method: "POST", body: form });
    if (!response.ok) {
      throw await errorFrom(response, `upload failed with ${response.status}`);
    }
    return response.json();
  },
  tryGet: (jobId: string) => get<TryJobResponse>(`/api/try/${jobId}`),
  tryEventsUrl: (jobId: string) => `/api/try/${jobId}/events`,
  tryDelete: (jobId: string) =>
    fetch(`/api/try/${jobId}`, { method: "DELETE" }).then(() => undefined),
};
