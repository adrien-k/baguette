import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Square } from 'lucide-react';
import { sessionReviewService, sessionsService } from '../../feathers.js';
import { apiFetch } from '../../api.js';
import { toastError } from '../../utils/toastError.jsx';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import { useGetReviewMessages } from '../../hooks/useGetReviewMessages.js';
import { useCursorModelPrefs } from '../../hooks/useAgentPreferences.js';
import AgentMessageComposer from '../../components/AgentMessageComposer.jsx';
import { COMPOSER_STOP_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import ChatMessagesViewport from '../../components/ChatMessagesViewport.jsx';
import ChatMessage from '../../components/ChatMessage.jsx';
import ChatWorkSummary from '../../components/chat/ChatWorkSummary.jsx';
import { groupChatDisplayMessages } from '@baguette/shared/chat-display-groups.js';

function parseMessageRow(row) {
  try {
    return { ...row, ...JSON.parse(row.message_json || '{}'), id: row.id };
  } catch {
    return { ...row, type: row.type, id: row.id };
  }
}

function reconcileMessages(messages) {
  const toolResults = new Map();
  const visible = [];
  for (const msg of messages) {
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      const blocks = msg.message.content;
      if (blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')) {
        for (const block of blocks) {
          const result =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                    .join('\n')
                : JSON.stringify(block.content);
          toolResults.set(block.tool_use_id, { result, isError: !!block.is_error });
        }
        continue;
      }
    }
    visible.push(msg);
  }
  if (toolResults.size === 0) return visible;
  return visible.map((msg) => {
    if (msg.type !== 'assistant' || !msg.message?.content) return msg;
    if (!msg.message.content.some((b) => b.type === 'tool_use')) return msg;
    return {
      ...msg,
      message: {
        ...msg.message,
        content: msg.message.content.map((b) => {
          if (b.type !== 'tool_use') return b;
          const tr = toolResults.get(b.id);
          return tr ? { ...b, ...tr } : b;
        }),
      },
    };
  });
}

