import type { ChatMessageView, TypedMessageView } from '@baguette/shared/session-messages.ts';
import MarkdownContent from './MarkdownContent.jsx';
import CollapsibleMarkdown from './chat/CollapsibleMarkdown.tsx';
import ThinkingBlock from './chat/ThinkingBlock.tsx';
import ToolCallBlock from './chat/ToolCallBlock.tsx';
import BaguetteBlock from './chat/BaguetteBlock.tsx';
import PlanReviewBlock from './chat/PlanReviewBlock.tsx';
import CopyButton from './chat/CopyButton.tsx';
import { isHumanUserMessage, isMcpUserMessage } from '@baguette/shared/turn-model.js';
import McpAgentBlock from './chat/McpAgentBlock.tsx';
import { messageModelLabel } from '../utils/messageModelLabel.js';

export type ChatMessageProps = {
  message: ChatMessageView;
  isLatestMessage?: boolean;
  worktreePath?: string | null;
  sessionId?: number | null;
  agentName?: string;
  messageIndex: number | null;
  allMessages: ChatMessageView[] | null;
  models?: { id?: string; label?: string; name?: string }[];
  session?: { model?: string | null; model_params?: unknown } | null;
  pinnedRunningBashIds?: Set<string>;
};

function TypedUserMessage({
  message,
  models,
  session,
}: {
  message: TypedMessageView & { type: 'user' };
  models: ChatMessageProps['models'];
  session: ChatMessageProps['session'];
}) {
  const isBaguette = message.source === 'baguette' || message.subtype === 'baguette';
  if (isBaguette) {
    return <BaguetteBlock message={message} models={models} session={session} />;
  }

  if (isMcpUserMessage(message)) {
    return <McpAgentBlock message={message} />;
  }

  const turnModelLabel = isHumanUserMessage(message)
    ? messageModelLabel({
        model: message.model,
        modelParams: message.model_params,
        models,
      })
    : null;
  const userText = message.content ?? '';
  return (
    <div className="group bg-control rounded-lg p-3 sm:p-4 border border-strong ml-4 sm:ml-8">
      <div className="text-xs text-success mb-1 font-medium flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">You</span>
          {message.created_at && (
            <span className="text-faint font-normal shrink-0">
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {turnModelLabel && (
            <span className="text-faint font-normal truncate max-w-[12rem] sm:max-w-xs text-right">
              {turnModelLabel}
            </span>
          )}
          {userText && <CopyButton text={userText} />}
        </div>
      </div>
      <MarkdownContent hardBreaks>{userText}</MarkdownContent>
    </div>
  );
}

function SystemMessage({ message }: { message: TypedMessageView & { type: 'system' } }) {
  if (message.subtype === 'prompt') return null;

  if (message.subtype === 'thinking_tokens') {
    const tokens = message.estimated_tokens ?? 0;
    return (
      <div className="text-xs text-faint text-center py-1">
        Thinking… ~{tokens.toLocaleString()} tokens
      </div>
    );
  }

  if (message.subtype === 'task') {
    return (
      <div className="text-xs text-faint text-center py-1">
        {message.task_status ? (
          <span className="text-faint mr-1">[{message.task_status}]</span>
        ) : null}
        {message.text}
      </div>
    );
  }

  if (message.subtype === 'request') {
    return (
      <div className="text-xs text-accent/80 text-center py-1">
        Agent is awaiting your input or approval
      </div>
    );
  }

  if (message.subtype === 'init') {
    return <div className="text-xs text-faint text-center py-1">Session started</div>;
  }

  if (message.subtype === 'status' && message.status) {
    return <div className="text-xs text-faint text-center py-1">{message.status}</div>;
  }

  const label =
    message.summary ||
    message.description ||
    message.text ||
    message.status ||
    message.subtype ||
    '';
  return <div className="text-xs text-faint text-center py-1">{label}</div>;
}

function TypedMessage({
  message,
  isLatestMessage,
  worktreePath,
  sessionId,
  agentName = 'Claude',
  models,
  session,
  pinnedRunningBashIds,
  userReplied,
}: Omit<ChatMessageProps, 'message'> & { message: TypedMessageView; userReplied: boolean }) {
  switch (message.type) {
    case 'plan':
      return (
        <PlanReviewBlock
          markdown={message.markdown}
          sessionId={sessionId}
          userReplied={userReplied}
        />
      );

    case 'tool_call': {
      const call = message as TypedMessageView & { call_id?: string | null };
      if (pinnedRunningBashIds?.has(call.call_id ?? `tool-${message.id}`)) return null;
      return (
        <ToolCallBlock
          message={message}
          worktreePath={worktreePath}
          sessionId={sessionId ?? undefined}
          userReplied={userReplied}
        />
      );
    }

    case 'assistant':
      return (
        <div className="space-y-2">
          {message.blocks.map((block, i) => {
            if (block.type === 'text') {
              return (
                <div key={i} className="group bg-nav rounded-lg p-3 sm:p-4 border border-line">
                  <div className="text-xs text-info mb-1 font-medium flex items-center justify-between">
                    <span>{agentName}</span>
                    <CopyButton text={block.text} />
                  </div>
                  <CollapsibleMarkdown>{block.text}</CollapsibleMarkdown>
                </div>
              );
            }
            if (block.type === 'thinking') {
              return <ThinkingBlock key={i} block={block} isLatestMessage={isLatestMessage} />;
            }
            return null;
          })}
        </div>
      );

    case 'user':
      return <TypedUserMessage message={message} models={models} session={session} />;

    case 'turn_result': {
      const isError = message.status === 'error';
      return (
        <>
          <div
            className={`text-center text-xs opacity-70 ${isError ? 'text-danger' : 'text-success'}`}
          >
            <span className="font-medium">{isError ? 'Error' : 'Completed'}</span>
            {message.total_cost_usd != null && (
              <span className="ml-2 text-faint">(${message.total_cost_usd.toFixed(4)})</span>
            )}
          </div>
          {isError && message.error_message && (
            <div className="mt-1 text-fg-muted text-xs">
              <MarkdownContent>{message.error_message}</MarkdownContent>
            </div>
          )}
        </>
      );
    }

    case 'system':
      return <SystemMessage message={message} />;

    default:
      return null;
  }
}

export default function ChatMessage(props: ChatMessageProps) {
  const { message, messageIndex, allMessages } = props;

  if (message.type === 'tool_result_carrier') {
    return null;
  }

  const userReplied = (() => {
    if (!allMessages || messageIndex == null) return false;
    return allMessages
      .slice(messageIndex + 1)
      .some((m) => isHumanUserMessage(m) && (m as { source?: string }).source !== 'baguette');
  })();

  return (
    <TypedMessage {...props} message={message as TypedMessageView} userReplied={userReplied} />
  );
}
