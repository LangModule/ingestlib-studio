import { useEffect, useRef, useState } from "react";
import { api, followStageEvents } from "../api/client";
import type {
  AiProvider,
  ArtifactStore,
  BackfillStatus,
  CheckResult,
  CompleteRequest,
  Reranker,
  RulesConfig,
  SettingsView,
  SetupStatus,
  StageEvent,
  VectorStore,
} from "../api/types";
import { RulesEditor, rulesAreEmpty } from "../components/rules/RulesEditor";
import { StackChecklist } from "../components/StackChecklist";
import { StageStepper } from "../components/pipeline/StageStepper";
import { OpensearchDeployHint } from "../components/setup/OpensearchDeployHint";
import {
  AI_PROVIDERS,
  ARTIFACT_STORES,
  ChoiceCard,
  RERANKERS,
  STORES,
} from "../components/setup/Step2Choices";
import { Button, Card, Field, Select, TextInput } from "../components/setup/ui";

/* Settings: the effective configuration, edits applied without a restart,
   the full stack status, and backfill. The artifact store is the source of
   truth; the vector store is a derived index, so switching stores offers to
   rebuild the new one from the stored split artifacts.

   Layout: full-width rows of equal-height panels — the "what is" strip
   (configuration | status), then the edit form in two half-and-half rows
   (models | storage+servers, then vector database | reranker), then the
   content rules tables side by side. Backfill rebuilds the vector index,
   so it sits under the reranker in the retrieval row, where it also
   balances the tall store grid; when the configuration is managed
   externally the edit panels are hidden and backfill joins the top
   strip instead. */

interface FormState {
  aiProvider: AiProvider;
  artifactStore: ArtifactStore;
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
  const [rulesEditable, setRulesEditable] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<RulesConfig | null>(null);
  const [rulesKey, setRulesKey] = useState(0);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [rulesError, setRulesError] = useState("");
  const source = useRef<EventSource | null>(null);
  // The deploy hint pre-fills the template with the caller's IAM identity,
  // which the settings view does not carry; fetch it once when needed.
  const [arn, setArn] = useState("");

