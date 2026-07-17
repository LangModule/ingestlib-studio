import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { DocumentSummary } from "../api/types";
import { BrandArt } from "../components/BrandArt";
import { Card } from "../components/setup/ui";

/* The library: every document committed to the stack, read from the S3
   artifact registry. A card opens the stored document in the review shell. */

export default function Library() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api
      .documentsList()
      .then(setDocuments)
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  }, []);

  const visible = useMemo(() => {
    if (!documents) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter(
      (doc) =>
        doc.filename.toLowerCase().includes(needle) ||
        doc.category.toLowerCase().includes(needle),
    );
  }, [documents, filter]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm text-fail">{error}</p>
        </Card>
      </div>
    );
  }

  if (documents === null) {
    return (
      <p className="mono px-6 py-16 text-center text-sm text-ink-soft">
        reading the registry…
      </p>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-24">
        <BrandArt />
        <div className="mx-auto max-w-md text-center">
          <p className="text-2xl text-amber/70" aria-hidden>✦</p>
          <h1 className="mt-3 text-lg font-semibold">No documents yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Try it runs the pipeline on a file without storing anything, and Ingest
            commits the result to your stack. Everything you ingest appears here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">
          Library <span className="mono ml-1 text-sm text-ink-soft">{documents.length}</span>
        </h1>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name or category"
          className="w-64 rounded-lg border border-line bg-field px-3 py-2 text-sm text-ink
                     outline-none placeholder:text-ink-soft/60 focus:border-accent
                     focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {visible.map((doc) => (
          <Link
            key={doc.doc_id}
            to={`/documents/${doc.doc_id}`}
            className="overflow-hidden rounded-lg border border-line bg-card transition
                       hover:border-ink-soft"
          >
            <div className="bg-lighttable">
              <img
                src={doc.thumbnail_url}
                alt={doc.filename}
                loading="lazy"
                className="h-40 w-full object-contain p-2"
              />
            </div>
            <div className="flex flex-col gap-1.5 p-3">
              <span className="truncate text-sm font-medium" title={doc.filename}>
                {doc.filename}
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="mono truncate rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-ink-soft">
                  {doc.category || "uncategorized"}
                </span>
                <span className="mono shrink-0 text-[10px] text-ink-soft">
                  {doc.page_count} p · {doc.chunks} ch
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="py-16 text-center text-sm text-ink-soft">
          No documents match “{filter}”.
        </p>
      )}
    </div>
  );
}
