import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidChart from './MermaidChart.jsx';

const markdownClasses = `
  text-zinc-200 text-sm leading-relaxed
  [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:first:mt-0
  [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2
  [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
  [&_p]:my-2 [&_p]:first:mt-0 [&_p]:last:mb-0
  [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2
  [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2
  [&_li]:my-0.5
  [&_code]:bg-zinc-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-indigo-200 [&_code]:text-xs [&_code]:font-mono
  [&_pre]:bg-zinc-800 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-auto [&_pre]:my-2 [&_pre]:border [&_pre]:border-zinc-700
  [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-zinc-300
  [&_a]:text-indigo-400 [&_a]:underline [&_a]:hover:text-indigo-300
  [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-4 [&_blockquote]:my-2 [&_blockquote]:text-zinc-400
  [&_table]:w-full [&_table]:my-2 [&_table]:border-collapse
  [&_th]:border [&_th]:border-zinc-700 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:bg-zinc-800 [&_th]:font-medium
  [&_td]:border [&_td]:border-zinc-700 [&_td]:px-3 [&_td]:py-2
  [&_hr]:border-zinc-700 [&_hr]:my-3
`;

const components = {
  code({ className, children }) {
    const language = /language-(\w+)/.exec(className || '')?.[1];
    if (language === 'mermaid') {
      return <MermaidChart chart={String(children).trim()} />;
    }
    return <code className={className}>{children}</code>;
  },
};

export default function MarkdownContent({ children, className = '' }) {
  return (
    <div className={`markdown-content ${markdownClasses} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
