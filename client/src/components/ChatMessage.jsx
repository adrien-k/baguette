import { useState, useCallback, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import MarkdownContent from './MarkdownContent.jsx';
import ThinkingBlock from './chat/ThinkingBlock.jsx';
import BaguetteBlock from './chat/BaguetteBlock.jsx';
import ToolUseBlock from './chat/ToolUseBlock.jsx';

/**
 * A `user` message Baguette wrote on the session's behalf. `source` rides in the message payload;
 * `subtype` is the DB column, and covers rows written before `source` was set.
 */
function isBaguetteMessage(message) {
  return message.source === 'baguette' || message.subtype === 'baguette';
}

/**
 * True for a message the user actually typed. Mirrors `isHumanUserMessage` on the server: the
 * stream also carries `user` messages that are tool results (notably the synthetic deny that
 * answers ExitPlanMode / AskUserQuestion), plus messages Baguette injects on the user's behalf.
 * Neither is the user replying.
 */
function isHumanReply(message) {
  if (message.type !== 'user' || isBaguetteMessage(message)) return false;
  const content = message.message?.content;
  if (Array.isArray(content)) return !content.some((b) => b.type === 'tool_result');
  return true;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

export default function ChatMessage({
  message,
  isLatestMessage,
  worktreePath,
  sessionId,
  agentName = 'Claude',
  messageIndex,
  allMessages,
}) {
  // True once the user sends a real message after this assistant turn — used to hide action
  // buttons on ExitPlanMode / AskUserQuestion blocks once the user has interacted.
  const userReplied = useMemo(() => {
    if (!allMessages || messageIndex == null) return false;
    return allMessages.slice(messageIndex + 1).some(isHumanReply);
  }, [allMessages, messageIndex]);

  if (message.type === 'assistant' && message.message?.content) {
    return (
      <div className="space-y-2">
        {message.message.content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div
                key={i}
                className="group bg-zinc-900 rounded-lg p-3 sm:p-4 border border-zinc-800"
              >
                <div className="text-xs text-indigo-400 mb-1 font-medium flex items-center justify-between">
                  <span>{agentName}</span>
                  <CopyButton text={block.text} />
                </div>
                <MarkdownContent>{block.text}</MarkdownContent>
              </div>
            );
          }
          if (block.type === 'tool_use') {
            if (block._hidden) return null;
            return (
              <ToolUseBlock
                key={i}
                block={block}
                worktreePath={worktreePath}
                sessionId={sessionId}
                userReplied={userReplied}
              />
            );
          }
          if (block.type === 'thinking') {
            return <ThinkingBlock key={i} block={block} isLatestMessage={isLatestMessage} />;
          }
          return null;
        })}
      </div>
    );
  }

  if (message.type === 'user' && isBaguetteMessage(message)) {
    return <BaguetteBlock message={message} />;
  }

  if (message.type === 'user') {
    const content = message.message?.content;
    const userText = Array.isArray(content)
      ? content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n\n')
      : typeof content === 'string'
        ? content
        : '';
    return (
      <div className="group bg-zinc-800 rounded-lg p-3 sm:p-4 border border-zinc-700 ml-4 sm:ml-8">
        <div className="text-xs text-emerald-400 mb-1 font-medium flex items-center gap-2">
          <span>You</span>
          {message.created_at && (
            <span className="text-zinc-500 font-normal">
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {userText && (
            <span className="ml-auto">
              <CopyButton text={userText} />
            </span>
          )}
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
                    className="max-w-xs rounded border border-zinc-700"
                  />
                );
              }
              if (block.type === 'document') {
                return (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-700/50 rounded px-2 py-1 w-fit"
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

  if (message.type === 'result') {
    const isError = message.is_error || message.subtype === 'error';
    return (
      <>
        <div
          className={`text-center text-xs opacity-70 ${
            isError ? 'text-red-300' : 'text-emerald-300'
          }`}
        >
          <span className="font-medium">{isError ? 'Error' : 'Completed'}</span>
          {message.total_cost_usd != null && (
            <span className="ml-2 text-zinc-500">(${message.total_cost_usd.toFixed(4)})</span>
          )}
        </div>
        {message.result && isError && (
          <div className="mt-1 text-zinc-400 text-xs">
            <MarkdownContent>{message.result}</MarkdownContent>
          </div>
        )}
      </>
    );
  }

  if (message.type === 'system') {
    if (message.subtype === 'task') {
      return (
        <div className="text-xs text-zinc-500 text-center py-1">
          {message.task_status ? (
            <span className="text-zinc-600 mr-1">[{message.task_status}]</span>
          ) : null}
          {message.text}
        </div>
      );
    }
    if (message.subtype === 'request') {
      return (
        <div className="text-xs text-amber-500/80 text-center py-1">
          Agent is awaiting your input or approval
        </div>
      );
    }
    let label;
    if (message.subtype === 'init') label = 'Session started';
    else if (message.subtype === 'thinking_tokens')
      label = `Thinking… ~${(message.estimated_tokens || 0).toLocaleString()} tokens`;
    else if (message.subtype === 'status' && message.status) label = message.status;
    else label = message.subtype;
    return <div className="text-xs text-zinc-600 text-center py-1">{label}</div>;
  }

  return null;
}
