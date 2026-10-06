/**
 * Fallback for a Mermaid diagram that failed to render. Renders the raw source
 * as a styled code block with a small unobtrusive indicator above it, so the
 * chat still shows the diagram text without leaking a "Syntax error in text"
 * Mermaid error message into the main view.
 */
export default function MermaidFallback({ chart }) {
  return (
    <div
      className="my-2 rounded-lg border border-strong overflow-hidden"
      data-mermaid-fallback="true"
    >
      <div className="px-3 py-1 bg-control border-b border-strong text-xs text-fg-muted">
        Diagram could not be rendered — showing source
      </div>
      <pre className="bg-page text-secondary text-xs p-3 overflow-auto">
        <code>{chart}</code>
      </pre>
    </div>
  );
}
