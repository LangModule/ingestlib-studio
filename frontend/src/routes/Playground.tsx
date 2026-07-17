import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { HitView } from "../api/types";
import { BrandArt } from "../components/BrandArt";
import { Markdown } from "../components/review/Markdown";
import { Button, Card } from "../components/setup/ui";

/* Playground: ask a question, see the cited hits, jump to the source.
   Every hit links to its document at the cited page with the source
   regions pre-lit on the light table. */

type Phase =
  | { name: "idle" }
  | { name: "asking" }
  | { name: "answered"; question: string; hits: HitView[] }
  | { name: "failed"; error: string };

export default function Playground() {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const navigate = useNavigate();

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

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {phase.name !== "answered" && <BrandArt />}
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Playground</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Asks your vector store. Every hit cites its source; click a page to open the
          document right there, with the source regions lit.
        </p>
      </header>

      <form
        className="mb-6 flex gap-2"
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
