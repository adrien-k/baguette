import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  FolderOpen,
  X,
  Plus,
  AlertCircle,
  MessageSquare,
  GitBranch,
  Copy,
  Loader2,
  PanelLeft,
  PanelRight,
  ClipboardCheck,
  MonitorPlay,
  FileText,
} from 'lucide-react';
import BuilderForm from '../components/BuilderForm.jsx';
import { fileToContentBlock } from '../utils/fileToContentBlock.js';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useFilters } from '../context/FilterContext.jsx';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import { apiFetch } from '../api.js';
import { sessionsService, tasksService } from '../feathers.js';
import {
  sessionActivityAt,
  sessionNeedsLastViewedUpdate,
} from '@baguette/shared/session-unread.js';
import { useGetSession } from '../hooks/useGetSession.js';
import { useGetMessages } from '../hooks/useGetMessages.js';
import { useGetTasks } from '../hooks/useGetTasks.js';
import { useGetSessionIssues } from '../hooks/useGetSessionIssues.js';
import { useSessionBranchCommits } from '../hooks/useSessionBranchCommits.js';
import { useSessionCommitsToPush } from '../hooks/useSessionCommitsToPush.js';
import { useSessionChangedFiles } from '../hooks/useSessionChangedFiles.js';
import TaskLogModal from '../components/TaskLogModal.jsx';
import ArchiveSession from '../components/ArchiveSession.jsx';
import StopSession, { isSessionStoppable } from '../components/StopSession.jsx';
import PushConfirmModal from '../components/PushConfirmModal.jsx';
import ChatView from './session/ChatView.jsx';
import DiffView from './session/DiffView.jsx';
import PreviewView from './session/PreviewView.jsx';
import ReviewView from './session/ReviewView.jsx';
import DetailsView from './session/DetailsView.jsx';
import SessionSidePanel from './session/SessionSidePanel.jsx';
import SessionMainViewFooter from './session/SessionMainViewFooter.jsx';
import { resolveSidePanelTab, SIDE_PANEL_TAB_IDS } from './session/sessionSidePanelTabs.js';
import SessionTools from '../components/SessionTools.jsx';
import { useCursorModelPrefs } from '../hooks/useAgentPreferences.js';
import {
  isGlobalSession,
  isAllSessionsPath,
  isNewSessionRouteId,
  NEW_SESSION_ROUTE_ID,
} from '@baguette/shared/session-scope.js';
import { sortSessionsForList } from '@baguette/shared/session-sort.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import CardRepoBadge from '../components/CardRepoBadge.jsx';
import SessionStatusIndicator from '../components/SessionStatusIndicator.jsx';
import SessionListIndicator, { SessionUnreadDot } from '../components/SessionListIndicator.jsx';
import ReviewInProgressBadge, { isReviewInProgress } from '../components/ReviewInProgressBadge.jsx';
import { SessionLoopBadge, SessionLoopIcon } from '../components/SessionLoopIndicator.jsx';
import { BANNER_DANGER } from '../utils/ui.js';
import { diffFileDisplayPath } from '../utils/paths.js';

const SIDE_PANEL_WIDTH_DEFAULT = 360;
const SIDE_PANEL_WIDTH_MIN = 240;
const SIDE_PANEL_WIDTH_MAX = 800;

/**
 * Processes a flat list of messages from session history:
 * - Collects tool results from user messages that consist only of tool_result blocks
 * - Stitches those results onto the matching tool_use blocks in assistant messages
 * - Filters out the standalone tool_result user messages (they'd render as noise)
 */
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
        continue; // don't add to visible list
      }
    }
    visible.push(msg);
  }

  const reconciled =
    toolResults.size === 0
      ? visible
      : visible.map((msg) => {
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

  // Find the last TodoWrite block reference so we can hide all previous ones
  let lastTodoWriteBlock = null;
  for (const msg of reconciled) {
    if (msg.type !== 'assistant' || !msg.message?.content) continue;
    for (const b of msg.message.content) {
      if (b.type === 'tool_use' && b.name === 'TodoWrite') lastTodoWriteBlock = b;
    }
  }
  const withHiddenTodos = !lastTodoWriteBlock
    ? reconciled
    : reconciled.map((msg) => {
        if (msg.type !== 'assistant' || !msg.message?.content) return msg;
        if (
          !msg.message.content.some(
            (b) => b.type === 'tool_use' && b.name === 'TodoWrite' && b !== lastTodoWriteBlock
          )
        )
          return msg;
        return {
          ...msg,
          message: {
            ...msg.message,
            content: msg.message.content.map((b) => {
              if (b.type === 'tool_use' && b.name === 'TodoWrite' && b !== lastTodoWriteBlock)
                return { ...b, _hidden: true };
              return b;
            }),
          },
        };
      });

  // Collect sub-agent activity lines per Task/Agent tool_use_id
  const taskActivities = new Map(); // tool_use_id -> string[]
  const SUB_AGENT_SYSTEM_SUBTYPES = new Set(['task_started', 'task_progress', 'task_notification']);

  for (const msg of messages) {
    // Sub-agent assistant messages: extract tool call names + brief inputs
    if (msg.type === 'assistant' && msg.parent_tool_use_id) {
      const key = msg.parent_tool_use_id;
      const lines = taskActivities.get(key) || [];
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          const detail =
            block.input?.command?.slice(0, 80) ||
            block.input?.file_path?.slice(0, 80) ||
            block.input?.pattern?.slice(0, 80) ||
            block.input?.description?.slice(0, 80) ||
            '';
          lines.push(detail ? `${block.name}: ${detail}` : block.name);
        }
      }
      taskActivities.set(key, lines);
    }
    // task_progress system messages: append summary/description
    if (msg.type === 'system' && msg.subtype === 'task_progress' && msg.tool_use_id) {
      const text = msg.summary || msg.description;
      if (text) {
        const lines = taskActivities.get(msg.tool_use_id) || [];
        lines.push(`[${text}]`);
        taskActivities.set(msg.tool_use_id, lines);
      }
    }
  }

  return withHiddenTodos
    .filter((msg) => {
      // Remove sub-agent messages from the main chat view
      if (msg.type === 'assistant' && msg.parent_tool_use_id) return false;
      if (msg.type === 'system' && SUB_AGENT_SYSTEM_SUBTYPES.has(msg.subtype)) return false;
      if (msg.type === 'tool_progress') return false;
      return true;
    })
    .map((msg) => {
      // Attach collected activities to Task/Agent tool_use blocks
      if (msg.type !== 'assistant' || !msg.message?.content || taskActivities.size === 0)
        return msg;
      const hasAgentBlock = msg.message.content.some(
        (b) => b.type === 'tool_use' && (b.name === 'Task' || b.name === 'Agent')
      );
      if (!hasAgentBlock) return msg;
      return {
        ...msg,
        message: {
          ...msg.message,
          content: msg.message.content.map((b) => {
            if (b.type !== 'tool_use' || (b.name !== 'Task' && b.name !== 'Agent')) return b;
            const activities = taskActivities.get(b.id);
            return activities?.length ? { ...b, agentActivities: activities } : b;
          }),
        },
      };
    });
}

