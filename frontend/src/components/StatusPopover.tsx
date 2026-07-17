import { useState } from "react";
import { api } from "../api/client";
import type { CheckResult, SetupStatus } from "../api/types";
import { StackChecklist } from "./StackChecklist";

export function StatusPopover({ status }: { status: SetupStatus }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState<Record<string, CheckResult> | null>(null);

  const dot = status.checks.ocr === "ok" ? "bg-ok" : "bg-ink-soft";

  const runFullCheck = async () => {
    setRunning(true);
    try {
      setHealth(await api.health());
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Stack status"
        onClick={() => setOpen((value) => !value)}
        className={`block h-2.5 w-2.5 rounded-full transition ${dot} ${
          open ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : "hover:scale-125"
        }`}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="step-enter fixed top-14 right-4 z-50 max-h-[80vh] w-96 overflow-auto rounded-lg border border-line bg-card p-4 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">Stack status</span>
              <button
                type="button"
                onClick={runFullCheck}
                disabled={running}
                className="rounded-md border border-line px-2 py-1 text-xs text-ink hover:border-ink-soft disabled:opacity-40"
              >
                {running ? "Checking…" : "Run full check"}
              </button>
            </div>
            <p className="mono mb-3 truncate text-xs text-ink-soft" title={status.config_path ?? ""}>
              {status.source} · {status.config_path}
            </p>

            <StackChecklist status={status} health={health} />

            {!health && (
              <p className="mt-3 text-xs text-ink-soft">
                The OCR server and LibreOffice rows refresh automatically. Run the full
                check to probe AWS, storage, and the reranker with real calls.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
