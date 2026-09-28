import { Bot } from 'lucide-react';
import MarkdownContent from '../MarkdownContent.jsx';

export function isMcpAgentMessage(message) {
  return message.source === 'mcp' || message.subtype === 'mcp';
}

export default function McpAgentBlock({ message, copyButton }) {
  const content = message.message?.content;
  const previewText = Array.isArray(content)
    ? content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n\n')
    : typeof content === 'string'
      ? content
      : '';

  return (
    <div className="group bg-merged/25 rounded-lg p-3 sm:p-4 border border-merged/45 ml-4 sm:ml-8">
      <div className="text-xs text-merged mb-1 font-medium flex items-center gap-2">
        <Bot className="w-3.5 h-3.5 shrink-0 text-merged" aria-hidden />
        <span>Agent</span>
        <span className="text-merged/80 font-normal">via MCP</span>
        {message.created_at && (
          <span className="text-faint font-normal">
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        {previewText && copyButton ? (
          <span className="ml-auto">{copyButton(previewText)}</span>
        ) : null}
      </div>
      {Array.isArray(content) ? (
        <div className="space-y-2">
          {content.map((block, i) => {
            if (block.type === 'text') {
              return (
                <MarkdownContent key={i} hardBreaks>
                  {block.text}
                </MarkdownContent>
              );
            }
            if (block.type === 'image') {
              const { media_type, data } = block.source || {};
              return (
                <img
                  key={i}
                  src={`data:${media_type};base64,${data}`}
                  alt={block.name || 'attached image'}
                  className="max-w-xs rounded border border-merged/50"
                />
              );
            }
            if (block.type === 'document') {
              return (
                <div
                  key={i}
                  className="flex items-center gap-1.5 text-xs text-fg-muted bg-merged/40 rounded px-2 py-1 w-fit"
                >
                  <span>📄</span>
                  <span>{block.name || 'document'}</span>
                </div>
              );
            }
            return null;
          })}
        </div>
      ) : (
        <MarkdownContent hardBreaks>{typeof content === 'string' ? content : ''}</MarkdownContent>
      )}
    </div>
  );
}
