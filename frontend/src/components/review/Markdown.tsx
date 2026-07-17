import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

/* Renders library markdown: tables arrive as raw HTML (hence rehype-raw),
   figures as images pointing at studio routes. Content comes from the user's
   own documents in a local tool, so raw HTML is acceptable here. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
