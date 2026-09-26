import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  MoreVertical,
  FolderOpen,
  X,
  Plus,
  AlertCircle,
  MessageSquare,
  ScrollText,
  GitBranch,
  Copy,
  Archive,
  Loader2,
  PanelLeft,
  PanelRight,
  Pencil,
  Upload,
  MonitorPlay,
  ClipboardCheck,
} from 'lucide-react';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useFilters } from '../context/FilterContext.jsx';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import { splitRepoPath } from '../utils/paths.js';
import { apiFetch } from '../api.js';
import { sessionsService, tasksService, messagesService } from '../feathers.js';
import { useGetSession } from '../hooks/useGetSession.js';
import { useGetMessages } from '../hooks/useGetMessages.js';
import { useGetTasks } from '../hooks/useGetTasks.js';
import { useGetSessionIssues } from '../hooks/useGetSessionIssues.js';
import TaskPanel from '../components/TaskPanel.jsx';
import TaskLogModal from '../components/TaskLogModal.jsx';
import ArchiveSession from '../components/ArchiveSession.jsx';
import PushConfirmModal from '../components/PushConfirmModal.jsx';
import ChatView from './session/ChatView.jsx';
import DiffView from './session/DiffView.jsx';
import LogsView from './session/LogsView.jsx';
import EditView from './session/EditView.jsx';
import PreviewView from './session/PreviewView.jsx';
import ReviewView from './session/ReviewView.jsx';
import ReviewAgentPanel from './session/ReviewAgentPanel.jsx';
import PrStatusBadge from '../components/PrStatusBadge.jsx';
import SessionToolLink from '../components/SessionToolLink.jsx';
import Toggle from '../components/Toggle.jsx';
import { useCursorModelPrefs } from '../hooks/useAgentPreferences.js';
import { isGlobalSession, isAllSessionsPath } from '@baguette/shared/session-scope.js';
import { DROPDOWN_PANEL_CLASS } from '../utils/dropdownPanel.js';
import {
  createFileReferenceBlock,
  fileReferenceAgentText,
} from '@baguette/shared/user-message-content.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import { usePersistentState } from '../hooks/usePersistentState.js';
import CardRepoBadge from '../components/CardRepoBadge.jsx';

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

/** Matches sidebar + session header — archive icon vs status dot */
function SessionStatusIndicator({ session }) {
  const isArchived = !!session.archived_at;
  const isArchiving = !isArchived && session.status === 'archiving';
  const statusColor =
    {
      running: 'bg-emerald-400 animate-pulse',
      provisioning: 'bg-zinc-400 animate-pulse',
      archiving: 'bg-amber-400 animate-pulse',
      approval: 'bg-amber-400 animate-pulse',
      completed: 'bg-emerald-400',
      stopped: 'bg-zinc-500',
      failed: 'bg-red-400',
      error: 'bg-red-400',
    }[session.status] || 'bg-zinc-600';

  if (isArchived) {
    return <Archive className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden />;
  }
  if (isArchiving) {
    return <Loader2 className="w-3 h-3 text-amber-400/80 animate-spin shrink-0" aria-hidden />;
  }
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />;
}

