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
} from 'lucide-react';

function getMessageIcon(type, subtype) {
  if (type === 'user') return <User className="w-3.5 h-3.5 shrink-0" />;
  if (type === 'assistant') return <Bot className="w-3.5 h-3.5 shrink-0" />;
  if (type === 'result') {
    return subtype === 'success' ? (
      <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
    ) : (
      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
    );
  }
  if (type === 'system') return <Terminal className="w-3.5 h-3.5 shrink-0" />;
  if (type === 'tool_progress') return <Activity className="w-3.5 h-3.5 shrink-0" />;
  return <Wrench className="w-3.5 h-3.5 shrink-0" />;
}

function getMessageLabel(msg) {
  const { type, subtype } = msg;
  if (type === 'user') return 'User';
  if (type === 'assistant') return 'Assistant';
  if (type === 'result') return subtype === 'success' ? 'Result: success' : 'Result: error';
  if (type === 'system' && subtype === 'prompt') return 'System prompt';
  if (type === 'system') return subtype ? `System: ${subtype}` : 'System';
  if (type === 'tool_progress') return 'Tool progress';
  return type;
}

function getMessageSummary(msg) {
  const { type, message, result, summary, description } = msg;

  if (type === 'user') {
    const content = message?.content;
    if (typeof content === 'string') return content.slice(0, 120);
    if (Array.isArray(content)) {
      const allToolResults = content.every((b) => b.type === 'tool_result');
      if (allToolResults) return `Tool results (${content.length})`;
      const textBlock = content.find((b) => b.type === 'text');
      if (textBlock) return textBlock.text.slice(0, 120);
      return `${content.length} block(s)`;
    }
    return '';
  }

  if (type === 'assistant') {
    const content = message?.content;
    if (!Array.isArray(content)) return '';
    const parts = [];
    const textBlock = content.find((b) => b.type === 'text');
    if (textBlock?.text) parts.push(textBlock.text.slice(0, 80));
    const toolCalls = content.filter((b) => b.type === 'tool_use').map((b) => b.name);
    if (toolCalls.length) parts.push(`[${toolCalls.join(', ')}]`);
    return parts.join(' ');
  }

  if (type === 'result') {
    if (typeof result === 'string') return result.slice(0, 120);
    return '';
  }

  if (type === 'system' && msg.subtype === 'prompt') {
    return (msg.content || '').slice(0, 120);
  }

  if (type === 'system') {
    return (summary || description || '').slice(0, 120);
  }

  if (type === 'tool_progress') {
    return (summary || description || '').slice(0, 120);
  }

  return '';
}

function MessageDetail({ msg }) {
  const { type, message, result, subtype } = msg;

  if (type === 'assistant' && Array.isArray(message?.content)) {
    return (
      <div className="space-y-2">
        {message.content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div
                key={i}
                className="text-zinc-300 text-xs whitespace-pre-wrap font-mono leading-5"
              >
                {block.text}
              </div>
            );
          }
          if (block.type === 'tool_use') {
            return (
              <div key={i} className="bg-zinc-800/60 rounded p-2 border border-zinc-700/50">
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium mb-1">
                  <Wrench className="w-3 h-3" />
                  {block.name}
                </div>
                <pre className="text-zinc-400 text-xs overflow-auto max-h-40 leading-5">
                  {JSON.stringify(block.input, null, 2)}
                </pre>
                {block.result !== undefined && (
                  <div
                    className={`mt-1.5 pt-1.5 border-t border-zinc-700/50 text-xs font-mono leading-5 ${block.isError ? 'text-red-400' : 'text-emerald-400/80'}`}
                  >
                    {String(block.result).slice(0, 500)}
                    {String(block.result).length > 500 && '...'}
                  </div>
                )}
              </div>
            );
          }
          if (block.type === 'thinking') {
            return (
              <div key={i} className="text-zinc-500 text-xs italic font-mono leading-5">
                &lt;thinking&gt; {block.thinking?.slice(0, 200)}
                {block.thinking?.length > 200 ? '...' : ''} &lt;/thinking&gt;
              </div>
            );
          }
          return (
            <pre key={i} className="text-zinc-400 text-xs overflow-auto max-h-40 leading-5">
              {JSON.stringify(block, null, 2)}
            </pre>
          );
        })}
      </div>
    );
  }

  if (type === 'user' && Array.isArray(message?.content)) {
    return (
      <div className="space-y-1.5">
        {message.content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div
                key={i}
                className="text-zinc-300 text-xs whitespace-pre-wrap font-mono leading-5"
              >
                {block.text}
              </div>
            );
          }
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
              <div key={i} className="bg-zinc-800/60 rounded p-2 border border-zinc-700/50">
                <div className="text-zinc-500 text-[10px] mb-1">
                  tool_result for {block.tool_use_id}
                </div>
                <div
                  className={`text-xs font-mono leading-5 ${block.is_error ? 'text-red-400' : 'text-zinc-300'}`}
                >
                  {resultText.slice(0, 500)}
                  {resultText.length > 500 && '...'}
                </div>
              </div>
            );
          }
          return (
            <pre key={i} className="text-zinc-400 text-xs overflow-auto max-h-40 leading-5">
              {JSON.stringify(block, null, 2)}
            </pre>
          );
        })}
      </div>
    );
  }

  if (type === 'user' && typeof message?.content === 'string') {
    return (
      <div className="text-zinc-300 text-xs whitespace-pre-wrap font-mono leading-5">
        {message.content}
      </div>
    );
  }

  if (type === 'system' && subtype === 'prompt') {
    return (
      <div className="text-zinc-400 text-xs font-mono leading-5 whitespace-pre-wrap">
        {msg.content}
      </div>
    );
  }

  if (type === 'result') {
    return (
      <div
        className={`text-xs font-mono leading-5 whitespace-pre-wrap ${subtype === 'error' ? 'text-red-400' : 'text-zinc-300'}`}
      >
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </div>
    );
  }

  return (
    <pre className="text-zinc-400 text-xs overflow-auto max-h-60 leading-5">
      {JSON.stringify(msg, null, 2)}
    </pre>
  );
}

