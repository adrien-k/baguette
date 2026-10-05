import { useEffect, useMemo, useState } from 'react';
import { useStickToBottomScroll } from '../../hooks/useStickToBottomScroll.js';
import { ChevronDown, ChevronRight, Loader2, Square } from 'lucide-react';
import { sessionReviewService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { useGetReviewMessages } from '../../hooks/useGetReviewMessages.js';
import { COMPOSER_STOP_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import ChatMessagesViewport from '../../components/ChatMessagesViewport.jsx';
import ChatMessage from '../../components/ChatMessage.jsx';
import ChatWorkSummary from '../../components/chat/ChatWorkSummary.jsx';
import { groupChatDisplayMessages } from '@baguette/shared/chat-display-groups.js';
import {
  collectRunningBashToolsForDock,
  runningBashToolIds,
} from '@baguette/shared/running-tools.js';
import ChatRunningBashDock from '../../components/chat/ChatRunningBashDock.jsx';
import { parseMessageRow } from '@baguette/shared/parse-message-row.js';

function SystemPromptEntry({ content }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-control/40 transition-colors text-left"
      >
        <span className="text-xs font-medium text-faint">Review system prompt</span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-faint shrink-0 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-faint shrink-0 ml-auto" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-line bg-inset/50">
          <pre className="text-faint text-xs font-mono leading-5 whitespace-pre-wrap overflow-auto max-h-72">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Reviewer chat for the session side panel (read-only stream; controls live on Issues tab). */
export default function ReviewAgentPanel({ session, readonly, sidePanelOpen = false }) {
  const {
    messages: hookMessages,
    loading: messagesLoading,
    loadMore,
    loadingMore,
    hasMore,
  } = useGetReviewMessages(session?.id);
  const [stopping, setStopping] = useState(false);
  const isXlUp = useMediaQuery('(min-width: 1280px)');
  const panelRevealed = isXlUp || sidePanelOpen;

  const rawMessages = useMemo(() => (hookMessages || []).map(parseMessageRow), [hookMessages]);
  const displayMessages = rawMessages;
  const chatDisplayItems = useMemo(
    () => groupChatDisplayMessages(displayMessages),
    [displayMessages]
  );
  const { scrollContainerRef, prepareLoadMore } = useStickToBottomScroll({
    resetKey: panelRevealed ? session?.id : null,
    contentLength: chatDisplayItems.length,
    loading: messagesLoading,
  });
  const isRunning = session?.review_status === 'running';
  const runningBashDock = collectRunningBashToolsForDock(displayMessages, chatDisplayItems, {
    worktreePath: session?.absolute_worktree_path,
    sessionTurnActive: isRunning,
  });
  const pinnedRunningBashIds = runningBashToolIds(runningBashDock);
  const systemPrompt = useMemo(
    () => rawMessages.find((m) => m.type === 'system' && m.subtype === 'prompt')?.content,
    [rawMessages]
  );
  const initialInstructions = useMemo(() => {
    const text = session?.review_initial_prompt?.trim();
    return text || null;
  }, [session?.review_initial_prompt]);

  const handleStop = async () => {
    if (!session?.id || stopping) return;
    setStopping(true);
    try {
      await sessionReviewService.stop({ session_id: session.id });
    } catch (err) {
      toastError('Failed to stop review', err);
    } finally {
      setStopping(false);
    }
  };

  const handleLoadMore = () => {
    if (!hasMore || loadingMore) return;
    prepareLoadMore();
    loadMore();
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      {initialInstructions && (
        <div className="shrink-0 border-b border-line bg-inset/30 px-3 py-2">
          <p className="text-[11px] font-medium text-faint uppercase tracking-wide mb-1">
            Reviewer initial instructions
          </p>
          <div className="max-h-28 overflow-y-auto text-xs text-secondary whitespace-pre-wrap leading-relaxed">
            {initialInstructions}
          </div>
        </div>
      )}
      <ChatMessagesViewport scrollRef={scrollContainerRef}>
        {messagesLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-faint" />
          </div>
        ) : (
          <>
            {hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-xs text-faint hover:text-secondary"
              >
                {loadingMore ? 'Loading…' : 'Load older'}
              </button>
            )}
            {systemPrompt && <SystemPromptEntry content={systemPrompt} />}
            {chatDisplayItems.map((item) =>
              item.kind === 'work' ? (
                <ChatWorkSummary
                  key={`work-${item.indices[0]}`}
                  messages={item.messages}
                  indices={item.indices}
                  callCount={item.callCount}
                  durationMs={item.durationMs}
                  displayMessages={displayMessages}
                  worktreePath={session.absolute_worktree_path}
                  sessionId={session.id}
                  agentName="Reviewer"
                  pinnedRunningBashIds={pinnedRunningBashIds}
                />
              ) : (
                <ChatMessage
                  key={item.message.id ?? item.index}
                  message={item.message}
                  isLatestMessage={item.index === displayMessages.length - 1}
                  worktreePath={session.absolute_worktree_path}
                  sessionId={session.id}
                  agentName="Reviewer"
                  messageIndex={item.index}
                  allMessages={displayMessages}
                  pinnedRunningBashIds={pinnedRunningBashIds}
                />
              )
            )}
            {displayMessages.length === 0 && !isRunning && (
              <p className="text-xs text-faint">Review progress and MCP tool calls appear here.</p>
            )}
            {isRunning && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-accent/90">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Review in progress…</span>
                {!readonly && (
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stopping}
                    title="Stop review"
                    className={COMPOSER_STOP_BUTTON_CLASS}
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                  </button>
                )}
              </div>
            )}
            {runningBashDock.length > 0 && (
              <ChatRunningBashDock
                items={runningBashDock}
                worktreePath={session?.absolute_worktree_path}
                sessionId={session?.id}
              />
            )}
          </>
        )}
      </ChatMessagesViewport>
    </div>
  );
}
