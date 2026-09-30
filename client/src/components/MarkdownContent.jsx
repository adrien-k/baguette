import { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MermaidChart = lazy(() => import('./MermaidChart.jsx'));

const markdownClasses = `
  text-heading text-sm leading-relaxed
  [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:first:mt-0
  [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2
  [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
  [&_p]:my-2 [&_p]:first:mt-0 [&_p]:last:mb-0
  [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2
  [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2
  [&_li]:my-0.5
  [&_code]:bg-control [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-info [&_code]:text-xs [&_code]:font-mono
  [&_pre]:bg-control [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-auto [&_pre]:my-2 [&_pre]:border [&_pre]:border-strong
  [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-secondary
  [&_a]:text-info [&_a]:underline [&_a]:hover:text-info
  [&_blockquote]:border-l-4 [&_blockquote]:border-strong [&_blockquote]:pl-4 [&_blockquote]:my-2 [&_blockquote]:text-fg-muted
  [&_table]:w-full [&_table]:my-2 [&_table]:border-collapse
  [&_th]:border [&_th]:border-strong [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:bg-control [&_th]:font-medium
  [&_td]:border [&_td]:border-strong [&_td]:px-3 [&_td]:py-2
  [&_hr]:border-strong [&_hr]:my-3
`;

/** Single newlines become markdown hard breaks; blank lines stay paragraph breaks. */
function withHardLineBreaks(text) {
  if (!text) return text;
  return text
    .split(/\n{2,}/)
    .map((para) => para.replace(/\n/g, '  \n'))
    .join('\n\n');
}

const components = {
  code({ className, children }) {
    const language = /language-(\w+)/.exec(className || '')?.[1];
    if (language === 'mermaid') {
      const chart = String(children).trim();
      return (
        <Suspense
          fallback={
            <pre className="bg-control border border-strong text-fg-muted text-xs p-3 rounded-lg my-2">
              Loading diagram…
            </pre>
          }
        >
          <MermaidChart chart={chart} />
        </Suspense>
      );
    }
    return <code className={className}>{children}</code>;
  },
};

export default function MarkdownContent({ children, className = '', hardBreaks = false }) {
  const source =
    hardBreaks && typeof children === 'string' ? withHardLineBreaks(children) : children;
  return (
    <div className={`markdown-content ${markdownClasses} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
