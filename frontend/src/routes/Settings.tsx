import { useEffect, useRef, useState } from "react";
import { api, followStageEvents } from "../api/client";
import type {
  BackfillStatus,
  CheckResult,
  CompleteRequest,
  Reranker,
  SettingsView,
  SetupStatus,
  StageEvent,
  VectorStore,
} from "../api/types";
import { StackChecklist } from "../components/StackChecklist";
import { StageStepper } from "../components/pipeline/StageStepper";
import { OpensearchDeployHint } from "../components/setup/OpensearchDeployHint";
import { ChoiceCard, RERANKERS, STORES } from "../components/setup/Step2Choices";
import { Button, Card, Field, Select, TextInput } from "../components/setup/ui";

/* Settings: the effective configuration, edits applied without a restart,
   the full stack status, and backfill. S3 is the source of truth; the
   vector store is a derived index, so switching stores offers to rebuild
   the new one from the stored split artifacts. */

interface FormState {
  bucket: string;
  store: VectorStore;
  reranker: Reranker;
  secrets: Record<string, string>;
  ocrUrl: string;
  ocrBackend: "mlx-vlm-server" | "vllm-server";
}

type BackfillPhase =
  | { name: "idle" }
  | { name: "running"; pending: string[]; events: StageEvent[] }
  | { name: "done"; documents: number; vectors: number }
  | { name: "failed"; error: string };

