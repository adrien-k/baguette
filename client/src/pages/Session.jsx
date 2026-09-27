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
} from 'lucide-react';
import BuilderForm from '../components/BuilderForm.jsx';
import { fileToContentBlock } from '../utils/fileToContentBlock.js';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useFilters } from '../context/FilterContext.jsx';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import { splitRepoPath } from '../utils/paths.js';
import { apiFetch } from '../api.js';
import { sessionsService, tasksService } from '../feathers.js';
import { useGetSession } from '../hooks/useGetSession.js';
import { useGetMessages } from '../hooks/useGetMessages.js';
import { useGetTasks } from '../hooks/useGetTasks.js';
import { useGetSessionIssues } from '../hooks/useGetSessionIssues.js';
import TaskPanel from '../components/TaskPanel.jsx';
import LightChipDropdown from '../components/LightChipDropdown.jsx';
import LogsView from './session/LogsView.jsx';
import TaskLogModal from '../components/TaskLogModal.jsx';
import ArchiveSession from '../components/ArchiveSession.jsx';
import PushConfirmModal from '../components/PushConfirmModal.jsx';
import ChatView from './session/ChatView.jsx';
import DiffView from './session/DiffView.jsx';
import PreviewView from './session/PreviewView.jsx';
import ReviewView from './session/ReviewView.jsx';
import ReviewAgentPanel from './session/ReviewAgentPanel.jsx';
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

const TASK_PANEL_WIDTH_DEFAULT = 320;
const REVIEW_PANEL_WIDTH_DEFAULT = 480;
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

