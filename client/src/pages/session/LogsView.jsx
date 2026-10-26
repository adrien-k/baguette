import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  User,
  Bot,
  Terminal,
  CheckCircle,
  AlertCircle,
  Wrench,
  Activity,
  ListTree,
  MessageSquare,
} from 'lucide-react';
import { useStickToBottomScroll } from '../../hooks/useStickToBottomScroll.js';
import StickToBottomScrollArea from '../../components/StickToBottomScrollArea.jsx';
import { logToolDisplayName, logToolCallSummary } from '@baguette/shared/log-tool-label.js';
import { formatTurnErrorMessage } from '@baguette/shared/format-turn-error-message.js';
import { isBaguetteUserMessage, isMcpUserMessage } from '@baguette/shared/turn-model.js';
import UserMessageContent, {
  userMessagePlainText,
} from '../../components/chat/UserMessageContent.tsx';
import AgentTypeIcon from '../../components/AgentTypeIcon.jsx';
import { agentDisplayTitle } from '../../utils/sessionAgents.js';

function formatLegacyMcpToolDisplayName(name, input) {
  return logToolDisplayName(name, input ?? {});
}

function AgentScopeBadge({ agentId, agentLabelById }) {
  if (agentId == null || !agentLabelById) return null;
  const info = agentLabelById.get(agentId);
  if (!info) return null;
  const agent = { name: info.name, agent_type: info.agent_type };
  return (
    <span className="flex items-center gap-1 min-w-0 max-w-full">
      <AgentTypeIcon agentType={info.agent_type} className="w-3 h-3" />
      <span className="text-[10px] text-fg-muted truncate max-w-[8rem]" title={info.name}>
        {agentDisplayTitle(agent)}
      </span>
    </span>
  );
}

