import { useState } from "react";
import { api } from "../../api/client";
import type { CompleteRequest } from "../../api/types";
import type { WizardState } from "../../routes/Setup";
import { Button, Card } from "./ui";

function mask(value: string): string {
  if (!value) return "—";
  return value.length <= 6 ? "•".repeat(value.length) : `${value.slice(0, 4)}…${"•".repeat(6)}`;
}

const DEFAULT_OCR = { url: "http://localhost:8111/", backend: "mlx-vlm-server" };

export function StepFinish({
  state,
  onBack,
  onDone,
}: {
  state: WizardState;
  onBack: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const [done, setDone] = useState(false);

  // Write only the secrets the choices actually need. A Jina key typed
  // before switching to another reranker must not end up in .env.
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.secrets)) {
    if (value) secrets[key] = value;
  }
  if (state.reranker !== "jina") delete secrets.JINA_API_KEY;

  const complete = async () => {
    setWriting(true);
    setError("");
    const body: CompleteRequest = {
      aws: { profile: state.profile, region: state.region, account_id: state.accountId },
      bucket: state.bucket,
      vector_store: state.store,
      reranker: state.reranker,
      secrets,
    };
    if (state.ocrUrl !== DEFAULT_OCR.url || state.ocrBackend !== DEFAULT_OCR.backend) {
      body.paddle_vl = { backend: state.ocrBackend, server_url: state.ocrUrl };
    }
    try {
      await api.complete(body);
      // A short configured beat, then a full reload picks up the new status.
      setDone(true);
      setTimeout(onDone, 1400);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setWriting(false);
    }
  };

  const rows: [string, string][] = [
    ["AWS profile", `${state.profile} · ${state.region} · ${state.accountId}`],
    ["S3 bucket", state.bucket],
    ["Vector database", state.store],
    ["Reranker", state.reranker],
    ...Object.entries(secrets).map(([key, value]) => [key, mask(value)] as [string, string]),
    ["OCR server", `${state.ocrUrl} (${state.ocrBackend})`],
  ];

  if (done) {
    return (
      <div className="step-enter fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-ground">
        <span className="wordmark text-3xl font-semibold text-ink">
          ingestlib<span className="text-accent">·</span>studio
        </span>
        <p className="text-sm font-medium text-ok">configured ✓</p>
        <p className="text-xs text-ink-soft">opening the library…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Review &amp; finish</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Writes ~/.ingestlib/config.yaml with your answers only; everything else stays a
          library default. Secrets go to ~/.ingestlib/.env with file mode 600. No restart
          is needed.
        </p>
      </header>

      <Card>
        <dl className="flex flex-col gap-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between gap-6 border-b border-line pb-2 last:border-0"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                {label}
              </dt>
              <dd className="mono text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {error && (
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm text-fail">{error}</p>
        </Card>
      )}

      <div className="flex justify-between">
        <Button kind="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={complete} disabled={writing}>
          {writing ? "Writing…" : "Finish setup → open Library"}
        </Button>
      </div>
    </div>
  );
}
