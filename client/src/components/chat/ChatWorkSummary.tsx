import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { groupChatDisplayMessages } from '@baguette/shared/chat-display-groups.js';
import { formatTaskDuration } from '../../utils/dates.js';
import ChatMessage from '../ChatMessage.tsx';
import type { ChatMessageView } from '@baguette/shared/session-messages.ts';

type SessionAgent = {
  id: number;
  ref?: number;
  name?: string;
  agent_type?: string;
  status?: string;
};

type SessionTask = {
  id: number;
  label?: string | null;
  task_key?: string | null;
  status?: string;
  command?: string;
};

export default function ChatWorkSummary({
  messages,
  indices,
  callCount,
  durationMs,
  displayMessages,
  sessionPath,
  sessionId,
  agentName,
  pinnedRunningBashIds,
  agents,
  onSelectAgent,
  tasks,
  onSelectTask,
}: {
  messages: ChatMessageView[];
  indices: number[];
  callCount: number;
  durationMs?: number | null;
  displayMessages: ChatMessageView[];
  sessionPath?: string | null;
  sessionId?: number | null;
  agentName?: string;
  pinnedRunningBashIds?: Set<string>;
  agents?: SessionAgent[];
  onSelectAgent?: (agent: SessionAgent) => void;
  tasks?: SessionTask[];
  onSelectTask?: (taskId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatTaskDuration(durationMs);
  const callsLabel = callCount === 1 ? '1 call' : `${callCount} calls`;
  const innerItems = useMemo(() => groupChatDisplayMessages(messages), [messages]);

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
          {innerItems.map((item) => {
            if (item.kind === 'work') {
              const nestedIndices = item.indices.map((k) => indices[k]);
              return (
                <ChatWorkSummary
                  key={`work-${nestedIndices[0]}`}
                  messages={item.messages}
                  indices={nestedIndices}
                  callCount={item.callCount}
                  durationMs={item.durationMs}
                  displayMessages={displayMessages}
                  sessionPath={sessionPath}
                  sessionId={sessionId}
                  agentName={agentName}
                  pinnedRunningBashIds={pinnedRunningBashIds}
                  agents={agents}
                  onSelectAgent={onSelectAgent}
                  tasks={tasks}
                  onSelectTask={onSelectTask}
                />
              );
            }
            const index = indices[item.index];
            return (
              <ChatMessage
                key={index}
                message={item.message}
                isLatestMessage={index === displayMessages.length - 1}
                sessionPath={sessionPath}
                sessionId={sessionId}
                agentName={agentName}
                messageIndex={index}
                allMessages={displayMessages}
                pinnedRunningBashIds={pinnedRunningBashIds}
                agents={agents}
                onSelectAgent={onSelectAgent}
                tasks={tasks}
                onSelectTask={onSelectTask}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