function SystemPromptEntry({ content }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/40 transition-colors text-left"
      >
        <span className="text-xs font-medium text-zinc-500">Review system prompt</span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-600 shrink-0 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0 ml-auto" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800 bg-zinc-900/50">
          <pre className="text-zinc-500 text-xs font-mono leading-5 whitespace-pre-wrap overflow-auto max-h-72">
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

/** Reviewer chat for the session side panel (same slot as Tasks / Files). */
export default function ReviewAgentPanel({ session, readonly, sidePanelOpen = false }) {
  const { cursorFast, cursorEffort } = useCursorModelPrefs();
  const {
    messages: hookMessages,
    loading: messagesLoading,
    loadMore,
    loadingMore,
    hasMore,
    reload: reloadReviewMessages,
  } = useGetReviewMessages(session?.id);
  const [models, setModels] = useState([]);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [clearingContext, setClearingContext] = useState(false);
  const scrollContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const isXlUp = useMediaQuery('(min-width: 1280px)');
  const panelRevealed = isXlUp || sidePanelOpen;
  const reviewPersist = usePersistentState(
    session?.id ? `session-review-chat-${session.id}` : undefined
  );
  const [followUpText, setFollowUpText] = reviewPersist.useState('input', '');

  const reviewAgentSdk = session?.agent_sdk || 'claude';
  const reviewModel = session?.review_model || session?.model || '';
  const reviewModelParams = session?.review_model_params ?? session?.model_params ?? null;

  useEffect(() => {
    const url =
      reviewAgentSdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    apiFetch(url)
      .then((d) => setModels(d.models || []))
      .catch(() => {});
  }, [reviewAgentSdk]);

  const sessionForReviewComposer = useMemo(
    () => ({
      ...session,
      agent_sdk: reviewAgentSdk,
      model: reviewModel,
      model_params: reviewModelParams,
    }),
    [session, reviewAgentSdk, reviewModel, reviewModelParams]
  );

  const rawMessages = useMemo(() => (hookMessages || []).map(parseMessageRow), [hookMessages]);
  const displayMessages = useMemo(() => reconcileMessages(rawMessages), [rawMessages]);
  const chatDisplayItems = useMemo(
    () => groupChatDisplayMessages(displayMessages),
    [displayMessages]
  );
  const systemPrompt = useMemo(
    () => rawMessages.find((m) => m.type === 'system' && m.subtype === 'prompt')?.content,
    [rawMessages]
  );

  const isRunning = session?.review_status === 'running';
  const reviewTurnActive = isRunning || sendingFollowUp;
  const showReviewComposer = !readonly && (rawMessages.length > 0 || isRunning);
  const reviewFollowUpTextareaId = session?.id ? `review-follow-up-${session.id}` : undefined;

  const handleReviewModelChange = async (modelId, modelParamsJson) => {
    if (!session?.id || readonly) return;
    try {
      await sessionsService.patch(session.id, {
        review_model: modelId,
        review_model_params: modelParamsJson ?? null,
      });
    } catch (err) {
      toastError('Failed to update review model', err);
    }
  };

  const handleClearContext = async () => {
    if (!session?.id || reviewTurnActive || clearingContext) return;
    const ok = window.confirm(
      'Clear reviewer chat history? Issues on the Issues tab are kept. You can start a new review from there afterward.'
    );
    if (!ok) return;
    setClearingContext(true);
    try {
      await sessionReviewService.clearContext({ session_id: session.id });
      setFollowUpText('');
      reloadReviewMessages();
    } catch (err) {
      toastError('Failed to clear reviewer context', err);
    } finally {
      setClearingContext(false);
    }
  };

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

  const handleFollowUpSend = async (e) => {
    e?.preventDefault();
    const text = followUpText.trim();
    if (!session?.id || !text || reviewTurnActive) return;
    setSendingFollowUp(true);
    try {
      await sessionReviewService.send({ session_id: session.id, message: text });
      setFollowUpText('');
      reloadReviewMessages();
    } catch (err) {
      toastError('Failed to send review message', err);
    } finally {
      setSendingFollowUp(false);
    }
  };

  const reviewComposerPlaceholder =
    reviewAgentSdk === 'cursor' ? 'Message Cursor reviewer…' : 'Message Claude reviewer…';

  useEffect(() => {
    isAtBottomRef.current = true;
  }, [session?.id]);

  useEffect(() => {
    if (panelRevealed) isAtBottomRef.current = true;
  }, [panelRevealed, session?.id]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 80;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useLayoutEffect(() => {
    if (!panelRevealed || messagesLoading || !scrollContainerRef.current) return;
    if (!isAtBottomRef.current) return;
    scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
  }, [panelRevealed, messagesLoading, session?.id, displayMessages.length, reviewTurnActive]);

  const showClearContext = !readonly && rawMessages.length > 0;

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      {showClearContext && (
        <div className="shrink-0 flex justify-end px-3 py-1.5 border-b border-zinc-800/80">
          <button
            type="button"
            onClick={handleClearContext}
            disabled={reviewTurnActive || clearingContext}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {clearingContext ? 'Clearing…' : 'Clear context'}
          </button>
        </div>
      )}
      <ChatMessagesViewport showBottomFade={showReviewComposer} scrollRef={scrollContainerRef}>
        {messagesLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : (
          <>
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="text-xs text-zinc-500 hover:text-zinc-300"
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
                />
              )
            )}
            {displayMessages.length === 0 && !reviewTurnActive && (
              <p className="text-xs text-zinc-500">
                Review progress and MCP tool calls appear here.
              </p>
            )}
            {reviewTurnActive && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-amber-400/90">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Review in progress…</span>
              </div>
            )}
          </>
        )}
      </ChatMessagesViewport>
      {showReviewComposer && (
        <AgentMessageComposer
          value={followUpText}
          onChange={setFollowUpText}
          onSubmit={handleFollowUpSend}
          placeholder={reviewComposerPlaceholder}
          disabled={readonly}
          submitDisabled={reviewTurnActive}
          sending={sendingFollowUp}
          submitLabel={isRunning ? 'Queue' : 'Send'}
          session={sessionForReviewComposer}
          models={models}
          cursorFast={cursorFast}
          cursorEffort={cursorEffort}
          onModelChange={handleReviewModelChange}
          textareaId={reviewFollowUpTextareaId}
          skipColumn
          formClassName="relative z-[2] shrink-0 bg-zinc-950 px-2 pb-3 pt-1"
          toolbarExtra={
            isRunning ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping}
                title="Stop"
                className={COMPOSER_STOP_BUTTON_CLASS}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
