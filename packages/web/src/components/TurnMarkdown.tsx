import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Agent/operator prose is markdown (headers, code, links, tables) but the
 * transcript otherwise renders everything as plain stamped text — this is the
 * one seam where that text gets parsed instead of printed verbatim. Renders to
 * React elements only (no `dangerouslySetInnerHTML`, no raw-HTML pass-through),
 * since transcript text comes from a live subprocess/model stream and the app
 * has no CSP backstop.
 */
export function TurnMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