export default function Settings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [health, setHealth] = useState<Record<string, CheckResult> | null>(null);
  const [checking, setChecking] = useState(false);

  const [backfill, setBackfill] = useState<BackfillStatus | null>(null);
  const [backfillPhase, setBackfillPhase] = useState<BackfillPhase>({ name: "idle" });
  const source = useRef<EventSource | null>(null);
  // The deploy hint pre-fills the template with the caller's IAM identity,
  // which the settings view does not carry; fetch it once when needed.
  const [arn, setArn] = useState("");

  const load = async () => {
    const fresh = await api.settingsGet();
    setView(fresh);
    setForm({
      bucket: fresh.bucket,
      store: fresh.vector_store,
      reranker: fresh.reranker,
      secrets: {},
      ocrUrl: fresh.ocr_url,
      ocrBackend: fresh.ocr_backend,
    });
    // A broken store must not take the page down: Settings is where it gets
    // fixed. The backfill section shows its own note instead.
    api.backfillStatus().then(setBackfill).catch(() => setBackfill(null));
  };

  useEffect(() => {
    api.status().then(setStatus);
    load().catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
    return () => source.current?.close();
  }, []);

  useEffect(() => {
    if (!view || !form || form.store !== "opensearch" || arn) return;
    api
      .checkAws(view.profile, view.region)
      .then((result) => setArn(String(result.data.arn ?? "")))
      .catch(() => undefined);
  }, [view, form, arn]);

  const setSecret = (key: string, value: string) =>
    setForm((prev) => prev && { ...prev, secrets: { ...prev.secrets, [key]: value } });

  const save = async () => {
    if (!view || !form) return;
    setSaving(true);
    setSaved(false);
    setError("");
    const body: CompleteRequest = {
      aws: { profile: view.profile, region: view.region, account_id: view.account_id },
      bucket: form.bucket,
      vector_store: form.store,
      reranker: form.reranker,
      secrets: Object.fromEntries(
        Object.entries(form.secrets).filter(([, value]) => value),
      ),
      paddle_vl: { backend: form.ocrBackend, server_url: form.ocrUrl },
    };
    try {
      setView(await api.settingsUpdate(body));
      setSaved(true);
      // The store may have changed, so the backfill picture may have too.
      api.backfillStatus().then(setBackfill).catch(() => setBackfill(null));
      setBackfillPhase({ name: "idle" });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setSaving(false);
    }
  };

  const runFullCheck = async () => {
    setChecking(true);
    try {
      setHealth(await api.health());
    } finally {
      setChecking(false);
    }
  };

  const startBackfill = async () => {
    try {
      const job = await api.backfillStart();
      const pending = job.pending;
      source.current = followStageEvents(
        api.backfillEventsUrl(job.job_id),
        (events) => setBackfillPhase({ name: "running", pending, events }),
        async () => {
          const finished = await api.backfillGet(job.job_id);
          if (finished.status === "done" && finished.summary) {
            setBackfillPhase({
              name: "done",
              documents: finished.summary.documents,
              vectors: finished.summary.vectors,
            });
          } else {
            setBackfillPhase({ name: "failed", error: finished.error ?? "the run failed" });
          }
          setBackfill(await api.backfillStatus());
        },
        () =>
          setBackfillPhase({
            name: "failed",
            error: "lost the event stream; the backend may have restarted",
          }),
      );
      setBackfillPhase({ name: "running", pending, events: [] });
    } catch (exc) {
      setBackfillPhase({
        name: "failed",
        error: exc instanceof Error ? exc.message : String(exc),
      });
    }
  };

  if (!view || !form) {
    return (
      <p className="mono px-6 py-16 text-center text-sm text-ink-soft">
        {error || "loading settings…"}
      </p>
    );
  }

  const selectedStore = STORES.find((option) => option.id === form.store)!;
  const secretPlaceholder = (key: string, fallback: string) =>
    view.secrets_set.includes(key) ? "saved · leave empty to keep" : fallback;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mono mt-1 truncate text-xs text-ink-soft" title={view.config_path}>
          {view.source} · {view.config_path}
        </p>
      </header>

      {error && (
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm text-fail">{error}</p>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Effective configuration</h2>
        <Card>
          <dl className="flex flex-col gap-2">
            {(
              [
                ["AWS", `${view.profile} · ${view.region} · ${view.account_id}`],
                ["S3 bucket", view.bucket],
                ["Vector store", view.vector_store],
                ["Reranker", view.reranker],
                ["OCR server", `${view.ocr_url} (${view.ocr_backend})`],
                ["Secrets in .env", view.secrets_set.join(", ") || "none"],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-6 border-b border-line pb-2 last:border-0"
              >
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  {label}
                </dt>
                <dd className="mono truncate text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          {!view.editable && (
            <p className="mt-3 text-xs text-amber">
              This configuration is managed externally ({view.source}), so it is
              read-only here; edit the file where it lives.
            </p>
          )}
        </Card>
      </section>

      {view.editable && (
        <section className="flex flex-col gap-6">
          <h2 className="text-sm font-semibold">Edit</h2>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">
              Vector database
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {STORES.map((option) => (
                <ChoiceCard
                  key={option.id}
                  selected={form.store === option.id}
                  title={option.title}
                  blurb={option.blurb}
                  onSelect={() => setForm({ ...form, store: option.id })}
                />
              ))}
            </div>
            {(selectedStore.secretFields.length > 0 || selectedStore.dockerHint) && (
              <Card className="mt-3 flex flex-col gap-3">
                {selectedStore.secretFields.map((field) => (
                  <Field key={field.key} label={field.label}>
                    <TextInput
                      type={field.password ? "password" : "text"}
                      className="mono"
                      placeholder={secretPlaceholder(field.key, field.placeholder)}
                      value={form.secrets[field.key] ?? ""}
                      onChange={(e) => setSecret(field.key, e.target.value)}
                    />
                  </Field>
                ))}
                {selectedStore.dockerHint && (
                  <p className="text-xs text-ink-soft">
                    No server yet? <code className="mono">{selectedStore.dockerHint}</code>
                  </p>
                )}
                {form.store === "opensearch" && (
                  <OpensearchDeployHint arn={arn} profile={view.profile} region={view.region} />
                )}
              </Card>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">
              Reranker
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {RERANKERS.map((option) => (
                <ChoiceCard
                  key={option.id}
                  selected={form.reranker === option.id}
                  title={option.title}
                  blurb={option.blurb}
                  onSelect={() => setForm({ ...form, reranker: option.id })}
                />
              ))}
            </div>
            {form.reranker === "jina" && (
              <Card className="mt-3">
                <Field label="Jina API key" hint="free at jina.ai/api-dashboard">
                  <TextInput
                    type="password"
                    className="mono"
                    placeholder={secretPlaceholder("JINA_API_KEY", "jina_…")}
                    value={form.secrets.JINA_API_KEY ?? ""}
                    onChange={(e) => setSecret("JINA_API_KEY", e.target.value)}
                  />
                </Field>
              </Card>
            )}
          </div>

          <Card className="flex flex-col gap-4">
            <Field
              label="S3 bucket (artifact store)"
              hint="changing it points the studio at a different artifact registry"
            >
              <TextInput
                value={form.bucket}
                className="mono"
                onChange={(e) => setForm({ ...form, bucket: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="OCR server URL">
                <TextInput
                  className="mono"
                  value={form.ocrUrl}
                  onChange={(e) => setForm({ ...form, ocrUrl: e.target.value })}
                />
              </Field>
              <Field label="OCR backend">
                <Select
                  value={form.ocrBackend}
                  onChange={(e) =>
                    setForm({ ...form, ocrBackend: e.target.value as FormState["ocrBackend"] })
                  }
                >
                  <option value="mlx-vlm-server">mlx-vlm-server (Apple Silicon)</option>
                  <option value="vllm-server">vllm-server (NVIDIA)</option>
                </Select>
              </Field>
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || !form.bucket}>
              {saving ? "Applying…" : "Save & apply"}
            </Button>
            {saved && (
              <span className="check-in text-sm font-medium text-ok">
                applied, no restart needed ✓
              </span>
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Stack status</h2>
        <Card>
          {status && <StackChecklist status={status} health={health} />}
          <Button kind="ghost" className="mt-4" onClick={runFullCheck} disabled={checking}>
            {checking ? "Checking…" : "Run full check"}
          </Button>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Backfill</h2>
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">
            S3 is the source of truth; the vector store is a rebuildable index. Backfill
            re-embeds the stored chunks into the selected store: no re-parse, no OCR
            server, and the previous store is left untouched.
          </p>
          {backfill ? (
            <p className="mono text-sm">
              S3 holds {backfill.documents} ingested document(s) ·{" "}
              {view.vector_store} holds {backfill.in_store}
            </p>
          ) : (
            <p className="text-sm text-fail">
              The store could not be reached, so the backfill picture is unknown.
              Fix the configuration above, save, and it refreshes.
            </p>
          )}

          {backfillPhase.name === "running" && (
            <StageStepper stages={backfillPhase.pending} events={backfillPhase.events} />
          )}
          {backfillPhase.name === "done" && (
            <p className="check-in text-sm font-medium text-ok">
              backfilled {backfillPhase.documents} document(s) ·{" "}
              {backfillPhase.vectors} vector(s) re-embedded ✓
            </p>
          )}
          {backfillPhase.name === "failed" && (
            <p className="text-sm text-fail">{backfillPhase.error}</p>
          )}

          {backfill && backfill.missing > 0 && backfillPhase.name !== "running" && (
            <Button className="self-start" onClick={startBackfill}>
              Backfill {backfill.missing} document(s) → {view.vector_store}
            </Button>
          )}
          {backfill && backfill.missing === 0 && backfillPhase.name === "idle" && (
            <p className="text-sm text-ok">
              every ingested document is already in {view.vector_store} ✓
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}
