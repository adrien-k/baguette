import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatTaskDuration } from '../../utils/dates.js';
import ChatMessage from '../ChatMessage.jsx';

export default function ChatWorkSummary({
  messages,
  indices,
  callCount,
  durationMs,
  displayMessages,
  worktreePath,
  sessionId,
  agentName,
  models,
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatTaskDuration(durationMs);
  const callsLabel = callCount === 1 ? '1 call' : `${callCount} calls`;

  let label = 'Worked';
  if (duration) label += ` for ${duration}`;
  if (callCount > 0) label += ` · ${callsLabel}`;

  return (
    <div className="rounded-lg border border-line/80 bg-inset/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-faint hover:text-fg-muted transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden />
        )}
        <span>{label}</span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-line/80 px-2 py-2">
          {messages.map((msg, i) => {
            const index = indices[i];
            return (
              <ChatMessage
                key={indices[i]}
                message={msg}
                isLatestMessage={index === displayMessages.length - 1}
                worktreePath={worktreePath}
                sessionId={sessionId}
                agentName={agentName}
                messageIndex={index}
                allMessages={displayMessages}
                models={models}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