  const load = async () => {
    const fresh = await api.settingsGet();
    setView(fresh);
    setForm({
      aiProvider: fresh.ai_provider,
      artifactStore: fresh.artifact_store,
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
    api.rulesGet().then((view) => {
      setRulesEditable(view.editable);
      setRulesDraft(view.rules);
      setRulesKey((k) => k + 1); // reseed the editor from the fresh state
    });
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
      artifact_store: form.artifactStore,
      ai_provider: form.aiProvider,
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

  const groupTitle = (title: string) => (
    <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">
      {title}
    </h3>
  );

  // Rendered inside the vector database panel normally, or as a top-strip
  // card when the configuration is external and the edit panels are hidden.
  const backfillBody = (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-soft">
        The vector store is a rebuildable index over the artifact store. Backfill
        re-embeds the stored chunks into the selected store: no re-parse, no OCR
        server, and the previous store is left untouched.
      </p>
      {backfill ? (
        <p className="mono text-sm">
          The artifact store holds {backfill.documents} ingested document(s) ·{" "}
          {view.vector_store} holds {backfill.in_store}
        </p>
      ) : (
        <p className="text-sm text-fail">
          The store could not be reached, so the backfill picture is unknown.
          Fix the store configuration, save, and it refreshes.
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
    </div>
  );

  return (
    <div className="w-full px-10 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mono mt-1 truncate text-xs text-ink-soft" title={view.config_path}>
          {view.source} · {view.config_path}
        </p>
      </header>

      {error && (
        <Card className="mb-6 border-fail bg-fail-soft">
          <p className="text-sm text-fail">{error}</p>
        </Card>
      )}

      {/* The "what is" strip. items-stretch + flex-1 keeps the cards the
          same height regardless of content. */}
      <div
        className={`grid items-stretch gap-6 ${
          view.editable ? "lg:grid-cols-2" : "lg:grid-cols-3"
        }`}
      >
        <section className="flex flex-col">
          <h2 className="mb-2 text-sm font-semibold">Effective configuration</h2>
          <Card className="flex-1">
            <dl className="flex flex-col gap-2">
              {(
                [
                  ["AWS", `${view.profile} · ${view.region} · ${view.account_id}`],
                  view.ai_provider === "bedrock"
                    ? ["AI models", "AWS Bedrock · Nova LLM + embeddings"]
                    : ["AI models", "OpenAI · gpt-5-mini + text-embedding-3-small"],
                  view.artifact_store === "s3"
                    ? ["Artifact store", `S3 · ${view.bucket}`]
                    : ["Artifact store", "local · ~/.ingestlib/artifacts"],
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

        <section className="flex flex-col">
          <h2 className="mb-2 text-sm font-semibold">Stack status</h2>
          <Card className="flex-1">
            {status && <StackChecklist status={status} health={health} />}
            <Button kind="ghost" className="mt-4" onClick={runFullCheck} disabled={checking}>
              {checking ? "Checking…" : "Run full check"}
            </Button>
          </Card>
        </section>

        {!view.editable && (
          <section className="flex flex-col">
            <h2 className="mb-2 text-sm font-semibold">Backfill</h2>
            <Card className="flex-1">{backfillBody}</Card>
          </section>
        )}
      </div>

      {view.editable && (
        <section className="mt-10 flex flex-col gap-6">
          <h2 className="border-t border-line pt-8 text-sm font-semibold">Edit</h2>

          {/* Row one: models | storage and its servers. Each half is a panel;
              the grid stretches both to the row height so the boxes align. */}
          <div className="grid items-stretch gap-6 lg:grid-cols-2">
            <Card>
              {groupTitle("AI models")}
              <div className="grid grid-cols-2 gap-3">
                {AI_PROVIDERS.map((option) => (
                  <ChoiceCard
                    key={option.id}
                    selected={form.aiProvider === option.id}
                    title={option.title}
                    blurb={option.blurb}
                    onSelect={() => setForm({ ...form, aiProvider: option.id })}
                  />
                ))}
              </div>
              {form.aiProvider === "openai" && (
                <div className="mt-4">
                  <Field label="OpenAI API key" hint="platform.openai.com/api-keys">
                    <TextInput
                      type="password"
                      className="mono"
                      placeholder={secretPlaceholder("OPENAI_API_KEY", "sk-…")}
                      value={form.secrets.OPENAI_API_KEY ?? ""}
                      onChange={(e) => setSecret("OPENAI_API_KEY", e.target.value)}
                    />
                  </Field>
                </div>
              )}
              {form.aiProvider !== view.ai_provider && (
                <p className="mt-3 text-xs text-amber">
                  Switching the provider changes the embedding space: vectors written by the
                  old provider stop matching new queries. Pair the switch with a fresh vector
                  store (a different store, or a new database file/collection), then run
                  Backfill to re-embed every stored document into it.
                </p>
              )}
            </Card>

            <Card className="flex flex-col gap-6">
              <div>
                {groupTitle("Artifact store")}
                <div className="grid grid-cols-2 gap-3">
                  {ARTIFACT_STORES.map((option) => (
                    <ChoiceCard
                      key={option.id}
                      selected={form.artifactStore === option.id}
                      title={option.title}
                      blurb={option.blurb}
                      onSelect={() => setForm({ ...form, artifactStore: option.id })}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-soft">
                  Changing the artifact store points the studio at a different registry;
                  existing documents stay where they were written.
                </p>
              </div>

              <div>
                {groupTitle("Servers & storage")}
                <div className="flex flex-col gap-4">
                  {form.artifactStore === "s3" && (
                    <Field
                      label="S3 bucket"
                      hint="changing it points the studio at a different artifact registry"
                    >
                      <TextInput
                        value={form.bucket}
                        className="mono"
                        onChange={(e) => setForm({ ...form, bucket: e.target.value })}
                      />
                    </Field>
                  )}
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
                          setForm({
                            ...form,
                            ocrBackend: e.target.value as FormState["ocrBackend"],
                          })
                        }
                      >
                        <option value="mlx-vlm-server">mlx-vlm-server (Apple Silicon)</option>
                        <option value="vllm-server">vllm-server (NVIDIA)</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Row two: vector database | reranker + backfill. The eight-store
              grid makes the left panel tall; backfill under the reranker
              balances the right one. */}
          <div className="grid items-stretch gap-6 lg:grid-cols-2">
            <Card>
              {groupTitle("Vector database")}
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
                <div className="mt-4 flex flex-col gap-3">
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
                </div>
              )}
            </Card>

            <Card>
              {groupTitle("Reranker")}
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
                <div className="mt-4">
                  <Field label="Jina API key" hint="free at jina.ai/api-dashboard">
                    <TextInput
                      type="password"
                      className="mono"
                      placeholder={secretPlaceholder("JINA_API_KEY", "jina_…")}
                      value={form.secrets.JINA_API_KEY ?? ""}
                      onChange={(e) => setSecret("JINA_API_KEY", e.target.value)}
                    />
                  </Field>
                </div>
              )}
              <div className="mt-6 border-t border-line pt-4">
                {groupTitle("Backfill")}
                {backfillBody}
              </div>
            </Card>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={save}
              disabled={saving || (form.artifactStore === "s3" && !form.bucket)}
            >
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

      {rulesDraft && (
        <section className="mt-10 flex flex-col gap-3">
          <h2 className="border-t border-line pt-8 text-sm font-semibold">Content rules</h2>
          <p className="max-w-3xl text-sm text-ink-soft">
            Your classification rules and split categories, saved to rules.yaml
            beside config.yaml. Rules apply to <b>future</b> runs only —
            already-ingested documents keep their categories and sections
            (backfill re-embeds, it does not re-classify or re-split).
          </p>
          <RulesEditor
            key={rulesKey}
            initial={rulesDraft}
            disabled={!rulesEditable}
            columns
            onChange={(rules) => {
              setRulesDraft(rules);
              setRulesSaved(false);
            }}
          />
          {rulesError && (
            <Card className="border-fail bg-fail-soft">
              <p className="text-sm text-fail">{rulesError}</p>
            </Card>
          )}
          {rulesEditable ? (
            <div className="flex items-center gap-3">
              <Button
                onClick={async () => {
                  setRulesError("");
                  try {
                    const view = await api.rulesUpdate(rulesDraft);
                    setRulesDraft(view.rules);
                    setRulesKey((k) => k + 1);
                    setRulesSaved(true);
                  } catch (exc) {
                    setRulesError(exc instanceof Error ? exc.message : String(exc));
                  }
                }}
              >
                Save rules & apply
              </Button>
              {rulesSaved && (
                <span className="check-in text-sm font-medium text-ok">
                  {rulesAreEmpty(rulesDraft)
                    ? "cleared — classify and split are open-ended ✓"
                    : "saved — the next run uses these rules ✓"}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-amber">
              This configuration is managed externally, so rules are read-only
              here; edit rules.yaml beside it.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
