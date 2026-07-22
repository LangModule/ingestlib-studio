import type { CheckResult, SetupStatus } from "../api/types";

/* The six things the pipeline depends on, shared by the header status
   popover and the Settings page. Local rows (OCR, LibreOffice) refresh
   from the polled status; cloud rows fill in when a full check runs. */

const STACK_ROWS: { key: string; label: string; needs: string }[] = [
  { key: "llm", label: "AI models", needs: "LLM and embeddings: Bedrock Nova or OpenAI GPT-5" },
  { key: "artifacts", label: "Artifact store", needs: "holds parsed pages, results, and sources" },
  { key: "vectordb", label: "Vector database", needs: "stores and searches chunk embeddings" },
  { key: "reranker", label: "Reranker", needs: "orders retrieval hits by relevance" },
  { key: "ocr", label: "OCR server", needs: "PaddleOCR-VL; required by Try it and Ingest" },
  { key: "libreoffice", label: "LibreOffice", needs: "converts DOCX and PPTX to PDF" },
];

function LocalBadge({ value }: { value: string | undefined }) {
  if (value === "ok") return <span className="text-xs font-semibold text-ok">✓ ok</span>;
  if (value === undefined) return <span className="text-xs text-ink-soft">—</span>;
  return <span className="text-xs font-semibold text-fail">✗ {value}</span>;
}

export function StackChecklist({
  status,
  health,
}: {
  status: SetupStatus;
  health: Record<string, CheckResult> | null;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {STACK_ROWS.map((row) => {
        const result = health?.[row.key];
        const isLocal = row.key === "ocr" || row.key === "libreoffice";
        return (
          <li key={row.key} className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-xs font-medium">{row.label}</span>
              <span className="block text-xs text-ink-soft">{row.needs}</span>
            </span>
            <span className="max-w-[14rem] text-right">
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
  );
}
