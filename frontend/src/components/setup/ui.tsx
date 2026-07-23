import { useCallback, useState, type ReactNode } from "react";
import type { CheckResult } from "../../api/types";
import { IconCheck, IconX } from "../icons";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-card p-6 ${className}`}>{children}</div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-field px-3 py-2 text-sm text-ink outline-none " +
  "placeholder:text-ink-soft/60 focus:border-accent focus:ring-1 focus:ring-accent " +
  "disabled:opacity-40";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Button({
  kind = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "ghost" }) {
  const styles =
    kind === "primary"
      ? "bg-accent text-accent-ink hover:brightness-110 disabled:opacity-40"
      : "border border-line bg-card text-ink hover:border-ink-soft disabled:opacity-40";
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${styles} ${props.className ?? ""}`}
    />
  );
}

export type CheckState = { status: "idle" | "running" | "ok" | "fail"; result?: CheckResult };

export function useCheck(run: () => Promise<CheckResult>): [CheckState, () => Promise<CheckResult>] {
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const trigger = useCallback(async () => {
    setState({ status: "running" });
    try {
      const result = await run();
      setState({ status: result.ok ? "ok" : "fail", result });
      return result;
    } catch (error) {
      const result: CheckResult = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        kind: "error",
        data: {},
      };
      setState({ status: "fail", result });
      return result;
    }
  }, [run]);
  return [state, trigger];
}

export function CheckBadge({ state }: { state: CheckState }) {
  if (state.status === "idle") return null;
  if (state.status === "running")
    return <span className="text-xs text-ink-soft">checking…</span>;
  const ok = state.status === "ok";
  return (
    <span
      className={`inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
        ok ? "bg-ok-soft text-ok" : "bg-fail-soft text-fail"
      }`}
    >
      <span className="mt-0.5">
        {ok ? <IconCheck className="h-3 w-3" /> : <IconX className="h-3 w-3" />}
      </span>
      <span>{state.result?.detail}</span>
    </span>
  );
}

export function VerifyRow({
  label,
  state,
  onVerify,
  children,
}: {
  label: string;
  state: CheckState;
  onVerify: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Button kind="ghost" onClick={onVerify} disabled={state.status === "running"}>
          {state.status === "running" ? "Checking…" : "Verify"}
        </Button>
      </div>
      {children}
      <CheckBadge state={state} />
    </div>
  );
}
