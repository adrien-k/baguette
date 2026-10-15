import { Bot } from 'lucide-react';
import MarkdownContent from '../MarkdownContent.jsx';
import CopyButton from './CopyButton.tsx';
import MessageTimestamp from './MessageTimestamp.tsx';
import MessageTurnModelBadge from './MessageTurnModelBadge.jsx';

type McpUserMessage = {
  content?: string;
  created_at?: string | null;
  model?: string | null;
  model_params?: unknown;
  agent_config_id?: number | null;
};

/** User message injected via Baguette MCP (`source` / `subtype` `mcp`). */
export default function McpAgentBlock({
  message,
  agentType,
}: {
  message: McpUserMessage;
  agentType?: string | null;
}) {
  const userText = message.content ?? '';

  return (
    <div className="group bg-merged/25 rounded-lg p-3 sm:p-4 border border-merged/45 ml-4 sm:ml-8">
      <div className="text-xs text-merged mb-1 font-medium flex items-center gap-2 flex-wrap">
        <Bot className="w-3.5 h-3.5 shrink-0 text-merged" aria-hidden />
        <span>Agent</span>
        <span className="text-merged/80 font-normal">via MCP</span>
        {message.created_at && (
          <MessageTimestamp createdAt={message.created_at} className="text-faint font-normal" />
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <MessageTurnModelBadge
            agentType={agentType}
            model={message.model}
            modelParams={message.model_params}
            agentConfigId={message.agent_config_id}
            className="text-faint font-normal text-xs"
          />
          {userText ? <CopyButton text={userText} /> : null}
        </span>
      </div>
      <MarkdownContent hardBreaks>{userText}</MarkdownContent>
    </div>
  );
}
