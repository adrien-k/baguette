import { useEffect, useMemo, useRef, useState } from 'react';
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

function WorkingDots() {
  return (
    <span className="inline-flex items-end gap-px pb-px ml-px" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block w-[3px] h-[3px] rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${i * 160}ms`, animationDuration: '0.9s' }}
        />
      ))}
    </span>
  );
}

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
  inProgress = false,
  awaitingApproval = false,
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
  /** Turn still in progress (agent running on this work block). */
  inProgress?: boolean;
  /** Agent waiting on user input; keep expanded when the turn has stopped. */
  awaitingApproval?: boolean;
}) {
  const autoExpanded = inProgress || awaitingApproval;
  const [userOverride, setUserOverride] = useState<'collapsed' | 'expanded' | null>(null);
  const prevActiveRef = useRef(autoExpanded);
  const expanded =
    userOverride === 'expanded' ? true : userOverride === 'collapsed' ? false : autoExpanded;

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    if (wasActive && !autoExpanded) {
      setUserOverride(null);
    }
    prevActiveRef.current = autoExpanded;
  }, [autoExpanded]);

  const duration = formatTaskDuration(durationMs);
  const callsLabel = callCount === 1 ? '1 call' : `${callCount} calls`;
  const innerItems = useMemo(
    () => groupChatDisplayMessages(messages, { foldMidTurnAssistants: false }),
    [messages]
  );

  const toggleExpanded = () => {
    setUserOverride(expanded ? 'collapsed' : 'expanded');
  };

  let doneLabel = 'Worked';
  if (duration) doneLabel += ` for ${duration}`;
  if (callCount > 0) doneLabel += ` · ${callsLabel}`;

  const headerLabel = inProgress ? (
    <span className="inline-flex items-baseline gap-0.5">
      Working
      <WorkingDots />
    </span>
  ) : (
    doneLabel
  );

  return (
    <div className="rounded-lg border border-line/80 bg-inset/40">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-faint hover:text-fg-muted transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden />
        )}
        <span>{headerLabel}</span>
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
                  inProgress={inProgress}
                  awaitingApproval={awaitingApproval}
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