function StatusPill({ status }) {
  if (!status) return null;
  const tone =
    status === 'running'
      ? 'bg-brand/15 text-accent border-brand/30'
      : status === 'error'
        ? 'bg-danger/15 text-danger border-danger/35'
        : status === 'completed' || status === 'ok'
          ? 'bg-success/15 text-success border-success/35'
          : 'bg-control/80 text-fg-muted border-strong/60';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${tone}`}>
      {status}
    </span>
  );
}

function getMessageIcon(msg) {
  const { type, subtype } = msg;
  if (type === 'user') {
    if (isMcpUserMessage(msg)) return <MessageSquare className="w-3.5 h-3.5 shrink-0" />;
    return <User className="w-3.5 h-3.5 shrink-0" />;
  }
  if (type === 'assistant') return <Bot className="w-3.5 h-3.5 shrink-0" />;
  if (type === 'tool_call') return <Wrench className="w-3.5 h-3.5 shrink-0" />;
  if (type === 'plan') return <ListTree className="w-3.5 h-3.5 shrink-0" />;
  if (type === 'turn_result' || type === 'result') {
    const ok =
      type === 'turn_result' ? msg.status === 'ok' : subtype === 'success' && !msg.is_error;
    return ok ? (
      <CheckCircle className="w-3.5 h-3.5 shrink-0 text-success" />
    ) : (
      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-danger" />
    );
  }
  if (type === 'system') return <Terminal className="w-3.5 h-3.5 shrink-0" />;
  if (type === 'tool_progress') return <Activity className="w-3.5 h-3.5 shrink-0" />;
  return <Wrench className="w-3.5 h-3.5 shrink-0" />;
}

function getMessageLabel(msg) {
  const { type, subtype } = msg;

  if (type === 'user') {
    if (isMcpUserMessage(msg)) return 'MCP message';
    if (isBaguetteUserMessage(msg)) return 'Baguette';
    return 'User';
  }
  if (type === 'assistant') return 'Assistant';
  if (type === 'tool_call') {
    return logToolDisplayName(msg.name, msg.args);
  }
  if (type === 'plan') return 'Plan';
  if (type === 'turn_result') {
    return msg.status === 'ok' ? 'Turn complete' : 'Turn failed';
  }
  if (type === 'result') return subtype === 'success' ? 'Result: success' : 'Result: error';
  if (type === 'system' && subtype === 'prompt') return 'System prompt';
  if (type === 'system' && subtype === 'thinking_tokens') return 'Thinking tokens';
  if (type === 'system') return subtype ? `System · ${subtype}` : 'System';
  if (type === 'tool_progress') {
    const name = msg.tool_name ? formatLegacyMcpToolDisplayName(msg.tool_name, msg.input) : null;
    return name ?? 'Tool progress';
  }
  return type;
}

function getMessageSummary(msg) {
  const { type } = msg;

  if (type === 'user') {
    const legacy = msg.message?.content;
    if (Array.isArray(legacy) && legacy.every((b) => b.type === 'tool_result')) {
      return `Tool results (${legacy.length})`;
    }
    const plain = userMessagePlainText(msg);
    if (plain) return plain.slice(0, 140);
    return '';
  }

  if (type === 'assistant') {
    if (Array.isArray(msg.blocks)) {
      const parts = [];
      const text = msg.blocks.find((b) => b.type === 'text')?.text;
      if (text) parts.push(text.slice(0, 100));
      const thinking = msg.blocks.find((b) => b.type === 'thinking')?.thinking;
      if (thinking) parts.push(`⟨thinking⟩ ${thinking.slice(0, 60)}…`);
      return parts.join(' · ');
    }
    const content = msg.message?.content;
    if (!Array.isArray(content)) return '';
    const parts = [];
    const textBlock = content.find((b) => b.type === 'text');
    if (textBlock?.text) parts.push(textBlock.text.slice(0, 80));
    const toolCalls = content
      .filter((b) => b.type === 'tool_use')
      .map((b) => formatLegacyMcpToolDisplayName(b.name, b.input));
    if (toolCalls.length) parts.push(toolCalls.join(', '));
    return parts.join(' · ');
  }

  if (type === 'tool_call') {
    return logToolCallSummary(msg).slice(0, 160);
  }

  if (type === 'plan') {
    return (msg.markdown || '').replace(/\s+/g, ' ').slice(0, 140);
  }

  if (type === 'turn_result') {
    if (msg.status === 'error' && msg.error_message) {
      const { headline, detail } = formatTurnErrorMessage(msg.error_message);
      const summary = detail ? `${headline} — ${detail}` : headline;
      return summary.slice(0, 140);
    }
    if (msg.total_cost_usd != null) return `Cost $${Number(msg.total_cost_usd).toFixed(4)}`;
    return 'OK';
  }

  if (type === 'result') {
    if (typeof msg.result === 'string') return msg.result.slice(0, 140);
    return '';
  }

  if (type === 'system' && msg.subtype === 'prompt') {
    return (msg.content || '').slice(0, 140);
  }

  if (type === 'system' && msg.subtype === 'thinking_tokens') {
    const n = msg.estimated_tokens ?? 0;
    return `~${n.toLocaleString()} tokens`;
  }

  if (type === 'system') {
    return (msg.status || msg.summary || msg.description || msg.text || '').slice(0, 140);
  }

  if (type === 'tool_progress') {
    const name = msg.tool_name ? formatLegacyMcpToolDisplayName(msg.tool_name, msg.input) : null;
    const elapsed =
      msg.elapsed_time_seconds != null ? `${Math.round(msg.elapsed_time_seconds)}s` : '';
    return [name, elapsed].filter(Boolean).join(' · ').slice(0, 140);
  }

  return '';
}

function JsonBlock({ value, maxHeight = 'max-h-48' }) {
  return (
    <pre
      className={`text-fg-muted text-[11px] overflow-auto ${maxHeight} leading-5 bg-control/40 rounded p-2 border border-strong/40`}
    >
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ToolCallDetail({ msg }) {
  const label = logToolDisplayName(msg.name, msg.args);
  const isMcp = msg.kind === 'mcp' || msg.name === 'mcp' || msg.name?.startsWith('mcp__');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-heading">{label}</span>
        {isMcp && (
          <span className="text-[10px] uppercase tracking-wide text-merged font-medium">MCP</span>
        )}
        <StatusPill status={msg.tool_status ?? msg.status} />
        {msg.call_id && (
          <span className="text-[10px] text-faint font-mono truncate max-w-[12rem]">
            id {msg.call_id}
          </span>
        )}
      </div>
      {msg.args && Object.keys(msg.args).length > 0 && (
        <div>
          <div className="text-[10px] text-faint mb-1 font-medium uppercase tracking-wide">
            Input
          </div>
          <JsonBlock value={msg.args} />
        </div>
      )}
      {msg.result != null && (
        <div>
          <div className="text-[10px] text-faint mb-1 font-medium uppercase tracking-wide">
            Result
          </div>
          <JsonBlock value={msg.result} maxHeight="max-h-60" />
        </div>
      )}
    </div>
  );
}

function MessageDetail({ msg }) {
  const { type, message, result, subtype } = msg;

  if (type === 'tool_call') {
    return <ToolCallDetail msg={msg} />;
  }

  if (type === 'assistant' && Array.isArray(msg.blocks)) {
    return (
      <div className="space-y-2">
        {msg.blocks.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div key={i} className="text-secondary text-xs whitespace-pre-wrap leading-relaxed">
                {block.text}
              </div>
            );
          }
          if (block.type === 'thinking') {
            return (
              <div
                key={i}
                className="text-faint text-xs italic leading-relaxed border-l-2 border-line pl-2"
              >
                {block.thinking}
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  if (type === 'assistant' && Array.isArray(message?.content)) {
    return (
      <div className="space-y-2">
        {message.content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div key={i} className="text-secondary text-xs whitespace-pre-wrap leading-relaxed">
                {block.text}
              </div>
            );
          }
          if (block.type === 'tool_use') {
            const label = formatLegacyMcpToolDisplayName(block.name, block.input);
            const isMcp = block.name === 'mcp' || block.name?.startsWith('mcp__');
            return (
              <div key={i} className="bg-control/60 rounded-md p-2.5 border border-strong/50">
                <div className="flex flex-wrap items-center gap-2 text-accent text-xs font-semibold mb-1.5">
                  <Wrench className="w-3 h-3 shrink-0" />
                  <span>{label}</span>
                  {isMcp && (
                    <span className="text-[10px] uppercase tracking-wide text-merged font-medium">
                      MCP
                    </span>
                  )}
                </div>
                <JsonBlock value={block.input ?? {}} />
                {block.result !== undefined && (
                  <div className="mt-2">
                    <div className="text-[10px] text-faint mb-1">Result</div>
                    <div
                      className={`text-xs font-mono leading-5 ${block.isError ? 'text-danger' : 'text-success/90'}`}
                    >
                      {String(block.result).slice(0, 800)}
                      {String(block.result).length > 800 && '…'}
                    </div>
                  </div>
                )}
              </div>
            );
          }
          if (block.type === 'thinking') {
            return (
              <div
                key={i}
                className="text-faint text-xs italic leading-relaxed border-l-2 border-line pl-2"
              >
                {block.thinking?.slice(0, 500)}
                {block.thinking?.length > 500 ? '…' : ''}
              </div>
            );
          }
          return <JsonBlock key={i} value={block} />;
        })}
      </div>
    );
  }

  if (type === 'plan') {
    return (
      <div className="text-secondary text-xs whitespace-pre-wrap leading-relaxed font-mono">
        {msg.markdown}
      </div>
    );
  }

  if (type === 'turn_result') {
    const formattedError =
      msg.status === 'error' && msg.error_message
        ? formatTurnErrorMessage(msg.error_message)
        : null;
    return (
      <div className="space-y-1">
        <StatusPill status={msg.status === 'ok' ? 'ok' : 'error'} />
        {formattedError && (
          <div className="text-danger text-xs leading-relaxed space-y-0.5">
            <div className="font-medium">{formattedError.headline}</div>
            {formattedError.detail && <div className="text-fg-muted">{formattedError.detail}</div>}
          </div>
        )}
        {msg.total_cost_usd != null && (
          <div className="text-fg-muted text-xs">
            Cost: ${Number(msg.total_cost_usd).toFixed(4)}
          </div>
        )}
      </div>
    );
  }

  if (type === 'user' && Array.isArray(message?.content)) {
    const hasToolResults = message.content.some((b) => b.type === 'tool_result');
    if (!hasToolResults) {
      return (
        <UserMessageContent
          content={msg.content}
          message={message}
          markdown={false}
          textClassName="text-secondary text-xs whitespace-pre-wrap leading-relaxed"
        />
      );
    }
    return (
      <div className="space-y-1.5">
        {message.content.map((block, i) => {
          if (block.type === 'tool_result') {
            const resultText =
              typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                      .join('\n')
                  : JSON.stringify(block.content);
            return (
              <div key={i} className="bg-control/60 rounded-md p-2 border border-strong/50">
                <div className="text-faint text-[10px] mb-1 font-mono">
                  tool_result · {block.tool_use_id}
                </div>
                <div
                  className={`text-xs leading-relaxed whitespace-pre-wrap ${block.is_error ? 'text-danger' : 'text-secondary'}`}
                >
                  {resultText.slice(0, 800)}
                  {resultText.length > 800 && '…'}
                </div>
              </div>
            );
          }
          return <JsonBlock key={i} value={block} />;
        })}
      </div>
    );
  }

  if (type === 'user') {
    return (
      <UserMessageContent
        content={msg.content}
        message={message}
        markdown={false}
        textClassName="text-secondary text-xs whitespace-pre-wrap leading-relaxed"
      />
    );
  }

  if (type === 'system' && subtype === 'prompt') {
    return (
      <div className="text-fg-muted text-xs leading-relaxed whitespace-pre-wrap font-mono">
        {msg.content}
      </div>
    );
  }

  if (type === 'result') {
    return (
      <div
        className={`text-xs leading-relaxed whitespace-pre-wrap ${subtype === 'error' ? 'text-danger' : 'text-secondary'}`}
      >
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </div>
    );
  }

  return <JsonBlock value={msg} maxHeight="max-h-72" />;
}

function LogMessage({ msg, agentLabelById }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const { type } = msg;

  const labelColor =
    type === 'system' && msg.subtype === 'prompt'
      ? 'text-faint'
      : {
          user: isMcpUserMessage(msg) ? 'text-merged' : 'text-info',
          assistant: 'text-accent',
          tool_call: 'text-warning',
          plan: 'text-accent',
          turn_result: msg.status === 'ok' ? 'text-success' : 'text-danger',
          result: msg.subtype === 'success' ? 'text-success' : 'text-danger',
          system: 'text-fg-muted',
          tool_progress: 'text-faint',
        }[type] || 'text-fg-muted';

  const summary = getMessageSummary(msg);
  const showToolStatus = type === 'tool_call' && (msg.tool_status ?? msg.status);

  return (
    <div className="border border-line rounded-lg overflow-hidden bg-inset/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-control/40 transition-colors text-left"
      >
        <span className={`${labelColor} shrink-0 mt-0.5`}>{getMessageIcon(msg)}</span>
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={`text-xs font-semibold ${labelColor}`}>{getMessageLabel(msg)}</span>
            <AgentScopeBadge agentId={msg.agent_id} agentLabelById={agentLabelById} />
            {showToolStatus && <StatusPill status={msg.tool_status ?? msg.status} />}
            {msg.parent_tool_use_id && <span className="text-faint text-[10px]">sub-agent</span>}
          </div>
          {summary && (
            <p className="text-fg-muted text-[11px] leading-snug line-clamp-2">{summary}</p>
          )}
        </div>
        <span className="text-faint text-[10px] shrink-0 tabular-nums mt-0.5">
          {msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : ''}
        </span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-faint shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-faint shrink-0 mt-0.5" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-line bg-inset/60">
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${showRaw ? 'text-accent bg-brand/10' : 'text-faint hover:text-fg-muted'}`}
            >
              {showRaw ? 'Formatted' : 'Raw JSON'}
            </button>
          </div>
          {showRaw ? <JsonBlock value={msg} maxHeight="max-h-96" /> : <MessageDetail msg={msg} />}
        </div>
      )}
    </div>
  );
}

