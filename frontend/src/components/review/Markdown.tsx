import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

/* Renders library markdown: tables arrive as raw HTML (hence rehype-raw),
   figures as images pointing at studio routes. Content comes from the user's
   own documents in a local tool, so raw HTML is acceptable here.

   images="chip" replaces pictures with a compact reference chip. The Chunks
   tab uses it: the image reference line is part of the embedded text, but
   the vector store never sees pixels, and rendering them there would
   overstate what is stored. */
export function Markdown({
  children,
  images = "full",
}: {
  children: string;
  images?: "full" | "chip";
}) {
  return (
    <div className="markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={
          images === "chip"
            ? {
                img: ({ alt }) => (
                  <span className="mono inline-block rounded-sm border border-line bg-field px-1.5 py-0.5 text-[10px] text-ink-soft">
                    figure · {alt || "image"}
                  </span>
                ),
              }
            : undefined
        }
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
