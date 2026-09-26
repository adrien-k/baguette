import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  GitPullRequest,
  GitMerge,
  CircleCheck,
  MessageSquare,
  GitCompare,
  ClipboardCheck,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  Terminal,
  Square,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  messagesService,
  sessionsService,
  queuedMessagesService,
  loopsService,
} from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import ChatMessage from '../../components/ChatMessage.jsx';
import FileAttachmentPicker from '../../components/FileAttachmentPicker.jsx';
import AgentMessageComposer, {
  COMPOSER_ACTION_BUTTON_LAYOUT,
} from '../../components/AgentMessageComposer.jsx';
import QueuedMessages from '../../components/QueuedMessages.jsx';
import TiedLoopMessages from '../../components/TiedLoopMessages.jsx';
import { fileToContentBlock } from '../../utils/fileToContentBlock.js';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import MergeConfirmModal from '../../components/MergeConfirmModal.jsx';
import ScheduleMessageModal from '../../components/ScheduleMessageModal.jsx';
import SendRegularlyModal from '../../components/SendRegularlyModal.jsx';
import ChatMessagesViewport, { CHAT_COLUMN_CLASS } from '../../components/ChatMessagesViewport.jsx';
import LogsView from './LogsView.jsx';
import AnchoredMenu from '../../components/AnchoredMenu.jsx';
import { DROPDOWN_PANEL_CLASS } from '../../utils/dropdownPanel.js';
import Tooltip from '../../components/Tooltip.jsx';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useFilterRoutes } from '../../hooks/useFilterRoutes.js';
import { schedulePayload } from '../../utils/loopSchedule.js';
import { turnModelCreateFields } from '@baguette/shared/turn-model.js';
import { COMPOSER_STOP_BUTTON_CLASS } from '../../utils/buttonStyles.js';

/** "Check comments" quick message for builder sessions — must stay aligned with `## Responding to PR feedback` in `server/prompts/build-prompt.md` (injected via session prompt; do not duplicate that section here). */
const CHECK_COMMENTS_PROMPT_BUILDER =
  'Address open PR feedback by following the **Responding to PR feedback** section in your system instructions.';

/** Reviewer sessions use `reviewer-prompt.md`, not the build prompt; nudge PrComments + review workflow only. */
const CHECK_COMMENTS_PROMPT_REVIEWER =
  'Call PrComments to load existing PR conversation and inline review comments, then summarize and continue per your review workflow.';

const CHECK_COMMENTS_TOOLTIP_BUILDER = 'Check review comments and fix problems.';
const CHECK_COMMENTS_TOOLTIP_REVIEWER = 'Check review comments.';