function MiniSessionEntry({ session: s, currentId, onArchive, hideRepoBadge = false }) {
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
      } ${isCurrent ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}`}
    >
      <div className="flex items-center gap-2">
        <SessionStatusIndicator session={s} />
        <Link to={sessionUrl(s.short_id)} className="flex-1 min-w-0 leading-snug text-left">
          {showRepo && (
            <span className="block truncate">
              <CardRepoBadge show isGlobal={isGlobalSession(s)} repoFullName={s.repo_full_name} />
            </span>
          )}
          <span
            className={`block truncate font-medium ${isCurrent ? 'text-white' : 'text-zinc-200'}`}
          >
            {title}
          </span>
          {promptPreview && (
            <span className="block truncate text-[11px] text-zinc-500">{promptPreview}</span>
          )}
        </Link>
        {isArchiving && <span className="shrink-0 text-[10px] text-amber-400/90">Archiving…</span>}
        {!s.archived_at && !isArchiving && s.status !== 'provisioning' && (
          <div className="shrink-0">
            <ArchiveSession session={s} onArchive={() => onArchive?.(s)} />
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
const CHAT_PANEL_TABS = new Set(['tasks', 'logs', 'preview']);

function chatSidePanelTabFromParam(panelParam, hasPreview) {
  if (panelParam === 'logs') return 'logs';
  if (panelParam === 'preview' && hasPreview) return 'preview';
  return 'tasks';
}

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
  const { homeUrl, sessionUrl } = useFilterRoutes();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const activeView = viewParam === 'logs' || viewParam === 'preview' ? 'chat' : viewParam || 'chat';
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
  const { issues: sessionIssues } = useGetSessionIssues(sessionId);

  const [session, setSession] = useState(null);
  const [prInfo, setPrInfo] = useState(null);
  const [killedTaskIds, setKilledTaskIds] = useState(new Set());
  const [showTasks, setShowTasks] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  );
  const isXlScreen = useMediaQuery('(min-width: 1280px)');
  const [showSidebar, setShowSidebar] = useState(null);
  const sidePanelPersist = usePersistentState('session-side-panel');
  const [tasksPanelWidth, setTasksPanelWidth] = sidePanelPersist.useState(
    'tasksWidth',
    TASK_PANEL_WIDTH_DEFAULT
  );
  const [reviewPanelWidth, setReviewPanelWidth] = sidePanelPersist.useState(
    'reviewWidth',
    REVIEW_PANEL_WIDTH_DEFAULT
  );
  const [diffFiles, setDiffFiles] = useState([]);
  const [models, setModels] = useState([]);
  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const [pushing, setPushing] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushRequest, setPushRequest] = useState(null);
  const [activeTaskModal, setActiveTaskModal] = useState(null);
  const [configCommands, setConfigCommands] = useState([]);
  const [error, setError] = useState(null);
  const panelParam = searchParams.get('panel');
  const hasPreview = !!(session ?? sessionFromHook)?.preview_url;
  const chatSidePanelTab = chatSidePanelTabFromParam(panelParam, hasPreview);
  const chatSidePanelOptions = useMemo(() => {
    const options = [
      { value: 'tasks', label: 'Tasks' },
      { value: 'logs', label: 'Logs' },
    ];
    if (hasPreview) options.push({ value: 'preview', label: 'Preview' });
    return options;
  }, [hasPreview]);
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
    if (isNewSessionRoute) return BASE_VIEWS;
    if (isGlobalSession(session)) {
      return BASE_VIEWS.filter((v) => v.id === 'chat');
    }
    return [...BASE_VIEWS];
  }, [isNewSessionRoute, session]);

  const [commitsToPush, setCommitsToPush] = useState(0);
  const [commitsSinceReview, setCommitsSinceReview] = useState(0);

  useEffect(() => {
    if (
      !sessionId ||
      session?.is_global ||
      session?.status === 'provisioning' ||
      session?.status === 'archiving' ||
      session?.status === 'archived'
    ) {
      setCommitsToPush(0);
      setCommitsSinceReview(0);
      return;
    }
    sessionsService
      .sessionGitStatus(sessionId)
      .then((res) => {
        setCommitsToPush(res.commitsToPush ?? 0);
        setCommitsSinceReview(res.commitsSinceReview ?? 0);
      })
      .catch(() => {});
  }, [
    sessionId,
    session?.is_global,
    session?.status,
    session?.last_reviewed_commit_sha,
    session?.review_status,
  ]);

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
      const status = await sessionsService.sessionGitStatus(session.id);
      setCommitsToPush(status.commitsToPush ?? 0);
      setCommitsSinceReview(status.commitsSinceReview ?? 0);
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

  const setChatSidePanel = useCallback(
    (tab, { openMobile = true } = {}) => {
      if (isNewSessionRoute || activeView !== 'chat') return;
      if (tab === 'preview' && !hasPreview) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('view');
          next.set('panel', tab);
          return next;
        },
        { replace: true }
      );
      if (openMobile) setShowTasks(true);
    },
    [activeView, hasPreview, isNewSessionRoute, setSearchParams, setShowTasks]
  );

  const hideSidePanel = useCallback(() => {
    if (isXlScreen) return;
    setShowTasks(false);
  }, [setShowTasks, isXlScreen]);

  const toggleSidePanel = useCallback(() => {
    if (isXlScreen) return;
    setShowTasks((open) => !open);
  }, [setShowTasks, isXlScreen]);

  const setView = (view) => {
    if (isNewSessionRoute) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams();
        if (view !== 'chat') {
          next.set('view', view);
        } else {
          const panel = prev.get('panel');
          if (CHAT_PANEL_TABS.has(panel) && (panel !== 'preview' || hasPreview)) {
            next.set('panel', panel);
          }
        }
        return next;
      },
      { replace: true }
    );
  };

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
    if (viewParam !== 'logs' && viewParam !== 'preview') return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('view');
        next.set('panel', viewParam === 'preview' ? 'preview' : 'logs');
        return next;
      },
      { replace: true }
    );
    setShowTasks(true);
  }, [short_id, viewParam, setSearchParams, setShowTasks]);

  useEffect(() => {
    if (panelParam === 'preview' && !hasPreview) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('panel');
          return next;
        },
        { replace: true }
      );
      return;
    }
    if (activeView === 'chat' && panelParam) {
      setShowTasks(true);
    }
  }, [short_id, activeView, panelParam, hasPreview, setSearchParams]);

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

  const isReviewPanel = activeView === 'review';
  const isSidePanelOpen = !isNewSessionRoute && (isXlScreen || showTasks);
  const sidePanelWidth = isReviewPanel ? reviewPanelWidth : tasksPanelWidth;
  const setSidePanelWidth = isReviewPanel ? setReviewPanelWidth : setTasksPanelWidth;
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
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className={`grid shrink-0 ${headerTransitionClass} ${
          headerOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`bg-zinc-900 border-b border-zinc-800 px-3 sm:px-4 py-2 ${headerOpacityClass} ${
              headerOpen ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {headerSession ? (
              <div className="flex items-center justify-between gap-2 min-h-[2.75rem]">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <Link
                    to={homeUrl}
                    className="text-zinc-500 hover:text-zinc-300 shrink-0 md:hidden"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </Link>
                  <div className="min-w-0">
                    <div className="flex min-h-6 flex-nowrap items-center gap-2">
                      <SessionStatusIndicator session={headerSession} />
                      <span className="min-w-0 truncate text-sm font-medium leading-snug text-zinc-300">
                        {headerSession.label ||
                          (isGlobalSession(headerSession)
                            ? 'Global session'
                            : headerSession.repo_full_name)}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="hidden sm:inline shrink-0 text-zinc-600">
                        {headerSession.base_branch}
                      </span>
                      {(headerSession.remote_branch || headerSession.local_branch) && (
                        <span className="flex min-w-0 items-center gap-1 overflow-hidden text-zinc-500">
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
                            className="shrink-0 text-zinc-600 hover:text-zinc-400"
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
                  onPush={headerSession.auto_push ? undefined : handlePush}
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
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-800/80 border-b border-zinc-700 text-zinc-400 text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-amber-400/80" />
          <span>Archiving session — removing worktree…</span>
        </div>
      )}
      {session && isReadonly && session.archived_at && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-800/80 border-b border-zinc-700 text-zinc-400 text-xs">
          <span>This session has been deleted — read only</span>
        </div>
      )}

      {error && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-red-900/30 border-b border-red-700 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 p-1 rounded hover:bg-red-800/50 text-red-400"
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
          className={`hidden md:block shrink-0 min-h-0 overflow-hidden border-r border-zinc-800 bg-zinc-900 transition-[width] duration-300 ease-in-out ${desktopSidebarWidthClass}`}
        >
          <div className="flex h-full min-h-0 w-64 flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setCreateSessionError(null);
                  navigate(sessionUrl(NEW_SESSION_ROUTE_ID));
                }}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>New session</span>
              </button>
              <button
                onClick={() => setShowSidebar(false)}
                className="text-zinc-600 hover:text-zinc-400 transition-colors p-0.5"
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
                  className="w-full px-3 py-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors text-left"
                >
                  Load more
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* View tabs — only above chat/diff/logs + tasks */}
          <div className="flex shrink-0 items-center border-b border-zinc-800 bg-zinc-900 px-3 sm:px-4">
            <button
              type="button"
              onClick={() => setShowSidebar(!isSidebarOpen)}
              className="hidden md:flex items-center justify-center mr-1 shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
              title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <div className="flex overflow-x-auto gap-1 min-w-0 flex-1 scrollbar-none">
              {views.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={isNewSessionRoute}
                  onClick={() => setView(id)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors -mb-px disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeView === id && !isNewSessionRoute
                      ? 'border-amber-500 text-amber-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300 disabled:hover:text-zinc-500'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {id === 'review' &&
                    sessionIssues.filter((i) => i.status === 'opened').length > 0 && (
                      <span className="min-w-4 h-4 px-1 rounded-full bg-amber-500 text-zinc-950 text-[10px] font-bold leading-4">
                        {sessionIssues.filter((i) => i.status === 'opened').length}
                      </span>
                    )}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={isNewSessionRoute}
              onClick={toggleSidePanel}
              className="xl:hidden ml-auto flex items-center justify-center shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              title={showTasks ? 'Hide side panel' : 'Show side panel'}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {isNewSessionRoute && (
              <div className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-zinc-950">
                {creatingSession && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
                      <p className="text-sm font-medium text-zinc-100">
                        Starting your agent session…
                      </p>
                      <p className="text-xs text-zinc-400">
                        This usually only takes a few seconds.
                      </p>
                    </div>
                  </div>
                )}
                <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium text-zinc-200">New session</h2>
                    <button
                      type="button"
                      onClick={exitNewSessionRoute}
                      className="text-zinc-500 hover:text-zinc-300 p-1 rounded"
                      aria-label="Close new session form"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {createSessionError && (
                    <div className="mb-4 bg-red-900/30 border border-red-700 rounded-md px-3 sm:px-4 py-3 text-sm text-red-400">
                      <div className="flex items-start justify-between gap-2">
                        <p className="break-all">{createSessionError}</p>
                        <button
                          type="button"
                          onClick={() => setCreateSessionError(null)}
                          className="text-red-400 hover:text-red-200 shrink-0 text-lg leading-none"
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
              <div className="flex flex-1 min-h-0 items-center justify-center bg-zinc-950">
                <Loader2
                  className="w-8 h-8 animate-spin text-amber-400"
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
                commitsSinceReview={commitsSinceReview}
                onReviewStarted={() => setShowTasks(true)}
              />
            )}
            {!isNewSessionRoute && !awaitingSession && session && activeView === 'diff' && (
              <DiffView
                session={session}
                onFilesChange={setDiffFiles}
                readonly={isReadonly}
                models={models}
                onModelChange={handleModelChange}
                cursorModelPrefs={cursorModelPrefs}
                onCursorModelPrefChange={setCursorModelPref}
              />
            )}
          </div>
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
            className={`flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-zinc-800 bg-zinc-900 fixed inset-y-0 right-0 z-40 w-[85vw] max-w-sm md:relative md:inset-auto md:z-auto md:w-[var(--side-panel-w)] md:max-w-[min(85vw,100%)] ${
              isReviewPanel ? 'max-w-xl md:max-w-[min(85vw,100%)]' : ''
            }`}
            style={{ '--side-panel-w': `${sidePanelWidth}px` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize side panel"
              onPointerDown={handleSidePanelResizeStart}
              className="hidden md:block absolute left-0 top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none hover:bg-amber-500/50 active:bg-amber-500/70"
            />
            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
              {activeView === 'chat' ? (
                <LightChipDropdown
                  value={chatSidePanelTab}
                  onChange={(tab) => setChatSidePanel(tab)}
                  layout="list"
                  options={chatSidePanelOptions}
                  ariaLabel="Side panel"
                  triggerClassName="font-medium"
                />
              ) : (
                <h3 className="text-sm font-medium text-zinc-300">
                  {activeView === 'diff' ? 'Files' : activeView === 'review' ? 'Reviewer' : 'Tasks'}
                </h3>
              )}
              <button
                type="button"
                onClick={hideSidePanel}
                className="xl:hidden text-zinc-600 hover:text-zinc-400 transition-colors p-0.5 shrink-0"
                title="Hide side panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {activeView === 'diff' ? (
              <div className="flex-1 overflow-auto min-h-0">
                {diffFiles.length === 0 ? (
                  <p className="text-xs text-zinc-500 px-3 py-4">No files changed</p>
                ) : (
                  diffFiles.map((file, i) => {
                    const displayPath = file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
                    const { basename, dirname } = splitRepoPath(displayPath);
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          hideSidePanel();
                          document
                            .getElementById(`diff-file-${i}`)
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="w-full flex items-start justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-800 transition-colors border-b border-zinc-800/50"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-mono text-xs text-zinc-300 truncate block">
                            {basename}
                          </span>
                          {dirname ? (
                            <span className="font-mono text-[10px] text-zinc-500 truncate block mt-0.5">
                              {dirname}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          <span className="text-xs text-emerald-400">+{file.addedCount}</span>
                          <span className="text-xs text-red-400">-{file.removedCount}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            ) : activeView === 'review' ? (
              <ReviewAgentPanel
                session={session}
                readonly={isReadonly}
                sidePanelOpen={isSidePanelOpen}
              />
            ) : activeView === 'chat' && chatSidePanelTab === 'logs' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <LogsView
                  rawMessages={rawMessages}
                  loadMore={loadMore}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  resetKey={sessionId}
                />
              </div>
            ) : activeView === 'chat' && chatSidePanelTab === 'preview' ? (
              <PreviewView
                session={session}
                readonly={isReadonly}
                onViewLogs={handleViewTaskLogs}
                compact
              />
            ) : (
              <TaskPanel
                tasks={tasks}
                configCommands={configCommands}
                onStartTask={handleTaskStart}
                onRunCommand={handleCommandRun}
                onKill={handleTaskKill}
                onDelete={handleTaskDelete}
                onRetry={handleTaskRetry}
                onViewLogs={handleViewTaskLogs}
                readonly={isReadonly}
              />
            )}
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