function parseMessageRow(row) {
  try {
    return { ...row, ...JSON.parse(row.message_json || '{}'), id: row.id };
  } catch {
    return { ...row, type: row.type, id: row.id };
  }
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function sessionListPromptPreview(s, maxWords = 12) {
  const prompt = s.initial_prompt?.trim();
  if (!prompt) return null;
  const parts = prompt.split(/\s+/);
  if (parts.length <= maxWords) return prompt;
  return `${parts.slice(0, maxWords).join(' ')}…`;
}

function MiniSessionEntry({
  session: s,
  currentId,
  onArchive,
  hideRepoBadge = false,
  suppressUnreadWhenOpen = false,
}) {
  const isArchived = !!s.archived_at;
  const isArchiving = !isArchived && s.status === 'archiving';
  const { sessionUrl, showRepoDetails } = useFilterRoutes();
  const isCurrent = s.short_id === currentId;
  const title = s.label || (isGlobalSession(s) ? 'Global session' : s.repo_full_name) || 'Session';
  const promptPreview = sessionListPromptPreview(s);
  const showRepo = showRepoDetails && !hideRepoBadge;

  return (
    <div
      className={`group px-3 py-2 text-xs transition-colors ${
        isArchived || isArchiving ? 'opacity-50' : ''
      } ${isCurrent ? 'bg-control-hover' : 'hover:bg-control/50'}`}
    >
      <div className="flex items-center gap-2">
        <SessionListIndicator session={s} />
        <Link to={sessionUrl(s.short_id)} className="flex-1 min-w-0 leading-snug text-left">
          {showRepo && (
            <span className="block truncate">
              <CardRepoBadge show isGlobal={isGlobalSession(s)} repoFullName={s.repo_full_name} />
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1.5">
            <SessionUnreadDot session={s} suppressUnread={suppressUnreadWhenOpen} />
            <span
              className={`min-w-0 truncate font-medium ${isCurrent ? 'text-fg' : 'text-heading'}`}
            >
              {title}
            </span>
            {s.loop_id && <SessionLoopIcon />}
            {isReviewInProgress(s) && !isArchiving && <ReviewInProgressBadge compact />}
          </span>
          {promptPreview && (
            <span className="block truncate text-[11px] text-faint">{promptPreview}</span>
          )}
        </Link>
        {isArchiving && <span className="shrink-0 text-[10px] text-accent/90">Archiving…</span>}
        {!s.archived_at && !isArchiving && (
          <div className="shrink-0">
            {isSessionStoppable(s) ? (
              <StopSession session={s} />
            ) : s.status !== 'provisioning' ? (
              <ArchiveSession session={s} onArchive={() => onArchive?.(s)} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

const BASE_VIEWS = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'review', label: 'Issues', Icon: ClipboardCheck },
  { id: 'diff', label: 'Diff', Icon: FolderOpen },
];
const DETAILS_VIEW = { id: 'details', label: 'Details', Icon: FileText };
const PREVIEW_VIEW = { id: 'preview', label: 'Preview', Icon: MonitorPlay };
function nextVisibleSession({ sessions, short_id, session, repoId, fromAllSessions }) {
  return sessions.find((s) => {
    if (
      s.short_id === short_id ||
      s.archived_at ||
      s.status === 'archiving' ||
      s.status === 'archived'
    )
      return false;
    if (fromAllSessions) return true;
    if (isGlobalSession(session)) return isGlobalSession(s);
    const currentRepoId = repoId || session?.repo_id;
    return !currentRepoId || String(s.repo_id) === String(currentRepoId);
  });
}

export default function Session() {
  const { short_id, repoId } = useParams();
  const { pathname } = useLocation();
  const isNewSessionRoute = isNewSessionRouteId(short_id);
  const fromAllSessions = isAllSessionsPath(pathname);
  const isGlobalSessionsRoute = pathname.startsWith('/global/');
  const { homeUrl, sessionUrl, loopEditUrl, showRepoDetails } = useFilterRoutes();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const activeView = viewParam === 'logs' ? 'chat' : viewParam || 'chat';
  const { sessions, hasMore: hasMoreSessions, loadMore: loadMoreSessions } = useSessionsContext();
  const { selectedRepo, setSelectedRepo, repos } = useRepoContext();
  const { showArchived } = useFilters();
  const { session: sessionFromHook, loading: sessionLoading } = useGetSession(
    isNewSessionRoute ? null : short_id
  );
  const sessionId = useMemo(() => {
    if (isNewSessionRoute || !short_id) return null;
    if (sessionFromHook?.short_id === short_id) return sessionFromHook.id;
    return sessions.find((s) => s.short_id === short_id)?.id ?? null;
  }, [isNewSessionRoute, short_id, sessionFromHook, sessions]);
  const {
    messages: hookMessages,
    loading: messagesLoading,
    loadMore,
    loadingMore,
    hasMore,
  } = useGetMessages(sessionId);
  const { tasks: tasksFromHook } = useGetTasks({ sessionId, skip: !sessionId });
  const shouldLoadSessionIssues = activeView === 'review';
  const { issues: sessionIssues, loading: sessionIssuesLoading } = useGetSessionIssues(sessionId, {
    enabled: shouldLoadSessionIssues,
  });
  const [session, setSession] = useState(null);
  const openIssuesTabCount = useMemo(() => {
    if (shouldLoadSessionIssues) {
      return sessionIssues.filter((i) => i.status === 'opened').length;
    }
    return session?.open_issues_count ?? 0;
  }, [shouldLoadSessionIssues, sessionIssues, session?.open_issues_count]);
  const [prInfo, setPrInfo] = useState(null);
  const [killedTaskIds, setKilledTaskIds] = useState(new Set());
  const [showTasks, setShowTasks] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  );
  const isXlScreen = useMediaQuery('(min-width: 1280px)');
  const [showSidebar, setShowSidebar] = useState(null);
  const sidePanelPersist = usePersistentState('session-side-panel');
  const [sidePanelWidth, setSidePanelWidth] = sidePanelPersist.useState(
    'width',
    SIDE_PANEL_WIDTH_DEFAULT
  );
  useLayoutEffect(() => {
    try {
      const store = JSON.parse(localStorage.getItem('session-side-panel') || '{}');
      if (store.width != null) return;
      const legacy = store.reviewWidth ?? store.tasksWidth;
      if (typeof legacy === 'number') setSidePanelWidth(legacy);
    } catch {
      /* ignore */
    }
  }, [setSidePanelWidth]);
  const [scrollToDiffFile, setScrollToDiffFile] = useState(null);
  const diffCommitParam = searchParams.get('commit');
  const selectedDiffCommit = diffCommitParam && diffCommitParam !== 'all' ? diffCommitParam : 'all';
  const filesCommitSha =
    activeView === 'diff' && selectedDiffCommit !== 'all' ? selectedDiffCommit : null;
  const panelParam = searchParams.get('panel');
  const sidePanelTab = useMemo(() => resolveSidePanelTab(panelParam), [panelParam]);
  const shouldLoadBranchCommits = sidePanelTab === 'commits' || activeView === 'diff';
  const shouldLoadChangedFiles = sidePanelTab === 'files' || activeView === 'diff';
  const gitSession = session ?? sessionFromHook;
  const {
    commits: branchCommits,
    loading: branchCommitsLoading,
    refresh: refreshBranchCommits,
  } = useSessionBranchCommits(gitSession, shouldLoadBranchCommits);
  const {
    files: diffFiles,
    loading: changedFilesLoading,
    refresh: refreshChangedFiles,
  } = useSessionChangedFiles(gitSession, filesCommitSha, shouldLoadChangedFiles);
  const [models, setModels] = useState([]);
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const [pushing, setPushing] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushRequest, setPushRequest] = useState(null);
  const [activeTaskModal, setActiveTaskModal] = useState(null);
  const [configCommands, setConfigCommands] = useState([]);
  const [detailsScrollTo, setDetailsScrollTo] = useState(null);
  const [error, setError] = useState(null);
  const hasPreview = !!(session ?? sessionFromHook)?.preview_url;
  const showReviewerSidePanelTab = useMemo(() => {
    const s = session ?? sessionFromHook;
    if (!sessionId || isGlobalSession(s ?? {})) return false;
    const status = s?.review_status;
    return status === 'running' || status === 'completed' || status === 'failed';
  }, [sessionId, session, sessionFromHook]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [createSessionError, setCreateSessionError] = useState(null);
  const [newSessionFormKey, setNewSessionFormKey] = useState(0);

  const rawMessages = useMemo(() => (hookMessages || []).map(parseMessageRow), [hookMessages]);
  const messages = useMemo(() => reconcileMessages(rawMessages), [rawMessages]);
  const systemPrompt = useMemo(
    () => rawMessages.find((m) => m.type === 'system' && m.subtype === 'prompt')?.content,
    [rawMessages]
  );

  // When switching sessions the resolved session (and therefore the messages keyed off
  // its id) lags behind the URL for a few renders. Treat that window as loading so the
  // chat shows a loader instead of the previous session's conversation.
  const switchingSession = !!short_id && !isNewSessionRoute && session?.short_id !== short_id;
  const chatLoading = switchingSession || messagesLoading;

  // If loadMore produced only hidden/filtered messages, keep pulling until something visible appears
  const activeViewTabRef = useRef(null);
  const viewTabsScrollRef = useRef(null);
  const prevMessagesLengthRef = useRef(null);
  useEffect(() => {
    if (loadingMore) {
      prevMessagesLengthRef.current = messages.length;
    } else if (prevMessagesLengthRef.current !== null) {
      if (messages.length === prevMessagesLengthRef.current && hasMore) {
        loadMore();
      }
      prevMessagesLengthRef.current = null;
    }
  }, [loadingMore, messages.length, hasMore, loadMore]);

  const [headerSnapshot, setHeaderSnapshot] = useState(null);
  const [headerAnimate, setHeaderAnimate] = useState(false);
  const fromNewSessionRef = useRef(isNewSessionRoute);

  useEffect(() => {
    if (isNewSessionRoute) {
      setSession(null);
      setPrInfo(null);
      return;
    }
    if (sessionFromHook) {
      setSession(sessionFromHook);
      if (sessionFromHook.pr_url) {
        setPrInfo({ url: sessionFromHook.pr_url, number: sessionFromHook.pr_number });
      } else {
        setPrInfo(null);
      }
      return;
    }
    const fromList = sessions.find((s) => s.short_id === short_id);
    if (fromList) setSession(fromList);
  }, [sessionFromHook, isNewSessionRoute, sessions, short_id]);

  useEffect(() => {
    if (session) setHeaderSnapshot(session);
  }, [session]);

  useLayoutEffect(() => {
    const wasNew = fromNewSessionRef.current;
    fromNewSessionRef.current = isNewSessionRoute;
    if (isNewSessionRoute || wasNew) {
      setHeaderAnimate(true);
      return;
    }
    setHeaderAnimate(false);
  }, [isNewSessionRoute]);

  useEffect(() => {
    setCreateSessionError(null);
  }, [short_id]);

  const tasks = useMemo(
    () =>
      (tasksFromHook || []).map((t) => ({
        id: t.id,
        pid: t.pid,
        command: t.command,
        label: t.label,
        task_key: t.task_key ?? null,
        created_at: t.created_at,
        exited_at: t.exited_at,
        ports: t.ports ?? {},
        status:
          killedTaskIds.has(t.id) && t.status === 'running' ? 'exited' : (t.status ?? 'running'),
        exitCode: t.exit_code,
      })),
    [tasksFromHook, killedTaskIds]
  );

  const views = useMemo(() => {
    if (isNewSessionRoute) return [...BASE_VIEWS, DETAILS_VIEW];
    if (isGlobalSession(session)) {
      return [BASE_VIEWS[0], DETAILS_VIEW];
    }
    const list = [...BASE_VIEWS];
    if (hasPreview) list.push(PREVIEW_VIEW);
    list.push(DETAILS_VIEW);
    return list;
  }, [isNewSessionRoute, session, hasPreview]);

  const viewTabStripKey = views.map((v) => v.id).join(',');

  const scrollActiveViewTabIntoView = useCallback(() => {
    const tab = activeViewTabRef.current;
    const scroller = viewTabsScrollRef.current;
    if (!tab || !scroller) return;
    const pad = 12;
    const scrollRect = scroller.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const tabStart = tabRect.left - scrollRect.left + scroller.scrollLeft;
    const tabEnd = tabStart + tabRect.width;
    const viewStart = scroller.scrollLeft;
    const viewEnd = viewStart + scroller.clientWidth;
    if (tabStart < viewStart + pad) {
      scroller.scrollLeft = Math.max(0, tabStart - pad);
    } else if (tabEnd > viewEnd - pad) {
      scroller.scrollLeft = tabEnd - scroller.clientWidth + pad;
    }
  }, []);

  const { commitsToPush, refreshCommitsToPush } = useSessionCommitsToPush(gitSession);

  useEffect(() => {
    if (!session) return;
    const url =
      session.agent_sdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    apiFetch(url)
      .then((d) => setModels(d.models || []))
      .catch(() => {});
  }, [session?.agent_sdk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sessionId) {
      setConfigCommands([]);
      return;
    }
    sessionsService
      .commands(sessionId)
      .then((d) => setConfigCommands(d.commands || []))
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    const onAppError = (msg) => {
      const text = msg.message || 'Something went wrong';
      toast.error(text);
      if (msg.sessionId && sessionId && msg.sessionId === sessionId) {
        setError(text);
      }
    };
    sessionsService.on('app:error', onAppError);
    return () => sessionsService.off('app:error', onAppError);
  }, [sessionId]);

  useEffect(() => {
    const onPushRequest = ({ sessionId: sid, branch, forceMode }) => {
      if (sid !== sessionId) return;
      setPushRequest({ branch, forceMode });
      setShowPushModal(true);
    };
    sessionsService.on('push:request', onPushRequest);
    return () => sessionsService.off('push:request', onPushRequest);
  }, [sessionId]);

  useEffect(() => {
    if (isNewSessionRoute || !short_id || sessionLoading) return;
    if (!sessionFromHook) navigate(homeUrl);
  }, [sessionLoading, short_id, sessionFromHook, navigate, homeUrl, isNewSessionRoute]);

  useEffect(() => {
    if (isNewSessionRoute || sessionLoading || !sessionFromHook?.id) return;
    if (sessionFromHook.short_id !== short_id) return;
    if (!sessionNeedsLastViewedUpdate(sessionFromHook)) return;
    const activityAt = sessionActivityAt(sessionFromHook);
    sessionsService.patch(sessionFromHook.id, { last_viewed_at: activityAt }).catch(() => {});
  }, [
    isNewSessionRoute,
    sessionLoading,
    sessionFromHook?.id,
    sessionFromHook?.short_id,
    sessionFromHook?.last_activity_at,
    sessionFromHook?.last_viewed_at,
    sessionFromHook?.updated_at,
    sessionFromHook?.created_at,
    short_id,
  ]);

  // Sync selectedRepo from URL so RepoPicker displays the current repo
  const sessionRepo = sessionFromHook?.repo_full_name;
  // Keep All sessions context on /sessions/:id so the logo and picker stay on `/`.
  useEffect(() => {
    if (fromAllSessions) {
      if (selectedRepo !== ALL_REPOS) setSelectedRepo(ALL_REPOS);
      return;
    }
    if (isGlobalSession(sessionFromHook)) {
      if (selectedRepo !== GLOBAL_SCOPE) setSelectedRepo(GLOBAL_SCOPE);
      return;
    }
    if (!sessionRepo) return;
    if (selectedRepo !== sessionRepo) setSelectedRepo(sessionRepo);
  }, [fromAllSessions, sessionFromHook, sessionRepo, selectedRepo, setSelectedRepo]);

  const handleModelChange = (modelId, modelParams = null) => {
    if (!session?.id) return;
    const patch = { model: modelId };
    if (modelParams !== null) patch.model_params = modelParams;
    sessionsService
      .patch(session.id, patch)
      .catch((err) => toastError('Failed to change model', err));
  };

  // Named .baguette.yaml task: the server resolves the command, ports and dependencies.
  const handleTaskStart = (taskKey) => {
    tasksService
      .create({ session_id: session?.id, task_key: taskKey })
      .catch((err) => toastError('Failed to start task', err));
  };

  // Ad-hoc command typed by the user — the only case where the client supplies a command.
  const handleCommandRun = (command) => {
    tasksService
      .create({ session_id: session?.id, command })
      .catch((err) => toastError('Failed to run command', err));
  };

  const handleTaskKill = (taskId) => {
    setKilledTaskIds((prev) => new Set([...prev, taskId]));
    tasksService.kill(taskId).catch((err) => toastError('Failed to kill task', err));
  };

  const handleTaskRetry = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    // Re-resolve a configured task from its name so it picks up any .baguette.yaml edit;
    // ad-hoc commands have no name and are replayed as-is.
    tasksService
      .create({
        session_id: session?.id,
        ...(task.task_key ? { task_key: task.task_key } : { command: task.command }),
      })
      .catch((err) => toastError('Failed to start task', err));
    setActiveTaskModal(null);
  };

  const handleTaskDelete = (taskId) => {
    tasksService.remove(taskId).catch((err) => toastError('Failed to delete task', err));
  };

  const handleViewTaskLogs = (taskId) => {
    setActiveTaskModal(taskId);
  };

  const handleAutoPushChange = (enabled) => {
    if (!session?.id) return;
    sessionsService
      .patch(session.id, { auto_push: enabled })
      .catch((err) => toastError('Failed to update auto-push setting', err));
  };

  const handlePush = () => {
    if (!session?.id || pushing) return;
    setShowPushModal(true);
  };

  const handlePushConfirmed = async ({ forceMode, branch } = {}) => {
    if (!session?.id || pushing) return;
    setShowPushModal(false);
    setPushRequest(null);
    setPushing(true);
    try {
      await sessionsService.push({ id: session.id, forceMode, branch });
      await refreshCommitsToPush();
      toast.success('Pushed successfully');
    } catch (err) {
      if (err.data?.conflict) {
        toastError('Push failed — use Git Sync to resolve conflicts first', err);
      } else {
        toastError('Push failed', err);
      }
    } finally {
      setPushing(false);
    }
  };

  const setSidePanelTab = useCallback(
    (tab, { openMobile = true } = {}) => {
      if (isNewSessionRoute || !SIDE_PANEL_TAB_IDS.has(tab)) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (activeView !== 'chat') next.set('view', activeView);
          else next.delete('view');
          next.set('panel', tab);
          return next;
        },
        { replace: true }
      );
      if (openMobile) setShowTasks(true);
    },
    [activeView, isNewSessionRoute, setSearchParams, setShowTasks]
  );

  useEffect(() => {
    if (showReviewerSidePanelTab || sidePanelTab !== 'reviewer') return;
    setSidePanelTab('tasks', { openMobile: false });
  }, [showReviewerSidePanelTab, sidePanelTab, setSidePanelTab]);

  const clearPanelFromUrl = useCallback(() => {
    setSearchParams(
      (prev) => {
        if (!prev.get('panel')) return prev;
        const next = new URLSearchParams(prev);
        next.delete('panel');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const hideSidePanel = useCallback(() => {
    if (isXlScreen) return;
    setShowTasks(false);
    clearPanelFromUrl();
  }, [setShowTasks, isXlScreen, clearPanelFromUrl]);

  const handleDiffCommitChange = useCallback(
    (sha) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('view', 'diff');
          if (sha && sha !== 'all') next.set('commit', sha);
          else next.delete('commit');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSelectCommitFromSidebar = useCallback(
    (sha) => {
      handleDiffCommitChange(sha);
    },
    [handleDiffCommitChange]
  );

  const toggleSidePanel = useCallback(() => {
    if (isXlScreen) return;
    if (showTasks) {
      hideSidePanel();
    } else {
      setSidePanelTab(sidePanelTab, { openMobile: true });
    }
  }, [showTasks, isXlScreen, hideSidePanel, setSidePanelTab, sidePanelTab]);

  const setView = useCallback(
    (view) => {
      if (isNewSessionRoute) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams();
          if (view !== 'chat') next.set('view', view);
          const prevPanel = prev.get('panel');
          const panelIsValid = prevPanel && SIDE_PANEL_TAB_IDS.has(prevPanel);
          if (view === 'diff') {
            const keepFilesOrCommits = prevPanel === 'files' || prevPanel === 'commits';
            next.set('panel', keepFilesOrCommits && panelIsValid ? prevPanel : 'files');
            const commit = prev.get('commit');
            if (commit) next.set('commit', commit);
          } else if (panelIsValid) {
            next.set('panel', prevPanel);
          }
          return next;
        },
        { replace: true }
      );
    },
    [isNewSessionRoute, setSearchParams]
  );

  const handleViewBaguetteConfig = useCallback(() => {
    setDetailsScrollTo('baguette-config');
    setView('details');
  }, [setView]);

  useEffect(() => {
    if (activeView !== 'details' || !detailsScrollTo) return;
    const timer = window.setTimeout(() => setDetailsScrollTo(null), 800);
    return () => window.clearTimeout(timer);
  }, [activeView, detailsScrollTo]);

  const builderIsGlobal = isNewSessionRoute
    ? !fromAllSessions && isGlobalSessionsRoute
    : fromAllSessions
      ? false
      : isGlobalSession(session);
  const builderRepoFullName = isNewSessionRoute
    ? fromAllSessions
      ? null
      : repoId
        ? (repos.find((r) => String(r.id) === String(repoId))?.full_name ?? null)
        : null
    : fromAllSessions
      ? null
      : isGlobalSession(session)
        ? null
        : session?.repo_full_name;
  const builderAllowRepoChoice = fromAllSessions;

  const handleCreateSession = async ({
    isGlobal,
    repoFullName,
    branch,
    initialPrompt,
    files,
    planMode,
    model,
    modelParams,
    createNewBranch,
    branchName,
    autoPush,
    plugins,
    agentSdk,
  }) => {
    const params = isGlobal
      ? {
          is_global: true,
          initial_prompt: initialPrompt,
          plan_mode: planMode,
        }
      : {
          repo_full_name: repoFullName,
          base_branch: branch,
          initial_prompt: initialPrompt,
          plan_mode: planMode,
          create_new_branch: createNewBranch ?? true,
          auto_push: autoPush ?? true,
        };
    if (agentSdk) params.agent_sdk = agentSdk;
    if (model) params.model = model;
    if (modelParams) params.model_params = modelParams;
    if (!isGlobal && branchName) params.branch_name = branchName;
    if (plugins?.length) params.plugins = plugins;
    if (files?.length) {
      try {
        params.initial_files = await Promise.all(files.map(fileToContentBlock));
      } catch (err) {
        setCreateSessionError(err?.message ?? 'Failed to read attached files');
        return false;
      }
    }
    setCreatingSession(true);
    setCreateSessionError(null);
    try {
      const created = await sessionsService.create(params);
      setNewSessionFormKey((k) => k + 1);
      navigate(sessionUrl(created.short_id));
      return true;
    } catch (err) {
      setCreateSessionError(err?.message ?? 'Failed to create session');
      return false;
    } finally {
      setCreatingSession(false);
    }
  };

  useEffect(() => {
    if (viewParam !== 'logs') return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('view');
        next.set('panel', 'logs');
        return next;
      },
      { replace: true }
    );
    setShowTasks(true);
  }, [short_id, viewParam, setSearchParams, setShowTasks]);

  useEffect(() => {
    if (panelParam === 'preview') {
      if (!isNewSessionRoute && sessionLoading && !(session ?? sessionFromHook)) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('panel');
          if (hasPreview) next.set('view', 'preview');
          return next;
        },
        { replace: true }
      );
      return;
    }
    if (viewParam === 'preview' && (session ?? sessionFromHook) && !hasPreview) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('view');
          return next;
        },
        { replace: true }
      );
      return;
    }
    if (panelParam && SIDE_PANEL_TAB_IDS.has(panelParam)) {
      setShowTasks(true);
    }
  }, [
    short_id,
    activeView,
    panelParam,
    viewParam,
    hasPreview,
    isNewSessionRoute,
    session,
    sessionFromHook,
    sessionLoading,
    setSearchParams,
  ]);

  const sidebarSessions = useMemo(() => {
    if (isNewSessionRoute || !session) return sessions;
    const readonly =
      !!session.archived_at || session.status === 'archiving' || session.status === 'archived';
    if (readonly && !sessions.some((s) => s.short_id === short_id)) {
      return sortSessionsForList([session, ...sessions.filter((s) => s.id !== session.id)]);
    }
    return sessions;
  }, [session, sessions, short_id, isNewSessionRoute]);

  const hideSessionListRepo = useMemo(() => {
    const keys = new Set(
      sidebarSessions.map((s) => (isGlobalSession(s) ? '__global__' : s.repo_full_name || ''))
    );
    return keys.size <= 1;
  }, [sidebarSessions]);

  const exitNewSessionRoute = () => {
    setCreateSessionError(null);
    const first = sidebarSessions.find(
      (s) => !s.archived_at && s.status !== 'archiving' && s.status !== 'archived'
    );
    if (first) navigate(sessionUrl(first.short_id));
    else navigate(homeUrl);
  };

  const awaitingSession = !isNewSessionRoute && Boolean(short_id) && !session;
  const headerSession = session ?? headerSnapshot;
  const headerOpen = Boolean(session) && !isNewSessionRoute;
  const headerTransitionClass = headerAnimate
    ? 'transition-[grid-template-rows] duration-300 ease-in-out'
    : '';
  const headerOpacityClass = headerAnimate ? 'transition-opacity duration-300' : '';

  const isReadonly =
    !isNewSessionRoute && (!!session?.archived_at || session?.status === 'archiving');
  const isArchiving =
    !isNewSessionRoute && !session?.archived_at && session?.status === 'archiving';

  const isMdUp = useMediaQuery('(min-width: 768px)');
  const isSidebarOpen = showSidebar !== false;
  const desktopSidebarWidthClass = showSidebar === false ? 'w-0 border-r-0' : 'w-64';

  useEffect(() => {
    if (!isMdUp) setShowSidebar(false);
  }, [isMdUp]);

  useLayoutEffect(() => {
    if (isNewSessionRoute) return;
    scrollActiveViewTabIntoView();
    const frame = requestAnimationFrame(() => {
      scrollActiveViewTabIntoView();
      requestAnimationFrame(scrollActiveViewTabIntoView);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeView, isNewSessionRoute, short_id, viewTabStripKey, scrollActiveViewTabIntoView]);

  const isSidePanelOpen = !isNewSessionRoute && (isXlScreen || showTasks);

  const handleViewTabClick = useCallback(
    (id) => {
      if (
        id === 'diff' &&
        activeView === 'diff' &&
        isSidePanelOpen &&
        (sidePanelTab === 'files' || sidePanelTab === 'commits')
      ) {
        setSidePanelTab(sidePanelTab === 'files' ? 'commits' : 'files', { openMobile: true });
        return;
      }
      setView(id);
    },
    [activeView, isSidePanelOpen, sidePanelTab, setSidePanelTab, setView]
  );

  const handleSelectDiffFile = useCallback(
    (file) => {
      const path = diffFileDisplayPath(file);
      if (activeView !== 'diff') setView('diff');
      setScrollToDiffFile(path);
    },
    [activeView, setView]
  );

  const clearScrollToDiffFile = useCallback(() => setScrollToDiffFile(null), []);

  const handleSidePanelResizeStart = (event) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startW = sidePanelWidth;
    const onMove = (ev) => {
      const max = Math.min(SIDE_PANEL_WIDTH_MAX, Math.floor(window.innerWidth * 0.65));
      const next = Math.round(
        Math.min(max, Math.max(SIDE_PANEL_WIDTH_MIN, startW + (startX - ev.clientX)))
      );
      setSidePanelWidth(next);
    };
    const onUp = () => {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  const suppressOpenSessionUnread =
    !isNewSessionRoute &&
    !sessionLoading &&
    sessionFromHook?.short_id === short_id &&
    sessionNeedsLastViewedUpdate(sessionFromHook);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className={`grid shrink-0 ${headerTransitionClass} ${
          headerOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`bg-surface border-b border-line pl-1 pr-3 py-2 ${headerOpacityClass} ${
              headerOpen ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {headerSession ? (
              <div className="flex items-start justify-between gap-2 min-h-11">
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                  <Link to={homeUrl} className="shrink-0 text-faint hover:text-secondary mt-0.5">
                    <ChevronLeft className="w-5 h-5" />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-h-6 min-w-0 items-center gap-2">
                      <SessionStatusIndicator session={headerSession} />
                      <span className="min-w-0 truncate text-sm font-medium leading-snug text-fg">
                        {headerSession.label ||
                          (isGlobalSession(headerSession)
                            ? 'Global session'
                            : headerSession.repo_full_name)}
                      </span>
                      {headerSession.loop_id ? (
                        <SessionLoopBadge to={loopEditUrl(headerSession.loop_id)} />
                      ) : null}
                      {showRepoDetails ? (
                        <CardRepoBadge
                          show
                          truncate={false}
                          nowrap
                          className="hidden sm:inline-flex"
                          isGlobal={isGlobalSession(headerSession)}
                          repoFullName={headerSession.repo_full_name}
                        />
                      ) : null}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="hidden sm:inline shrink-0 text-faint">
                        {headerSession.base_branch}
                      </span>
                      {(headerSession.remote_branch || headerSession.local_branch) && (
                        <span className="flex min-w-0 items-center gap-1 overflow-hidden text-faint">
                          <GitBranch className="w-3 h-3 shrink-0" />
                          <span className="truncate">
                            {headerSession.remote_branch || headerSession.local_branch}
                          </span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(
                                headerSession.remote_branch || headerSession.local_branch
                              );
                              toast.success('Branch name copied');
                            }}
                            className="shrink-0 text-faint hover:text-fg-muted"
                            title="Copy branch name"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <SessionTools
                  session={headerSession}
                  tools={['pr', 'preview', 'code', 'push']}
                  hideLabelBelowSm
                  readonly={!!headerSession.archived_at || headerSession.status === 'archiving'}
                  onPush={handlePush}
                  pushing={pushing}
                  commitsToPush={commitsToPush}
                  prUrl={session ? prInfo?.url : headerSession.pr_url}
                  prNumber={session ? prInfo?.number : headerSession.pr_number}
                  showPreviewPublicBadge
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {session && isArchiving && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-control/80 border-b border-strong text-fg-muted text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-accent/80" />
          <span>Archiving session — removing worktree…</span>
        </div>
      )}
      {session && isReadonly && session.archived_at && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-control/80 border-b border-strong text-fg-muted text-xs">
          <span>This session has been deleted — read only</span>
        </div>
      )}

      {error && (
        <div
          className={`shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 rounded-none border-x-0 border-t-0 ${BANNER_DANGER} text-sm`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 p-1 rounded hover:bg-danger/50 text-danger"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sidebar (full height) + main column (tabs + views + tasks) */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Sessions sidebar — md+ only (use dashboard / nav to switch sessions on mobile) */}
        <div
          className={`hidden md:block shrink-0 min-h-0 overflow-hidden border-r border-line bg-nav transition-[width] duration-300 ease-in-out ${desktopSidebarWidthClass}`}
        >
          <div className="flex h-full min-h-0 w-64 flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-line flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setCreateSessionError(null);
                  navigate(sessionUrl(NEW_SESSION_ROUTE_ID));
                }}
                className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-heading transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>New session</span>
              </button>
              <button
                onClick={() => setShowSidebar(false)}
                className="text-faint hover:text-fg-muted transition-colors p-0.5"
                title="Hide sidebar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              {sidebarSessions.map((s) => (
                <MiniSessionEntry
                  key={s.id}
                  session={s}
                  currentId={isNewSessionRoute ? null : short_id}
                  hideRepoBadge={hideSessionListRepo}
                  suppressUnreadWhenOpen={s.short_id === short_id && suppressOpenSessionUnread}
                  onArchive={(archived) => {
                    if (archived.short_id !== short_id || showArchived) return;
                    const firstSession = nextVisibleSession({
                      sessions,
                      short_id,
                      session,
                      repoId,
                      fromAllSessions,
                    });
                    navigate(firstSession ? sessionUrl(firstSession.short_id) : homeUrl);
                  }}
                />
              ))}
              {hasMoreSessions && sessions.length > 0 && (
                <button
                  onClick={loadMoreSessions}
                  className="w-full px-3 py-2 text-xs text-faint hover:text-fg-muted transition-colors text-left"
                >
                  Load more
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* View tabs — only above chat/diff/logs + tasks */}
          <div className="flex shrink-0 items-center border-b border-line bg-nav px-3 sm:px-4">
            <button
              type="button"
              onClick={() => setShowSidebar(!isSidebarOpen)}
              className="hidden md:flex items-center justify-center mr-1 shrink-0 text-faint hover:text-secondary transition-colors"
              title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <div className="relative min-w-0 flex-1">
              <div
                ref={viewTabsScrollRef}
                className="flex overflow-x-auto gap-1 scrollbar-none pr-4"
              >
                {views.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    ref={activeView === id && !isNewSessionRoute ? activeViewTabRef : null}
                    type="button"
                    disabled={isNewSessionRoute}
                    onClick={() => handleViewTabClick(id)}
                    className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors -mb-px disabled:cursor-not-allowed disabled:opacity-40 ${
                      activeView === id && !isNewSessionRoute
                        ? 'border-brand text-accent'
                        : 'border-transparent text-faint hover:text-heading disabled:hover:text-faint'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {id === 'review' && openIssuesTabCount > 0 && (
                      <span className="min-w-4 h-4 px-1 rounded-full bg-brand text-on-brand text-[10px] font-bold leading-4">
                        {openIssuesTabCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div
                className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-nav via-nav/80 to-transparent"
                aria-hidden
              />
            </div>
            <button
              type="button"
              disabled={isNewSessionRoute}
              onClick={toggleSidePanel}
              className={`xl:hidden flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                !isNewSessionRoute &&
                sidePanelTab === 'reviewer' &&
                session?.review_status === 'running' &&
                !showTasks
                  ? 'text-accent motion-safe:animate-pulse'
                  : 'text-faint hover:text-heading'
              }`}
              title={showTasks ? 'Hide side panel' : 'Show side panel'}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {isNewSessionRoute && (
              <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-page">
                {creatingSession && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-page/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 animate-spin text-accent" />
                      <p className="text-sm font-medium text-fg">Starting your agent session…</p>
                      <p className="text-xs text-fg-muted">
                        This usually only takes a few seconds.
                      </p>
                    </div>
                  </div>
                )}
                <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium text-heading">New session</h2>
                    <button
                      type="button"
                      onClick={exitNewSessionRoute}
                      className="text-faint hover:text-secondary p-1 rounded"
                      aria-label="Close new session form"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {createSessionError && (
                    <div className="mb-4 bg-soft-danger/30 border border-danger/50 rounded-md px-3 sm:px-4 py-3 text-sm text-danger">
                      <div className="flex items-start justify-between gap-2">
                        <p className="break-all">{createSessionError}</p>
                        <button
                          type="button"
                          onClick={() => setCreateSessionError(null)}
                          className="text-danger hover:text-danger shrink-0 text-lg leading-none"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  )}
                  <BuilderForm
                    key={`session-new-${newSessionFormKey}-${builderAllowRepoChoice ? 'all' : (builderRepoFullName ?? 'global')}`}
                    onSubmit={handleCreateSession}
                    loading={creatingSession}
                    repoFullName={builderRepoFullName}
                    isGlobal={builderIsGlobal}
                    allowRepoChoice={builderAllowRepoChoice}
                  />
                </div>
              </div>
            )}
            {/* Active view */}
            {awaitingSession && (
              <div className="flex flex-1 min-h-0 items-center justify-center bg-page">
                <Loader2
                  className="w-8 h-8 animate-spin text-accent"
                  aria-label="Loading session"
                />
              </div>
            )}
            {!isNewSessionRoute && !awaitingSession && session && activeView === 'chat' && (
              <ChatView
                messages={messages}
                loading={chatLoading}
                loadMore={loadMore}
                loadingMore={loadingMore}
                hasMore={hasMore}
                session={session}
                systemPrompt={systemPrompt}
                onViewChange={setView}
                readonly={isReadonly}
                models={models}
                onModelChange={handleModelChange}
                onAutoPushChange={handleAutoPushChange}
                cursorModelPrefs={cursorModelPrefs}
                onCursorModelPrefChange={setCursorModelPref}
              />
            )}
            {!isNewSessionRoute && !awaitingSession && session && activeView === 'review' && (
              <ReviewView
                session={session}
                readonly={isReadonly}
                issues={sessionIssues}
                issuesLoading={sessionIssuesLoading}
                reviewerDrawerOpen={isXlScreen || showTasks}
                reviewerPanelActive={isSidePanelOpen && sidePanelTab === 'reviewer'}
                onOpenReviewer={() => setSidePanelTab('reviewer')}
              />
            )}
            {!isNewSessionRoute && !awaitingSession && session && activeView === 'diff' && (
              <DiffView
                session={session}
                selectedCommit={selectedDiffCommit}
                commits={branchCommits}
                onSelectedCommitChange={handleDiffCommitChange}
                onRefreshCommits={refreshBranchCommits}
                onRefreshChangedFiles={refreshChangedFiles}
                commitsLoading={branchCommitsLoading}
                changedFilesLoading={changedFilesLoading}
                scrollToFile={scrollToDiffFile}
                onScrolledToFile={clearScrollToDiffFile}
                readonly={isReadonly}
                models={models}
                onModelChange={handleModelChange}
                cursorModelPrefs={cursorModelPrefs}
                onCursorModelPrefChange={setCursorModelPref}
              />
            )}
            {!isNewSessionRoute && !awaitingSession && session && activeView === 'preview' && (
              <PreviewView
                session={session}
                readonly={isReadonly}
                onViewLogs={handleViewTaskLogs}
              />
            )}
            {!isNewSessionRoute && !awaitingSession && session && activeView === 'details' && (
              <DetailsView
                session={session}
                readonly={isReadonly}
                onSessionUpdate={setSession}
                scrollToSection={detailsScrollTo}
              />
            )}
          </div>

          {!isNewSessionRoute && (
            <SessionMainViewFooter
              session={session}
              onShowTasks={() => setSidePanelTab('tasks')}
              onShowReviewer={() => setSidePanelTab('reviewer')}
            />
          )}
        </div>

        {/* Task / files / reviewer panel — drawer below md, inline column md+ */}
        {showTasks && !isXlScreen && !isNewSessionRoute && (
          <div
            className="md:hidden fixed inset-0 z-30 bg-black/50"
            onClick={hideSidePanel}
            aria-hidden={false}
          />
        )}
        {isSidePanelOpen && (
          <div
            className={`flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-line bg-nav fixed inset-y-0 right-0 z-40 w-[85vw] max-w-sm md:relative md:inset-auto md:z-auto md:w-[var(--side-panel-w)] md:max-w-[min(85vw,100%)] ${
              sidePanelTab === 'reviewer' ? 'max-w-xl md:max-w-[min(85vw,100%)]' : ''
            }`}
            style={{ '--side-panel-w': `${sidePanelWidth}px` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize side panel"
              onPointerDown={handleSidePanelResizeStart}
              className="hidden md:block absolute left-0 top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none hover:bg-brand/50 active:bg-brand/70"
            />
            <SessionSidePanel
              sidePanelTab={sidePanelTab}
              onSidePanelTabChange={setSidePanelTab}
              onClose={hideSidePanel}
              session={session}
              isGlobal={isGlobalSession(session)}
              readonly={isReadonly}
              sidePanelOpen={isSidePanelOpen}
              diffFiles={diffFiles}
              changedFilesLoading={changedFilesLoading}
              onRefreshChangedFiles={refreshChangedFiles}
              onSelectDiffFile={handleSelectDiffFile}
              branchCommits={branchCommits}
              branchCommitsLoading={branchCommitsLoading}
              onRefreshBranchCommits={refreshBranchCommits}
              selectedDiffCommit={selectedDiffCommit}
              onSelectCommit={handleSelectCommitFromSidebar}
              tasks={tasks}
              configCommands={configCommands}
              onStartTask={handleTaskStart}
              onRunCommand={handleCommandRun}
              onKill={handleTaskKill}
              onDelete={handleTaskDelete}
              onRetry={handleTaskRetry}
              onViewLogs={handleViewTaskLogs}
              onViewBaguetteConfig={handleViewBaguetteConfig}
              showBaguetteConfigLink={!isGlobalSession(session)}
              rawMessages={rawMessages}
              loadMore={loadMore}
              loadingMore={loadingMore}
              hasMore={hasMore}
              sessionId={sessionId}
              showReviewerTab={showReviewerSidePanelTab}
            />
          </div>
        )}
      </div>

      {/* Task Log Modal */}
      {showPushModal && (
        <PushConfirmModal
          sessionId={session?.id}
          repo={repos.find((r) => r.full_name === session?.repo_full_name) ?? null}
          commitsToPush={commitsToPush}
          initialBranch={pushRequest?.branch || session?.remote_branch || session?.local_branch}
          initialForceMode={pushRequest?.forceMode || null}
          autoPush={!!session?.auto_push}
          onAutoPushChange={handleAutoPushChange}
          onConfirm={handlePushConfirmed}
          onCancel={() => {
            setShowPushModal(false);
            setPushRequest(null);
          }}
        />
      )}
      {activeTaskModal != null && (
        <TaskLogModal
          task={tasks.find((t) => t.id === activeTaskModal)}
          session={{
            id: session.id,
            short_id: session.short_id,
            label: session.label,
            repo_full_name: session.repo_full_name,
          }}
          onKill={handleTaskKill}
          onRetry={handleTaskRetry}
          onClose={() => setActiveTaskModal(null)}
        />
      )}
    </div>
  );
}
