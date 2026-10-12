import { Bot } from 'lucide-react';
import MarkdownContent from '../MarkdownContent.jsx';
import CopyButton from './CopyButton.tsx';
import MessageTimestamp from './MessageTimestamp.tsx';

type McpUserMessage = {
  content?: string;
  created_at?: string | null;
};

/** User message injected via Baguette MCP (`source` / `subtype` `mcp`). */
export default function McpAgentBlock({ message }: { message: McpUserMessage }) {
  const userText = message.content ?? '';

  return (
    <div className="group bg-merged/25 rounded-lg p-3 sm:p-4 border border-merged/45 ml-4 sm:ml-8">
      <div className="text-xs text-merged mb-1 font-medium flex items-center gap-2">
        <Bot className="w-3.5 h-3.5 shrink-0 text-merged" aria-hidden />
        <span>Agent</span>
        <span className="text-merged/80 font-normal">via MCP</span>
        {message.created_at && (
          <MessageTimestamp createdAt={message.created_at} className="text-faint font-normal" />
        )}
        {userText ? (
          <span className="ml-auto">
            <CopyButton text={userText} />
          </span>
        ) : null}
      </div>
      <MarkdownContent hardBreaks>{userText}</MarkdownContent>
    </div>
  );
}
