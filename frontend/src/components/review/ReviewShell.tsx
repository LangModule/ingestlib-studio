import { useState } from "react";
import type { DocumentView } from "../../api/types";
import { LightTable } from "./LightTable";
import { ChunksTab, ClassifyTab, ParsedTab, SplitTab } from "./tabs";

/* The split-pane document viewer: light table left, pipeline tabs right.
   Built for Try it and reused by Library and Playground. The tabs mirror the
   pipeline stages exactly: Parsed, Classify, Split (the section map), and
   Chunks (the vector-store units). */

const TABS = ["Parsed", "Classify", "Split", "Chunks"] as const;
type Tab = (typeof TABS)[number];

export function ReviewShell({
  document: doc, // aliased so the DOM global is never shadowed
  footer,
}: {
  document: DocumentView;
  footer?: React.ReactNode;
}) {
  const [pageNum, setPageNum] = useState(doc.pages[0]?.page_num ?? 1);
  const [hovered, setHovered] = useState<number[]>([]);
  const [tab, setTab] = useState<Tab>("Parsed");

  const page = doc.pages.find((candidate) => candidate.page_num === pageNum) ?? doc.pages[0];
  const pageIndex = doc.pages.indexOf(page);

  const navigate = (target: number) => {
    setHovered([]);
    setPageNum(target);
  };

  return (
    <div className="grid grid-cols-2 items-start gap-6">
      <div className="sticky top-6 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="mono truncate text-sm text-ink-soft">{doc.filename}</span>
          <span className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => navigate(doc.pages[pageIndex - 1].page_num)}
              disabled={pageIndex <= 0}
              className="rounded-md border border-line px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-30"
            >
              ‹
            </button>
            <span className="mono text-xs text-ink-soft">
              {page.page_num} / {doc.page_count}
            </span>
            <button
              type="button"
              onClick={() => navigate(doc.pages[pageIndex + 1].page_num)}
              disabled={pageIndex >= doc.pages.length - 1}
              className="rounded-md border border-line px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-30"
            >
              ›
            </button>
          </span>
        </div>
        <LightTable page={page} hovered={hovered} onHover={setHovered} />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <nav className="flex gap-1 rounded-lg border border-line bg-card p-1">
          {TABS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setTab(candidate)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                tab === candidate
                  ? "bg-accent font-medium text-accent-ink"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {candidate}
            </button>
          ))}
        </nav>

        <div className="max-h-[75vh] overflow-y-auto pr-1">
          {tab === "Parsed" && <ParsedTab page={page} hovered={hovered} onHover={setHovered} />}
          {tab === "Classify" && <ClassifyTab classify={doc.classify} />}
          {tab === "Split" && (
            <SplitTab
              sections={doc.sections}
              pages={doc.pages}
              currentPage={page.page_num}
              onNavigate={navigate}
            />
          )}
          {tab === "Chunks" && (
            <ChunksTab
              document={doc}
              currentPage={page.page_num}
              onHover={setHovered}
              onNavigate={navigate}
            />
          )}
        </div>

        {footer}
      </div>
    </div>
  );
}
