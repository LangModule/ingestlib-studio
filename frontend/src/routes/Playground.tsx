import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { DocumentSummary, HitView } from "../api/types";
import { BrandArt } from "../components/BrandArt";
import { Markdown } from "../components/review/Markdown";
import { Button, Card } from "../components/setup/ui";

/* Playground: ask a question, see the cited hits, jump to the source.
   Every hit links to its document at the cited page with the source
   regions pre-lit on the light table.

   The idle screen is a partition like Try it and Ingest: the question on
   the left, the library on the right — retrieval can only answer from
   what is in the store, so "what can I ask about" is shown, not implied.
   Once a question is asked the page narrows to a reading column. */

type Phase =
  | { name: "idle" }
  | { name: "asking" }
  | { name: "answered"; question: string; hits: HitView[] }
  | { name: "failed"; error: string };

export default function Playground() {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.documentsList().then(setDocuments).catch(() => setDocuments(null));
  }, []);

  const ask = async () => {
    if (!question.trim()) return;
    setPhase({ name: "asking" });
    try {
      const result = await api.retrieve(question, 5);
      setPhase({ name: "answered", question: result.question, hits: result.hits });
    } catch (error) {
      setPhase({
        name: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const openHit = (hit: HitView, page: number) => {
    const regions = (hit.region_ids[page] ?? []).join(",");
    navigate(`/documents/${hit.doc_id}?page=${page}&regions=${regions}`);
  };

  const score = (hit: HitView) =>
    hit.rerank_score !== null
      ? `rerank ${hit.rerank_score.toFixed(2)}`
      : `score ${hit.vector_score.toFixed(2)}`;

  const askForm = (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        ask();
      }}
    >
      <input
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="What would you like to know?"
        className="flex-1 rounded-lg border border-line bg-field px-3 py-2 text-sm text-ink
                   outline-none placeholder:text-ink-soft/60 focus:border-accent
                   focus:ring-1 focus:ring-accent"
      />
      <Button type="submit" disabled={phase.name === "asking" || !question.trim()}>
        {phase.name === "asking" ? "Retrieving…" : "Ask"}
      </Button>
    </form>
  );

  const header = (
    <header className="mb-6">
      <h1 className="text-xl font-semibold">Playground</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Asks your vector store. Every hit cites its source; click a page to open the
        document right there, with the source regions lit.
      </p>
    </header>
  );

  if (phase.name === "idle") {
    return (
      <div className="w-full px-10 py-12">
        <BrandArt />
        {header}
        <div className="grid items-start gap-8 lg:grid-cols-[2fr_3fr] lg:gap-0">
          <section className="flex flex-col gap-3 lg:sticky lg:top-8 lg:pr-8">
            <h2 className="text-sm font-semibold">Question</h2>
            {askForm}
            <p className="text-xs text-ink-soft">
              Hybrid retrieval: your question is embedded, matched against every
              chunk in the vector store, and the top hits are reranked. Answers
              always cite the exact page and region they came from.
            </p>
          </section>
          <section className="flex flex-col gap-3 lg:border-l lg:border-line lg:pl-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">
                What you can ask about
                {documents && documents.length > 0 && (
                  <span className="mono ml-2 text-xs font-normal text-ink-soft">
                    {documents.length} document{documents.length === 1 ? "" : "s"}
                  </span>
                )}
              </h2>
              <Link className="text-xs text-ink-soft underline hover:text-ink" to="/">
                open the Library
              </Link>
            </div>
            <p className="text-xs text-ink-soft">
              Retrieval only sees ingested documents — these are the sources every
              answer draws from.
            </p>
            <div className="rounded-lg border border-line">
              {documents === null && (
                <p className="px-4 py-4 text-sm text-ink-soft">Loading your library…</p>
              )}
              {documents !== null && documents.length === 0 && (
                <p className="px-4 py-4 text-sm text-ink-soft">
                  Nothing ingested yet, so there is nothing to retrieve from.{" "}
                  <Link className="underline hover:text-ink" to="/ingest">
                    Ingest a document
                  </Link>{" "}
                  first.
                </p>
              )}
              {documents !== null &&
                documents.map((doc, index) => (
                  <Link
                    key={doc.doc_id}
                    to={`/documents/${doc.doc_id}`}
                    className={`flex items-center gap-4 px-4 py-3 transition hover:bg-card ${
                      index > 0 ? "border-t border-line" : ""
                    }`}
                  >
                    <div className="shrink-0 rounded border border-line bg-lighttable">
                      <img
                        src={doc.thumbnail_url}
                        alt={doc.filename}
                        loading="lazy"
                        className="h-14 w-11 object-contain p-1"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={doc.filename}>
                        {doc.filename}
                      </span>
                      <span className="mono mt-1 inline-block rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-ink-soft">
                        {doc.category || "uncategorized"}
                      </span>
                    </div>
                    <span className="mono shrink-0 text-xs text-ink-soft">
                      {doc.page_count} pages · {doc.sections} sections · {doc.chunks} chunks
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {phase.name !== "answered" && <BrandArt />}
      {header}
      <div className="mb-6">{askForm}</div>

      {phase.name === "failed" && (
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm text-fail">{phase.error}</p>
        </Card>
      )}

      {phase.name === "answered" && phase.hits.length === 0 && (
        <p className="py-12 text-center text-sm text-ink-soft">
          No hits for “{phase.question}”. Ingest more documents, or ask differently.
        </p>
      )}

      {phase.name === "answered" && phase.hits.length > 0 && (
        <ol className="flex flex-col gap-3">
          {phase.hits.map((hit, index) => (
            <li key={`${hit.doc_id}-${hit.chunk_id}`}>
              <Card className="flex flex-col gap-2 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="mono truncate text-xs text-ink-soft">
                    [{index + 1}] {hit.filename} · {hit.category} › {hit.section}
                    {hit.heading && ` › ${hit.heading}`}
                  </span>
                  <span className="mono shrink-0 text-xs text-accent">{score(hit)}</span>
                </div>
                <Markdown images="chip">{hit.markdown}</Markdown>
                <div className="flex items-center gap-2">
                  <span className="mono text-[10px] text-ink-soft">{hit.kind} · open at</span>
                  {hit.pages.map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => openHit(hit, page)}
                      className="mono rounded-md border border-line px-2 py-0.5 text-xs
                                 text-ink-soft transition hover:border-accent hover:text-accent"
                    >
                      p.{page} →
                    </button>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