function LogMessage({ msg }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const { type } = msg;

  const labelColor =
    type === 'system' && msg.subtype === 'prompt'
      ? 'text-zinc-500'
      : {
          user: 'text-sky-400',
          assistant: 'text-amber-400',
          result: msg.subtype === 'success' ? 'text-emerald-400' : 'text-red-400',
          system: 'text-zinc-400',
          tool_progress: 'text-zinc-500',
        }[type] || 'text-zinc-400';

  const summary = getMessageSummary(msg);

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/40 transition-colors text-left"
      >
        <span className={`${labelColor} shrink-0`}>{getMessageIcon(type, msg.subtype)}</span>
        <span className={`text-xs font-medium shrink-0 ${labelColor}`}>{getMessageLabel(msg)}</span>
        {msg.parent_tool_use_id && (
          <span className="text-zinc-600 text-[10px] shrink-0">↳ sub-agent</span>
        )}
        {summary && (
          <span className="text-zinc-500 text-xs truncate flex-1 min-w-0">{summary}</span>
        )}
        <span className="text-zinc-600 text-[10px] shrink-0 ml-auto">
          {msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : ''}
        </span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex justify-end mb-1.5">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${showRaw ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-600 hover:text-zinc-400'}`}
            >
              Raw
            </button>
          </div>
          {showRaw ? (
            <pre className="text-zinc-400 text-xs overflow-auto max-h-96 leading-5 whitespace-pre-wrap break-all">
              {JSON.stringify(msg, null, 2)}
            </pre>
          ) : (
            <MessageDetail msg={msg} />
          )}
        </div>
      )}
    </div>
  );
}

export default function LogsView({ rawMessages, loadMore, loadingMore }) {
  const scrollContainerRef = useRef(null);
  const topSentinelRef = useRef(null);
  const scrollAnchor = useRef(null);
  const isLoadingMoreRef = useRef(false);

  const handleLoadMore = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollAnchor.current = {
        scrollTop: scrollContainerRef.current.scrollTop,
        scrollHeight: scrollContainerRef.current.scrollHeight,
      };
    }
    isLoadingMoreRef.current = true;
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !topSentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) handleLoadMore();
      },
      { root: container, threshold: 0 }
    );
    observer.observe(topSentinelRef.current);
    return () => observer.disconnect();
  }, [handleLoadMore]);

  // Restore scroll position after loading more
  useEffect(() => {
    if (scrollAnchor.current && scrollContainerRef.current) {
      const { scrollTop, scrollHeight } = scrollAnchor.current;
      const newScrollHeight = scrollContainerRef.current.scrollHeight;
      scrollContainerRef.current.scrollTop = scrollTop + (newScrollHeight - scrollHeight);
      scrollAnchor.current = null;
    }
    isLoadingMoreRef.current = false;
  }, [rawMessages]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4 space-y-1" ref={scrollContainerRef}>
        <div ref={topSentinelRef} className="h-px" />
        {loadingMore && (
          <div className="flex justify-center py-2">
            <div className="w-4 h-4 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {rawMessages.length === 0 && (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
            No messages yet
          </div>
        )}
        {rawMessages.map((msg, i) => (
          <LogMessage key={msg.id ?? i} msg={msg} />
        ))}
      </div>
    </div>
  );
}
