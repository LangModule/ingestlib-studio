import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { CheckResult, FailureKind } from "../../api/types";
import type { WizardState } from "../../routes/Setup";
import { Button, Card } from "./ui";

type RowState = { status: "idle" | "running" | "ok" | "fail"; result?: CheckResult };

const S3_ROW = "S3 bucket";
const BASE_ROWS = ["Bedrock (Nova LLM + embeddings)", S3_ROW, "Vector database", "Reranker"];

// When several checks fail, the guidance card for the most fundamental
// problem wins: credentials first, then IAM, then model access.
const KIND_PRIORITY: FailureKind[] = ["credentials", "access-denied", "model-access", "error"];

export function Step3Permissions({
  state,
  onNext,
  onBack,
  onCredentialFailure,
}: {
  state: WizardState;
  onNext: () => void;
  onBack: () => void;
  onCredentialFailure: () => void;
}) {
  const [policy, setPolicy] = useState<object | null>(null);
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  // A local artifact store needs no bucket: no S3 check, no S3 IAM statements.
  const activeRows = BASE_ROWS.filter(
    (row) => row !== S3_ROW || state.artifactStore === "s3",
  );

  useEffect(() => {
    api
      .iamPolicy(state.accountId, state.bucket, state.reranker, state.store, state.artifactStore)
      .then(setPolicy);
  }, [state.accountId, state.bucket, state.reranker, state.store, state.artifactStore]);

  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify(policy, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const verifyAll = async () => {
    setRunning(true);
    const set = (row: string, value: RowState) =>
      setRows((previous) => ({ ...previous, [row]: value }));
    const probes: [string, () => Promise<CheckResult>][] = [
      ["Bedrock (Nova LLM + embeddings)", () => api.checkBedrock(state.profile, state.region)],
      [S3_ROW, () => api.checkS3(state.profile, state.region, state.bucket)],
      ["Vector database",
        () => api.checkVectorDb(state.store, state.secrets, state.profile, state.region)],
      ["Reranker", () =>
        api.checkReranker(
          state.reranker,
          state.secrets.JINA_API_KEY ?? "",
          state.profile,
          state.region,
        )],
    ].filter(([row]) => activeRows.includes(row as string)) as [
      string,
      () => Promise<CheckResult>,
    ][];
    for (const [row, probe] of probes) {
      set(row, { status: "running" });
      try {
        const result = await probe();
        set(row, { status: result.ok ? "ok" : "fail", result });
      } catch (error) {
        set(row, {
          status: "fail",
          result: { ok: false, detail: String(error), kind: "error", data: {} },
        });
      }
    }
    setRunning(false);
  };

  const failures = Object.values(rows).filter((row) => row.status === "fail");
  const worstKind =
    KIND_PRIORITY.find((kind) => failures.some((f) => f.result?.kind === kind)) ?? null;
  const allOk = activeRows.every((row) => rows[row]?.status === "ok");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Permissions &amp; verify</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Attach this least-privilege policy to your IAM user or role, then verify with real
          calls: a one-token Nova chat, one embedding, and your storage choices.
        </p>
      </header>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">
            IAM policy, pre-filled for account {state.accountId}
            {state.artifactStore === "s3" && ` and bucket ${state.bucket}`}
            {state.reranker === "aws" && ", including Amazon Rerank"}
            {state.store === "opensearch" && ", including OpenSearch domain deploy"}
          </span>
          <Button kind="ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy JSON"}</Button>
        </div>
        <pre className="mono max-h-72 overflow-auto rounded-lg border border-line bg-lighttable p-4 text-xs leading-relaxed text-ink">
          {policy ? JSON.stringify(policy, null, 2) : "…"}
        </pre>
        <p className="mt-2 text-xs text-ink-soft">
          IAM console → your user or role → Add permissions → Create inline policy → JSON.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        {activeRows.map((row) => {
          const rowState = rows[row] ?? { status: "idle" };
          return (
            <div key={row} className="flex items-start justify-between gap-4">
              <span className="text-sm">{row}</span>
              <span className="text-right text-xs">
                {rowState.status === "idle" && <span className="text-ink-soft">—</span>}
                {rowState.status === "running" && (
                  <span className="inline-flex items-center gap-1.5 text-ink-soft">
                    <span className="h-3 w-3 animate-spin rounded-full border border-ink-soft border-t-transparent" />
                    checking…
                  </span>
                )}
                {rowState.status === "ok" && (
                  <span className="check-in inline-block font-semibold text-ok">
                    ✓ {rowState.result?.detail}
                  </span>
                )}
                {rowState.status === "fail" && (
                  <span className="check-in inline-block font-semibold text-fail">
                    ✗ {rowState.result?.detail}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        <Button onClick={verifyAll} disabled={running} className="mt-1 self-start">
          {running ? "Verifying…" : "Verify all"}
        </Button>
      </Card>

      {worstKind === "credentials" && (
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm">
            Credentials failed. The profile is missing or the SSO session expired.
          </p>
          <Button kind="ghost" className="mt-2" onClick={onCredentialFailure}>
            ← Back to Connect AWS
          </Button>
        </Card>
      )}
      {worstKind === "access-denied" && (
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm">
            <span className="font-semibold">Access denied: the IAM policy is not applied yet.</span>{" "}
            Copy the JSON above into the IAM console, attach it, then run Verify all again.
          </p>
        </Card>
      )}
      {worstKind === "model-access" && (
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm">
            <span className="font-semibold">Bedrock model access is missing.</span> This is
            separate from IAM. Open the Bedrock console, go to Model access in {state.region}
            {state.reranker === "aws" && " and in us-west-2 for amazon.rerank-v1:0"}, enable the
            Nova models, then run Verify all again.
          </p>
        </Card>
      )}

      <div className="flex justify-between">
        <Button kind="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onNext} disabled={!allOk}>Next: Machine →</Button>
      </div>
    </div>
  );
}