function MiniSessionEntry({ session: s, currentId, onArchive }) {
  const isArchived = !!s.archived_at;
  const isArchiving = !isArchived && s.status === 'archiving';
  const { sessionUrl, showRepoDetails } = useFilterRoutes();

  return (
    <div
      className={`group px-3 py-2 text-xs transition-colors ${
        isArchived || isArchiving ? 'opacity-50' : ''
      } ${
        s.short_id === currentId
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      }`}
    >
      <div className="flex items-start gap-2">
        <Link to={sessionUrl(s.short_id)} className="flex-1 min-w-0 leading-snug text-left">
          {showRepoDetails && (
            <span className="mb-1 block truncate">
              <CardRepoBadge show isGlobal={isGlobalSession(s)} repoFullName={s.repo_full_name} />
            </span>
          )}
          <span className="flex items-center gap-2">
            <SessionStatusIndicator session={s} />
            <span className="line-clamp-2 wrap-break-word">
              {s.label || (isGlobalSession(s) ? 'Global session' : s.repo_full_name)}
            </span>
          </span>
        </Link>
        {isArchiving && <span className="shrink-0 text-[10px] text-amber-400/90">Archiving…</span>}
        {s.pr_status && <PrStatusBadge status={s.pr_status} prUrl={s.pr_url} />}
        {!s.archived_at && !isArchiving && s.status !== 'provisioning' && (
          <div className="opacity-100 shrink-0">
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
  { id: 'logs', label: 'Logs', Icon: ScrollText },
  { id: 'edit', label: 'Edit', Icon: Pencil },
];
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
  const fromAllSessions = isAllSessionsPath(pathname);
  const { homeUrl, sessionUrl } = useFilterRoutes();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') || 'chat';
  const { sessions, hasMore: hasMoreSessions, loadMore: loadMoreSessions } = useSessionsContext();
  const { selectedRepo, setSelectedRepo, repos } = useRepoContext();
  const { showArchived } = useFilters();
  const { session: sessionFromHook, loading: sessionLoading } = useGetSession(short_id);
  const sessionId = sessionFromHook?.id;
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
  const [showTasks, setShowTasks] = useState(false);
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
  const [commitsToPush, setCommitsToPush] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [models, setModels] = useState([]);
  const { cursorFast, cursorEffort } = useCursorModelPrefs();
  const [pushing, setPushing] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushRequest, setPushRequest] = useState(null);
  const [activeTaskModal, setActiveTaskModal] = useState(null);
  const [configCommands, setConfigCommands] = useState([]);
  const [error, setError] = useState(null);
  const menuRef = useRef(null);

  const rawMessages = useMemo(() => (hookMessages || []).map(parseMessageRow), [hookMessages]);
  const messages = useMemo(() => reconcileMessages(rawMessages), [rawMessages]);
  const systemPrompt = useMemo(
    () => rawMessages.find((m) => m.type === 'system' && m.subtype === 'prompt')?.content,
    [rawMessages]
  );

  // When switching sessions the resolved session (and therefore the messages keyed off
  // its id) lags behind the URL for a few renders. Treat that window as loading so the
  // chat shows a loader instead of the previous session's conversation.
  const switchingSession = !!short_id && session?.short_id !== short_id;
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

  useEffect(() => {
    setSession(sessionFromHook ?? null);
    if (sessionFromHook) {
      if (sessionFromHook.pr_url) {
        setPrInfo({ url: sessionFromHook.pr_url, number: sessionFromHook.pr_number });
      } else {
        setPrInfo(null);
      }
    }
  }, [sessionFromHook]);

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
    if (isGlobalSession(session)) {
      return BASE_VIEWS.filter((v) => v.id === 'chat' || v.id === 'logs');
    }
    const list = [...BASE_VIEWS];
    if (session?.preview_url) {
      list.splice(4, 0, PREVIEW_VIEW);
    }
    return list;
  }, [session]);

  useEffect(() => {
    if (
      !sessionId ||
      session?.is_global ||
      session?.status === 'running' ||
      session?.status === 'provisioning' ||
      session?.status === 'archiving' ||
      session?.status === 'archived'
    )
      return;
    sessionsService
      .gitStatus(sessionId)
      .then((res) => setCommitsToPush(res.commitsToPush ?? 0))
      .catch(() => {});
  }, [sessionId, session?.status, session?.is_global]);

  useEffect(() => {
    if (!session) return;
    const url =
      session.agent_sdk === 'cursor' ? '/api/settings/models?sdk=cursor' : '/api/settings/models';
    apiFetch(url)
      .then((d) => setModels(d.models || []))
      .catch(() => {});
  }, [session?.agent_sdk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sessionId) return;
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
    if (sessionLoading || !short_id) return;
    if (!sessionFromHook) {
      navigate(homeUrl);
    }
  }, [sessionLoading, short_id, sessionFromHook, navigate, homeUrl]);

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

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

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
      setCommitsToPush(0);
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

  const handleArchive = async () => {
    setShowMenu(false);
    setSession((prev) => (prev ? { ...prev, status: 'archiving' } : prev));
    try {
      const archived = await sessionsService.remove(session.id);
      if (archived?.archived_at) {
        setSession((prev) => (prev ? { ...prev, ...archived } : prev));
      }
      if (!showArchived && archived?.archived_at) {
        const firstSession = nextVisibleSession({
          sessions,
          short_id,
          session,
          repoId,
          fromAllSessions,
        });
        navigate(firstSession ? sessionUrl(firstSession.short_id) : homeUrl);
      }
    } catch (err) {
      toastError('Failed to archive session', err);
    }
  };

  const setView = (view) => {
    setSearchParams(view === 'chat' ? {} : { view });
  };

  if (!session) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
        <div className="text-zinc-400">Loading session...</div>
      </div>
    );
  }

  const isReadonly = !!session.archived_at || session.status === 'archiving';
  const isArchiving = !session.archived_at && session.status === 'archiving';

  const handleDiffLineReference = async ({ path, line }) => {
    if (!session?.id || isReadonly) return;
    try {
      const block = createFileReferenceBlock(path, line);
      await messagesService.create({
        session_id: session.id,
        type: 'user',
        message_json: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [block] },
        }),
      });
      setView('chat');
      toast.success(`Referenced ${fileReferenceAgentText(block)}`);
    } catch (err) {
      toastError('Failed to send line reference', err);
    }
  };

  let sidebarClassName = 'hidden md:flex';
  if (showSidebar) {
    sidebarClassName = 'flex';
  }
  if (showSidebar === false) {
    sidebarClassName = 'hidden';
  }

  const isReviewPanel = activeView === 'review';
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
      {/* Top Bar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-3 sm:px-4 py-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to={homeUrl} className="text-zinc-500 hover:text-zinc-300 shrink-0 md:hidden">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex min-h-6 flex-nowrap items-center gap-2">
                <SessionStatusIndicator session={session} />
                <span className="min-w-0 truncate text-sm font-medium leading-snug text-zinc-300">
                  {session.label ||
                    (isGlobalSession(session) ? 'Global session' : session.repo_full_name)}
                </span>
                {prInfo && (
                  <PrStatusBadge
                    status={session?.pr_status}
                    prNumber={prInfo.number}
                    prUrl={prInfo.url}
                  />
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <span className="hidden sm:inline shrink-0 text-zinc-600">
                  {session.base_branch}
                </span>
                {session.created_branch && (
                  <span className="flex min-w-0 items-center gap-1 overflow-hidden text-zinc-500">
                    <GitBranch className="w-3 h-3 shrink-0" />
                    <span className="truncate">{session.created_branch}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(session.created_branch);
                        toast.success('Branch name copied');
                      }}
                      className="shrink-0 text-zinc-600 hover:text-zinc-400"
                      title="Copy branch name"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {session.preview_url && (
                  <span className="shrink-0 flex items-center gap-1">
                    <SessionToolLink
                      kind="preview"
                      href={session.preview_url}
                      previewServices={session.preview_services}
                    />
                    {session.is_preview_public && (
                      <span className="text-[10px] text-amber-400 border border-amber-500/30 rounded px-1 py-0.5 leading-none">
                        public
                      </span>
                    )}
                  </span>
                )}
                {session.codeserver_url && (
                  <SessionToolLink kind="code" href={session.codeserver_url} hideLabelBelowSm />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isReadonly && (
              <>
                {session?.pr_status !== 'merged' && !isGlobalSession(session) && (
                  <div className="hidden sm:flex items-center gap-2">
                    <Toggle
                      checked={!!session.auto_push}
                      onChange={handleAutoPushChange}
                      label="Auto-push"
                      title="Automatically push after the agent commits"
                    />
                    <button
                      type="button"
                      onClick={handlePush}
                      disabled={pushing}
                      title="Push commits"
                      className="relative flex items-center gap-1 h-8 px-2.5 rounded border text-xs transition-colors border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" />
                      Push
                      {commitsToPush > 0 && (
                        <span className="flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                          {commitsToPush}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:border-zinc-600"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {showMenu && (
                    <div
                      className={`absolute right-0 top-full mt-1 w-56 ${DROPDOWN_PANEL_CLASS} overflow-hidden z-50`}
                    >
                      {session.agent_sdk && (
                        <div className="p-2 border-b border-zinc-800 sm:hidden">
                          <div className="text-[11px] text-zinc-500 px-2 py-1">Agent</div>
                          <div className="px-2 py-1 text-xs text-zinc-400">
                            {session.agent_sdk === 'cursor' ? 'Cursor' : 'Claude'}
                          </div>
                        </div>
                      )}
                      {session.base_branch && (
                        <div className="p-2 border-b border-zinc-800 sm:hidden">
                          <div className="text-[11px] text-zinc-500 px-2 py-1">Base branch</div>
                          <div className="px-2 py-1 text-xs text-zinc-400">
                            {session.base_branch}
                          </div>
                        </div>
                      )}
                      {!isGlobalSession(session) && session?.pr_status !== 'merged' && (
                        <div className="p-2 border-b border-zinc-800 sm:hidden space-y-1.5">
                          <Toggle
                            checked={!!session.auto_push}
                            onChange={handleAutoPushChange}
                            label="Auto-push"
                            title="Automatically push after the agent commits"
                            className="w-full px-2 py-1.5"
                          />
                          <button
                            onClick={() => {
                              handlePush();
                              setShowMenu(false);
                            }}
                            disabled={pushing}
                            className="w-full text-left px-2 py-1.5 text-xs rounded transition-colors flex items-center gap-2 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            <Upload className="w-3 h-3 shrink-0" />
                            <span>Push</span>
                            {commitsToPush > 0 && (
                              <span className="flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                                {commitsToPush}
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                      <div className="p-1">
                        {session.status !== 'archiving' && session.status !== 'provisioning' && (
                          <button
                            onClick={handleArchive}
                            className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 rounded"
                          >
                            Archive Session
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {isArchiving && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-800/80 border-b border-zinc-700 text-zinc-400 text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-amber-400/80" />
          <span>Archiving session — removing worktree…</span>
        </div>
      )}
      {isReadonly && session.archived_at && (
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
        {/* Sessions Sidebar - md+ only; top-aligned with tab row */}
        <div
          className={`${sidebarClassName} w-64 flex-col border-r border-zinc-800 bg-zinc-900 shrink-0 min-h-0`}
        >
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <Link
              to={homeUrl}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>New session</span>
            </Link>
            <button
              onClick={() => setShowSidebar(false)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors p-0.5"
              title="Hide sidebar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {[
              ...(isReadonly && !sessions.some((s) => s.short_id === short_id) ? [session] : []),
              ...sessions.filter(
                (s) =>
                  (showArchived || !s.archived_at) &&
                  (fromAllSessions
                    ? true
                    : repoId
                      ? String(s.repo_id) === String(repoId)
                      : isGlobalSession(s))
              ),
            ].map((s) => (
              <MiniSessionEntry
                key={s.id}
                session={s}
                currentId={short_id}
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* View tabs — only above chat/diff/logs + tasks */}
          <div className="flex shrink-0 items-center border-b border-zinc-800 bg-zinc-900 px-3 sm:px-4">
            <button
              onClick={() => setShowSidebar((v) => !v)}
              className="items-center justify-center mr-1 shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <div className="flex overflow-x-auto gap-1 min-w-0 flex-1 scrollbar-none">
              {views.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors -mb-px ${
                    activeView === id
                      ? 'border-amber-500 text-amber-400'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300'
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
              onClick={() => setShowTasks(!showTasks)}
              title={
                activeView === 'diff'
                  ? 'Open files panel'
                  : activeView === 'review'
                    ? 'Open reviewer panel'
                    : 'Open tasks panel'
              }
              className={`xl:hidden ml-auto shrink-0 flex items-center gap-1.5 p-1.5 sm:px-3 sm:py-1 rounded border text-xs transition-colors ${
                showTasks
                  ? 'border-amber-500 text-amber-400'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              <PanelRight className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">
                {activeView === 'diff' ? 'Files' : activeView === 'review' ? 'Reviewer' : 'Tasks'}
              </span>
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Active view */}
            {activeView === 'chat' && (
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
                cursorFast={cursorFast}
                cursorEffort={cursorEffort}
              />
            )}
            {activeView === 'review' && (
              <ReviewView
                session={session}
                readonly={isReadonly}
                onReviewStarted={() => setShowTasks(true)}
              />
            )}
            {activeView === 'diff' && (
              <DiffView
                session={session}
                onFilesChange={setDiffFiles}
                onLineReference={handleDiffLineReference}
                readonly={isReadonly}
              />
            )}
            {activeView === 'logs' && (
              <LogsView
                rawMessages={rawMessages}
                loadMore={loadMore}
                loadingMore={loadingMore}
                hasMore={hasMore}
              />
            )}
            {activeView === 'preview' && (
              <PreviewView
                session={session}
                readonly={isReadonly}
                onViewLogs={handleViewTaskLogs}
              />
            )}
            {activeView === 'edit' && <EditView session={session} />}
          </div>
        </div>

        {/* Task Panel - same level as sessions sidebar, full height */}
        {showTasks && (
          <div
            className="xl:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setShowTasks(false)}
          />
        )}
        <div
          className={
            showTasks
              ? `flex fixed inset-y-0 right-0 z-40 w-[85vw] xl:relative xl:inset-auto xl:z-auto xl:w-[var(--side-panel-w)] ${
                  isReviewPanel ? 'max-w-xl xl:max-w-none' : 'max-w-sm xl:max-w-none'
                } border-l border-zinc-800 bg-zinc-900 flex-col shrink-0`
              : 'hidden xl:flex relative xl:w-[var(--side-panel-w)] border-l border-zinc-800 bg-zinc-900 flex-col shrink-0'
          }
          style={{ '--side-panel-w': `${sidePanelWidth}px` }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            onPointerDown={handleSidePanelResizeStart}
            className="hidden xl:block absolute left-0 top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none hover:bg-amber-500/50 active:bg-amber-500/70"
          />
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-300">
              {activeView === 'diff' ? 'Files' : activeView === 'review' ? 'Reviewer' : 'Tasks'}
            </h3>
            <button
              onClick={() => setShowTasks(false)}
              className="text-zinc-500 hover:text-zinc-300 xl:hidden p-1"
            >
              <X className="w-4 h-4" />
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
                        setShowTasks(false);
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
            <ReviewAgentPanel session={session} readonly={isReadonly} sidePanelOpen={showTasks} />
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
      </div>

      {/* Task Log Modal */}
      {showPushModal && (
        <PushConfirmModal
          sessionId={session?.id}
          repo={repos.find((r) => r.full_name === session?.repo_full_name) ?? null}
          commitsToPush={commitsToPush}
          initialBranch={pushRequest?.branch || session?.remote_branch || session?.created_branch}
          initialForceMode={pushRequest?.forceMode || null}
          onConfirm={handlePushConfirmed}
          onCancel={() => {
            setShowPushModal(false);
            setPushRequest(null);
          }}
          onEditDetails={() => {
            setShowPushModal(false);
            setPushRequest(null);
            setView('edit');
          }}
        />
      )}
      {activeTaskModal != null && (
        <TaskLogModal
          task={tasks.find((t) => t.id === activeTaskModal)}
          session={{
            id: session.id,
            label: session.label,
            repo_full_name: session.repo_full_name,
            base_branch: session.base_branch,
            pr_url: prInfo?.url,
            pr_number: prInfo?.number,
          }}
          onKill={handleTaskKill}
          onRetry={handleTaskRetry}
          onClose={() => setActiveTaskModal(null)}
        />
      )}
    </div>
  );
}