export default function LogsView({
  rawMessages,
  loadMore,
  loadingMore,
  hasMore,
  chatOpen = true,
  resetKey,
  agentLabelById,
}) {
  const topSentinelRef = useRef(null);
  const { scrollContainerRef, prepareLoadMore } = useStickToBottomScroll({
    resetKey,
    contentLength: chatOpen ? rawMessages.length : 0,
  });

  const handleLoadMore = useCallback(() => {
    if (!chatOpen || !hasMore || loadingMore) return;
    prepareLoadMore();
    loadMore();
  }, [chatOpen, hasMore, loadMore, loadingMore, prepareLoadMore]);

  useEffect(() => {
    if (!chatOpen) return;
    const container = scrollContainerRef.current;
    if (!container || !topSentinelRef.current || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) handleLoadMore();
      },
      { root: container, threshold: 0 }
    );
    observer.observe(topSentinelRef.current);
    return () => observer.disconnect();
  }, [chatOpen, handleLoadMore, hasMore, scrollContainerRef]);

  if (!chatOpen) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        <p className="text-faint text-sm text-center">Open an agent chat to see its logs.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <StickToBottomScrollArea
        scrollRef={scrollContainerRef}
        className="relative flex-1 min-h-0 min-w-0"
        scrollClassName="absolute inset-0 overflow-auto p-3 sm:p-4"
        scrollButtonClassName="bottom-4 left-1/2 -translate-x-1/2"
      >
        <div className="space-y-2 min-h-full flex flex-col justify-end">
          <div ref={topSentinelRef} className="h-px shrink-0 order-first" />
          {loadingMore && (
            <div className="flex justify-center py-2 shrink-0">
              <div className="w-4 h-4 border-2 border-strong border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {rawMessages.length === 0 && (
            <div className="flex items-center justify-center h-32 text-faint text-sm shrink-0">
              No messages yet
            </div>
          )}
          {rawMessages.map((msg, i) => (
            <LogMessage key={msg.id ?? i} msg={msg} agentLabelById={agentLabelById} />
          ))}
        </div>
      </StickToBottomScrollArea>
    </div>
  );
}
