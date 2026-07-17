import { useState } from "react";
import { api } from "../api/client";
import type { CheckResult, SetupStatus } from "../api/types";

// Everything the pipeline depends on, in the order the wizard verified it.
const ROWS: { key: string; label: string; needs: string }[] = [
  { key: "bedrock", label: "Bedrock", needs: "Nova LLM and embeddings via your AWS profile" },
  { key: "s3", label: "S3 artifact store", needs: "holds parsed pages, results, and sources" },
  { key: "vectordb", label: "Vector database", needs: "stores and searches chunk embeddings" },
  { key: "reranker", label: "Reranker", needs: "orders retrieval hits by relevance" },
  { key: "ocr", label: "OCR server", needs: "PaddleOCR-VL; required by Try it and Ingest" },
  { key: "libreoffice", label: "LibreOffice", needs: "converts DOCX and PPTX to PDF" },
];

type Health = Record<string, CheckResult>;

function LocalBadge({ value }: { value: string | undefined }) {
  if (value === "ok") return <span className="text-xs font-semibold text-ok">✓ ok</span>;
  if (value === undefined) return <span className="text-xs text-ink-soft">—</span>;
  return <span className="text-xs font-semibold text-fail">✗ {value}</span>;
}

export function StatusPopover({ status }: { status: SetupStatus }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

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

            <ul className="flex flex-col gap-2.5">
              {ROWS.map((row) => {
                const result = health?.[row.key];
                const isLocal = row.key === "ocr" || row.key === "libreoffice";
                return (
                  <li key={row.key} className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block text-xs font-medium">{row.label}</span>
                      <span className="block text-xs text-ink-soft">{row.needs}</span>
                    </span>
                    <span className="max-w-[11rem] text-right">
                      {result ? (
                        <span
                          className={`check-in inline-block text-xs font-semibold ${
                            result.ok ? "text-ok" : "text-fail"
                          }`}
                        >
                          {result.ok ? "✓" : "✗"} {result.detail}
                        </span>
                      ) : isLocal ? (
                        <LocalBadge value={status.checks[row.key]} />
                      ) : (
                        <span className="text-xs text-ink-soft">—</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

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