function SystemPromptEntry({ content }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/40 transition-colors text-left"
      >
        <Terminal className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-500">System prompt</span>
        <span className="text-zinc-600 text-xs truncate flex-1 min-w-0">
          {content.slice(0, 80)}
        </span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800 bg-zinc-900/50">
          <pre className="text-zinc-500 text-xs font-mono leading-5 whitespace-pre-wrap overflow-auto max-h-96">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ChatView({
  messages,
  rawMessages,
  loading,
  loadMore,
  loadingMore,
  hasMore,
  session,
  systemPrompt,
  onViewChange,
  readonly,
  models,
  onModelChange,
  cursorFast,
  cursorEffort,
  showLogs = false,
  onShowLogsChange,
}) {
  const persistentState = usePersistentState(
    session?.id ? `session-chat-${session.id}` : undefined
  );
  const [input, setInput] = persistentState.useState('input', '');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [queue, setQueue] = useState([]);
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showRegularlyModal, setShowRegularlyModal] = useState(false);
  const [creatingLoop, setCreatingLoop] = useState(false);
  const [tiedLoops, setTiedLoops] = useState([]);
  const { loopEditUrl } = useFilterRoutes();
  const [composerModel, setComposerModel] = useState(session?.model ?? null);
  const [composerModelParams, setComposerModelParams] = useState(session?.model_params ?? null);

  useEffect(() => {
    setComposerModel(session?.model ?? null);
    setComposerModelParams(session?.model_params ?? null);
  }, [session?.id, session?.model, session?.model_params]);

  const composerTurnFields = () =>
    turnModelCreateFields({ model: composerModel, model_params: composerModelParams });

  const handleComposerModelChange = (modelId, modelParamsJson) => {
    setComposerModel(modelId);
    setComposerModelParams(modelParamsJson ?? null);
    onModelChange?.(modelId, modelParamsJson);
  };

  const isRunning = session?.status === 'running';
  const isProvisioning = session?.status === 'provisioning';
  const isReviewerSession = session?.agent_type === 'reviewer';
  const canSendDraft = Boolean((input.trim() || files.length) && session?.id && !sending);
  const hasInputMessage = Boolean(input.trim());
  const canOpenScheduleMenu = Boolean(hasInputMessage && session?.id && !sending);

  useEffect(() => {
    if (!session?.id) {
      setTiedLoops([]);
      return;
    }
    const load = () => {
      loopsService
        .find({ query: { session_id: session.id, $limit: 50 } })
        .then((d) => setTiedLoops(d.data ?? d))
        .catch(() => {});
    };
    load();
    loopsService.on('created', load);
    loopsService.on('patched', load);
    loopsService.on('removed', load);
    return () => {
      loopsService.off('created', load);
      loopsService.off('patched', load);
      loopsService.off('removed', load);
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    queuedMessagesService
      .find({ query: { session_id: session.id, $sort: { created_at: 1 }, $limit: 50 } })
      .then((res) => setQueue(res.data ?? res))
      .catch(() => {});

    const onCreated = (item) => {
      if (item.session_id === session.id) setQueue((q) => [...q, item]);
    };
    const onPatched = (item) => {
      if (item.session_id === session.id)
        setQueue((q) => q.map((m) => (m.id === item.id ? item : m)));
    };
    const onRemoved = (item) => {
      setQueue((q) => q.filter((m) => m.id !== item.id));
    };
    queuedMessagesService.on('created', onCreated);
    queuedMessagesService.on('patched', onPatched);
    queuedMessagesService.on('removed', onRemoved);
    return () => {
      queuedMessagesService.off('created', onCreated);
      queuedMessagesService.off('patched', onPatched);
      queuedMessagesService.off('removed', onRemoved);
    };
  }, [session?.id]);

  useEffect(() => {
    if (!canOpenScheduleMenu) setScheduleMenuOpen(false);
  }, [canOpenScheduleMenu]);

  const displayMessages = useMemo(() => {
    const result = [];
    for (const msg of messages) {
      if (msg.type === 'system' && msg.subtype === 'thinking_tokens') {
        const last = result[result.length - 1];
        if (last?.type === 'system' && last?.subtype === 'thinking_tokens') {
          result[result.length - 1] = msg;
        } else {
          result.push(msg);
        }
      } else {
        result.push(msg);
      }
    }
    return result;
  }, [messages]);

  // Manual fallback for a session that auto-restart could not resume on its own. `can_continue` is set
  // by the server; the literal string covers sessions stopped before that flag existed.
  const canContinueAfterRestart = useMemo(() => {
    const last = messages.at(-1);
    if (last?.type !== 'system' || last?.subtype !== 'status') return false;
    return last.can_continue === true || last.status === 'Server restarted — session was stopped';
  }, [messages]);

  const handleStop = async () => {
    if (!session?.id || stopping) return;
    setStopping(true);
    try {
      await sessionsService.stop(session.id);
    } finally {
      setStopping(false);
    }
  };

  const handleQuickSend = (text) => {
    if (!session?.id) return;
    messagesService.create({
      session_id: session.id,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
    });
  };

  const handleRestore = async () => {
    if (!session?.id || restoring) return;
    setRestoring(true);
    try {
      await sessionsService.restore(session.id);
    } catch (err) {
      toastError('Failed to restore session', err);
    } finally {
      setRestoring(false);
    }
  };

  const handleMerge = async () => {
    if (!session?.id) return;
    setMerging(true);
    setMergeError(null);
    try {
      await sessionsService.merge(session.id);
      setShowMergeModal(false);
      toast.success('PR merged successfully');
    } catch (err) {
      toastError('Failed to merge PR', err);
      setMergeError(err.message || 'Failed to merge PR');
    } finally {
      setMerging(false);
    }
  };

  const scrollContainerRef = useRef(null);
  const topSentinelRef = useRef(null);
  const messagesEndRef = useRef(null);
  const scrollAnchor = useRef(null);
  const isLoadingMoreRef = useRef(false);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    isAtBottomRef.current = true;
  }, [session?.id]);

  useLayoutEffect(() => {
    if (scrollAnchor.current && scrollContainerRef.current) {
      const { scrollTop, scrollHeight } = scrollAnchor.current;
      const newScrollHeight = scrollContainerRef.current.scrollHeight;
      scrollContainerRef.current.scrollTop = scrollTop + (newScrollHeight - scrollHeight);
      scrollAnchor.current = null;
    }
  }, [messages]);

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
    if (!isLoadingMoreRef.current && isAtBottomRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
    isLoadingMoreRef.current = false;
  }, [messages]);

  useLayoutEffect(() => {
    if (loading || !scrollContainerRef.current || isLoadingMoreRef.current) return;
    if (!isAtBottomRef.current) return;
    const container = scrollContainerRef.current;
    container.scrollTop = container.scrollHeight;
  }, [loading, session?.id]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    if (scrollContainerRef.current) {
      scrollAnchor.current = {
        scrollTop: scrollContainerRef.current.scrollTop,
        scrollHeight: scrollContainerRef.current.scrollHeight,
      };
    }
    isLoadingMoreRef.current = true;
    loadMore();
  }, [hasMore, loadMore, loadingMore]);

  useEffect(() => {
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
  }, [handleLoadMore, hasMore]);

  const buildContent = async (text, filesToSend) => {
    if (filesToSend.length) {
      const fileBlocks = await Promise.all(filesToSend.map(fileToContentBlock));
      return text ? [{ type: 'text', text }, ...fileBlocks] : fileBlocks;
    }
    return text;
  };

  const sendMessage = async (messageJson, { force = false, model, model_params } = {}) => {
    await messagesService.create({
      session_id: session.id,
      type: 'user',
      message_json: messageJson,
      ...turnModelCreateFields({ model, model_params }),
      ...(force ? { force: true } : {}),
    });
  };

  const buildMessageJsonFromDraft = async (text, filesToSend) => {
    const content = await buildContent(text, filesToSend);
    return JSON.stringify({ type: 'user', message: { role: 'user', content } });
  };

  const scheduleMessageAt = async (sendAtIso) => {
    if ((!input.trim() && !files.length) || !session?.id || sending) return;
    const text = input.trim();
    setError(null);
    setFileError(null);
    const filesToSend = files;
    setFiles([]);

    setSending(true);
    let messageJson;
    try {
      messageJson = await buildMessageJsonFromDraft(text, filesToSend);
    } catch (err) {
      setFileError(err?.message ?? 'Failed to read attached files');
      setInput(text);
      setFiles(filesToSend);
      setSending(false);
      return;
    }

    try {
      await queuedMessagesService.schedule({
        session_id: session.id,
        message_json: messageJson,
        send_at: sendAtIso,
        ...composerTurnFields(),
      });
      setInput('');
      persistentState.clear();
      setScheduleMenuOpen(false);
      setShowScheduleModal(false);
      toast.success('Message scheduled');
    } catch (err) {
      setInput(text);
      setFiles(filesToSend);
      toastError('Failed to schedule message', err);
    } finally {
      setSending(false);
    }
  };

  const handleSchedulePreset = (delayMs) => {
    setScheduleMenuOpen(false);
    scheduleMessageAt(new Date(Date.now() + delayMs).toISOString());
  };

  const openScheduleModal = () => {
    setScheduleMenuOpen(false);
    setShowScheduleModal(true);
  };

  const closeScheduleModal = () => {
    if (sending) return;
    setShowScheduleModal(false);
  };

  const handleScheduleConfirm = (sendAtIso) => {
    const when = new Date(sendAtIso);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error('Pick a time in the future');
      return;
    }
    scheduleMessageAt(sendAtIso);
  };

  const openRegularlyModal = () => {
    setScheduleMenuOpen(false);
    setShowRegularlyModal(true);
  };

  const closeRegularlyModal = () => {
    if (creatingLoop) return;
    setShowRegularlyModal(false);
  };

  const handleSendRegularly = async ({ name, schedule }) => {
    const prompt = input.trim();
    if (!prompt || !session?.id) return;
    setCreatingLoop(true);
    try {
      const payload = session.is_global
        ? { is_global: true, prompt, name, single_session: true, session_id: session.id }
        : {
            repo_full_name: session.repo_full_name,
            base_branch: session.base_branch,
            prompt,
            name,
            single_session: true,
            session_id: session.id,
            create_new_branch: !!session.create_new_branch,
            auto_push: !!session.auto_push,
          };
      if (session.agent_sdk) payload.agent_sdk = session.agent_sdk;
      if (composerModel) payload.model = composerModel;
      if (composerModelParams) payload.model_params = composerModelParams;
      if (session.plugins?.length) payload.plugins = session.plugins;
      await loopsService.create({ ...payload, ...schedulePayload(schedule) });
      setInput('');
      persistentState.clear();
      setShowRegularlyModal(false);
      toast.success('Loop created — this session will run on a schedule');
    } catch (err) {
      toastError('Failed to create loop', err);
    } finally {
      setCreatingLoop(false);
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if ((!input.trim() && !files.length) || !session?.id || sending) return;
    const text = input.trim();
    setError(null);
    setFileError(null);
    const filesToSend = files;
    setFiles([]);

    setSending(true);
    let content;
    try {
      content = await buildContent(text, filesToSend);
    } catch (err) {
      setFileError(err?.message ?? 'Failed to read attached files');
      setInput(text);
      setFiles(filesToSend);
      setSending(false);
      return;
    }

    const messageJson = JSON.stringify({ type: 'user', message: { role: 'user', content } });

    try {
      await sendMessage(messageJson, composerTurnFields());
      persistentState.clear();
    } catch (err) {
      setInput(text);
      setFiles(filesToSend);
      toastError('Failed to send message', err);
    } finally {
      setSending(false);
    }
  };

  const handleQueueDelete = async (id) => {
    try {
      await queuedMessagesService.remove(id);
    } catch (err) {
      toastError('Failed to delete queued message', err);
    }
  };

  const handleTiedLoopDelete = async (loop) => {
    if (!window.confirm(`Delete loop "${loop.name || loop.prompt.slice(0, 40)}"?`)) return;
    try {
      await loopsService.remove(loop.id);
    } catch (err) {
      toastError('Failed to delete loop', err);
    }
  };

  const handleQueueSendNow = async (item) => {
    try {
      await queuedMessagesService.remove(item.id);
      await sendMessage(item.message_json, {
        force: true,
        model: item.model,
        model_params: item.model_params,
      });
    } catch (err) {
      toastError('Failed to send message', err);
    }
  };

  const handleQueueEdit = async (id, newMessageJson) => {
    try {
      await queuedMessagesService.patch(id, { message_json: newMessageJson });
    } catch (err) {
      toastError('Failed to update queued message', err);
    }
  };

  const chatLogsToggle = (
    <div className={`shrink-0 flex justify-end px-3 sm:px-4 pb-1 ${showLogs ? 'pt-2' : ''}`}>
      <button
        type="button"
        onClick={() => onShowLogsChange?.(!showLogs)}
        className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {showLogs ? 'Show chat' : 'Show logs'}
      </button>
    </div>
  );

  return (
    <>
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {showLogs ? (
          <LogsView
            rawMessages={rawMessages}
            loadMore={loadMore}
            loadingMore={loadingMore}
            hasMore={hasMore}
          />
        ) : (
          <ChatMessagesViewport showBottomFade={!readonly} scrollRef={scrollContainerRef}>
            {loading ? (
              <div
                className="flex h-full items-center justify-center"
                role="status"
                aria-label="Loading conversation"
              >
                <div className="w-6 h-6 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div ref={topSentinelRef} className="h-px" />
                {loadingMore && (
                  <div className="flex justify-center py-2">
                    <div className="w-4 h-4 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {systemPrompt && <SystemPromptEntry content={systemPrompt} />}
                {displayMessages.map((msg, i) => (
                  <ChatMessage
                    key={i}
                    message={msg}
                    isLatestMessage={i === displayMessages.length - 1}
                    worktreePath={session.absolute_worktree_path}
                    sessionId={session.id}
                    agentName={session.agent_sdk === 'cursor' ? 'Cursor' : 'Claude'}
                    messageIndex={i}
                    allMessages={displayMessages}
                    models={models}
                  />
                ))}
                {isProvisioning && (
                  <div className="flex items-center gap-2 py-2 text-xs text-zinc-400">
                    <div className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin shrink-0" />
                    Setting up worktree…
                  </div>
                )}
                {!readonly && canContinueAfterRestart && (
                  <div className="flex gap-2 flex-wrap py-2">
                    <button
                      type="button"
                      onClick={() => handleQuickSend('continue')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Continue
                    </button>
                  </div>
                )}
                {session?.archived_at && (
                  <div className="flex gap-2 flex-wrap py-2">
                    <Tooltip content="Recreate the worktree on the same branch and resume this session.">
                      <button
                        type="button"
                        onClick={handleRestore}
                        disabled={restoring}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {restoring ? 'Restoring…' : 'Restore'}
                      </button>
                    </Tooltip>
                  </div>
                )}
                {!readonly &&
                  !isProvisioning &&
                  !isGlobalSession(session) &&
                  session?.status !== 'running' &&
                  session?.pr_status !== 'merged' && (
                    <div className="flex gap-2 flex-wrap py-2">
                      <Tooltip content="Pull latest from the remote and base branch. Fix conflicts if any.">
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickSend(
                              'Please run GitPull to sync with the latest changes from the remote branch. Merge the base branch. If there are any merge conflicts, resolve them.'
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                        >
                          <GitPullRequest className="w-3.5 h-3.5" />
                          Git sync
                        </button>
                      </Tooltip>
                      <Tooltip content="Merge the pull request into the base branch.">
                        <button
                          type="button"
                          onClick={() => setShowMergeModal(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          Merge
                        </button>
                      </Tooltip>
                      <Tooltip content="Check all PR workflow statuses and fix problems.">
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickSend(
                              'Please check the CI workflow status using PrWorkflows. Fix any failing workflows.'
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                        >
                          <CircleCheck className="w-3.5 h-3.5" />
                          Check CI
                        </button>
                      </Tooltip>
                      <Tooltip
                        content={
                          isReviewerSession
                            ? CHECK_COMMENTS_TOOLTIP_REVIEWER
                            : CHECK_COMMENTS_TOOLTIP_BUILDER
                        }
                      >
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickSend(
                              isReviewerSession
                                ? CHECK_COMMENTS_PROMPT_REVIEWER
                                : CHECK_COMMENTS_PROMPT_BUILDER
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Check comments
                        </button>
                      </Tooltip>
                      {onViewChange && (
                        <>
                          <Tooltip content="Open the Issues tab to run a code review.">
                            <button
                              type="button"
                              onClick={() => onViewChange('review')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              Review code
                            </button>
                          </Tooltip>
                          <Tooltip content="View a diff of all changes in this session.">
                            <button
                              type="button"
                              onClick={() => onViewChange('diff')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                            >
                              <GitCompare className="w-3.5 h-3.5" />
                              Diff
                            </button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  )}
                <div ref={messagesEndRef} />
              </>
            )}
          </ChatMessagesViewport>
        )}

        {chatLogsToggle}

        {error && !showLogs && (
          <div className="shrink-0 px-3 py-2 bg-red-900/30 border-t border-red-700 text-red-400 text-xs">
            {error}
          </div>
        )}

        {!showLogs && !readonly && (queue.length > 0 || tiedLoops.length > 0) && (
          <div className={`shrink-0 flex flex-col gap-2 pb-1 ${CHAT_COLUMN_CLASS}`}>
            <QueuedMessages
              queue={queue}
              onDelete={handleQueueDelete}
              onSendNow={handleQueueSendNow}
              onEdit={handleQueueEdit}
            />
            <TiedLoopMessages
              loops={tiedLoops}
              editHref={(loop) => loopEditUrl(loop.id)}
              onDelete={handleTiedLoopDelete}
            />
          </div>
        )}

        {!showLogs && !readonly && (
          <div className="relative z-[2] shrink-0 bg-zinc-950 pb-3 sm:pb-4 pt-1">
            <FileAttachmentPicker
              className={`w-full ${CHAT_COLUMN_CLASS}`}
              files={files}
              onAdd={(picked) => {
                setFileError(null);
                setFiles((prev) => [...prev, ...picked]);
              }}
              onRemove={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
              error={fileError}
            >
              {({ attachButton }) => (
                <AgentMessageComposer
                  skipColumn
                  formClassName=""
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSend}
                  placeholder={`Message ${session.agent_sdk === 'cursor' ? 'Cursor' : 'Claude'}...`}
                  sending={sending}
                  session={session}
                  models={models}
                  cursorFast={cursorFast}
                  cursorEffort={cursorEffort}
                  onModelChange={handleComposerModelChange}
                  textareaId="chat-input"
                  canSend={canSendDraft}
                  submitLabel={isRunning || isProvisioning ? 'Queue' : 'Send'}
                  toolbarExtra={
                    <>
                      {attachButton}
                      {isRunning && (
                        <button
                          type="button"
                          onClick={handleStop}
                          disabled={stopping}
                          title="Stop"
                          className={COMPOSER_STOP_BUTTON_CLASS}
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                        </button>
                      )}
                    </>
                  }
                  sendAddon={
                    <AnchoredMenu
                      open={scheduleMenuOpen}
                      onOpenChange={setScheduleMenuOpen}
                      placement="top-end"
                      className={`w-44 ${DROPDOWN_PANEL_CLASS} overflow-hidden py-1`}
                      reference={({ ref, referenceProps }) => (
                        <button
                          type="button"
                          ref={ref}
                          {...referenceProps}
                          disabled={!canOpenScheduleMenu}
                          onClick={(e) => {
                            referenceProps.onClick?.(e);
                            if (canOpenScheduleMenu) setScheduleMenuOpen((v) => !v);
                          }}
                          title="Schedule"
                          aria-expanded={scheduleMenuOpen}
                          aria-haspopup="menu"
                          className={`${COMPOSER_ACTION_BUTTON_LAYOUT} bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 border border-transparent px-1.5 rounded-r-lg transition-colors disabled:cursor-not-allowed`}
                        >
                          <ChevronDown className="w-3 h-3" strokeWidth={2.5} />
                        </button>
                      )}
                    >
                      <div role="menu">
                        {[
                          { label: 'Send in 30 minutes', delayMs: 30 * 60_000 },
                          { label: 'Send in 1 hour', delayMs: 3_600_000 },
                          { label: 'Send in 2 hours', delayMs: 2 * 3_600_000 },
                          { label: 'Send in 4 hours', delayMs: 4 * 3_600_000 },
                        ].map(({ label, delayMs }) => (
                          <button
                            key={delayMs}
                            type="button"
                            role="menuitem"
                            onClick={() => handleSchedulePreset(delayMs)}
                            className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                          >
                            {label}
                          </button>
                        ))}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={openScheduleModal}
                          className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                        >
                          Schedule
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={openRegularlyModal}
                          className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
                        >
                          Send regularly
                        </button>
                      </div>
                    </AnchoredMenu>
                  }
                />
              )}
            </FileAttachmentPicker>
          </div>
        )}
      </div>
      {showScheduleModal && (
        <ScheduleMessageModal
          onConfirm={handleScheduleConfirm}
          onCancel={closeScheduleModal}
          scheduling={sending}
        />
      )}
      {showRegularlyModal && (
        <SendRegularlyModal
          onConfirm={handleSendRegularly}
          onCancel={closeRegularlyModal}
          saving={creatingLoop}
          defaultName={input.trim().split('\n')[0].slice(0, 60)}
        />
      )}
      {showMergeModal && (
        <MergeConfirmModal
          prNumber={session?.pr_number}
          onConfirm={handleMerge}
          onCancel={() => {
            setShowMergeModal(false);
            setMergeError(null);
          }}
          loading={merging}
          error={mergeError}
          onFixConflicts={() => {
            setShowMergeModal(false);
            setMergeError(null);
            handleQuickSend(
              'Please run GitPull to sync with the latest changes from the remote branch. Merge the base branch. If there are any merge conflicts, resolve them.'
            );
          }}
        />
      )}
    </>
  );
}
