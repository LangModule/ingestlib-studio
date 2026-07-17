import type { ClassifyView, DocumentView, PageView, SectionView } from "../../api/types";
import { Markdown } from "./Markdown";

/* The four pipeline tabs. Parsed and Chunks participate in the hover
   contract: hovering content highlights its source regions on the light
   table, and hovering the light table highlights the content. */

export function ParsedTab({
  page,
  hovered,
  onHover,
}: {
  page: PageView;
  hovered: number[];
  onHover: (regionIds: number[]) => void;
}) {
  if (page.regions.length === 0) {
    return <p className="text-sm text-ink-soft">No regions were detected on this page.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {page.regions.map((region) => (
        <div
          key={region.region_id}
          onMouseEnter={() => onHover([region.region_id])}
          onMouseLeave={() => onHover([])}
          className={`rounded-lg border p-3 transition ${
            hovered.includes(region.region_id)
              ? "border-provenance bg-provenance/5"
              : "border-line bg-card"
          }`}
        >
          <span className="mb-1 block text-[10px] font-semibold tracking-wide text-ink-soft uppercase">
            {region.region_type} · {region.region_id}
          </span>
          {region.image_url && (
            <img
              src={region.image_url}
              alt={`${region.region_type} ${region.region_id}`}
              className="mb-2 max-h-64 rounded-sm border border-line bg-white"
            />
          )}
          <Markdown>{region.content || region.text}</Markdown>
        </div>
      ))}
    </div>
  );
}

export function ClassifyTab({ classify }: { classify: ClassifyView }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-card p-4">
        <span className="mono text-lg font-semibold">{classify.category}</span>
        <span className="mono ml-3 text-sm text-ink-soft">
          confidence {(classify.confidence * 100).toFixed(0)}%
        </span>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{classify.reasoning}</p>
        <p className="mt-2 text-xs text-ink-soft">{classify.pages_used} page(s) read</p>
      </div>
      {classify.alternatives.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-soft uppercase">
            Alternatives
          </h3>
          <ul className="flex flex-col gap-1">
            {classify.alternatives.map((alternative) => (
              <li key={alternative.label} className="mono flex justify-between text-sm">
                <span>{alternative.label}</span>
                <span className="text-ink-soft">{(alternative.score * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SplitTab({
  sections,
  pages,
  currentPage,
  onNavigate,
}: {
  sections: SectionView[];
  pages: PageView[];
  currentPage: number;
  onNavigate: (page: number) => void;
}) {
  const imageByPage = new Map(pages.map((page) => [page.page_num, page.image_url]));
  // Sections are contiguous page runs, so one role can appear several times
  // when its pages are interleaved with others; number the repeats.
  const nameTotals = new Map<string, number>();
  for (const section of sections) {
    nameTotals.set(section.name, (nameTotals.get(section.name) ?? 0) + 1);
  }
  const nameSeen = new Map<string, number>();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-soft">
        Split groups consecutive pages by the role they play in the document. Click a page
        to open it on the light table.
      </p>
      {sections.map((section, index) => {
        const occurrence = (nameSeen.get(section.name) ?? 0) + 1;
        nameSeen.set(section.name, occurrence);
        const repeated = (nameTotals.get(section.name) ?? 0) > 1;
        return (
        <div key={index} className="rounded-lg border border-line bg-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="mono text-sm font-semibold">
              {section.name}
              {repeated && (
                <span className="ml-1.5 text-[10px] font-normal text-ink-soft">
                  part {occurrence}
                </span>
              )}
            </span>
            <span className="text-xs text-ink-soft">
              {section.pages.length === 1
                ? `page ${section.pages[0]}`
                : `pages ${section.pages[0]}–${section.pages[section.pages.length - 1]}`}{" "}
              · {section.chunk_ids.length} chunk(s)
            </span>
          </div>
          {section.description && (
            <p className="mt-1 text-xs text-ink-soft">{section.description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {section.pages.map((pageNum) => (
              <button
                key={pageNum}
                type="button"
                onClick={() => onNavigate(pageNum)}
                className={`overflow-hidden rounded-sm border transition ${
                  pageNum === currentPage
                    ? "border-accent ring-1 ring-accent"
                    : "border-line hover:border-ink-soft"
                }`}
                title={`page ${pageNum}`}
              >
                <img src={imageByPage.get(pageNum)} alt={`page ${pageNum}`} className="h-20 w-auto" />
              </button>
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}

export function ChunksTab({
  document,
  currentPage,
  onHover,
  onNavigate,
}: {
  document: DocumentView;
  currentPage: number;
  onHover: (regionIds: number[]) => void;
  onNavigate: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-soft">
        These are the exact units the vector store receives. Hover a chunk to light up its
        source regions on the current page.
      </p>
      {document.chunks.map((chunk) => (
        <div
          key={chunk.chunk_id}
          onMouseEnter={() => onHover(chunk.region_ids[currentPage] ?? [])}
          onMouseLeave={() => onHover([])}
          className="rounded-lg border border-line bg-card p-4"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="mono truncate text-xs text-ink-soft">
              [{document.classify.category} › {chunk.section}
              {chunk.heading && ` › ${chunk.heading}`}]
            </span>
            <span className="mono shrink-0 text-xs text-ink-soft">
              {chunk.kind} · ~{chunk.token_estimate} tok ·{" "}
              {chunk.pages.map((pageNum) => (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => onNavigate(pageNum)}
                  className={pageNum === currentPage ? "text-accent" : "hover:text-ink"}
                >
                  p.{pageNum}{" "}
                </button>
              ))}
            </span>
          </div>
          <Markdown images="chip">{chunk.markdown}</Markdown>
        </div>
      ))}
    </div>
  );
}
