import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  MoreVertical,
  ListTodo,
  FolderOpen,
  X,
  Plus,
  AlertCircle,
  MessageSquare,
  ScrollText,
  GitBranch,
  Copy,
  Archive,
  PanelLeft,
  Pencil,
  Upload,
} from 'lucide-react';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useFilters } from '../context/FilterContext.jsx';
import { useRepoContext, ALL_REPOS } from '../context/RepoContext.jsx';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import { apiFetch } from '../api.js';
import { sessionsService, tasksService } from '../feathers.js';
import { useGetSession } from '../hooks/useGetSession.js';
import { useGetMessages } from '../hooks/useGetMessages.js';
import { useGetTasks } from '../hooks/useGetTasks.js';
import TaskPanel from '../components/TaskPanel.jsx';
import TaskLogModal from '../components/TaskLogModal.jsx';
import ArchiveSession from '../components/ArchiveSession.jsx';
import PushConfirmModal from '../components/PushConfirmModal.jsx';
import ChatView from './session/ChatView.jsx';
import DiffView from './session/DiffView.jsx';
import LogsView from './session/LogsView.jsx';
import EditView from './session/EditView.jsx';
import PrStatusBadge from '../components/PrStatusBadge.jsx';
import { parseModelField, parseModelFieldFull, variantLabel } from '../utils/models.js';

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
  const statusColor =
    {
      running: 'bg-emerald-400 animate-pulse',
      approval: 'bg-amber-400 animate-pulse',
      completed: 'bg-emerald-400',
      stopped: 'bg-zinc-500',
      failed: 'bg-red-400',
      error: 'bg-red-400',
    }[session.status] || 'bg-zinc-600';

  if (isArchived) {
    return <Archive className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden />;
  }
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />;
}

function MiniSessionEntry({ session: s, currentId, onArchive }) {
  const isArchived = !!s.archived_at;

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
        isArchived ? 'opacity-50' : ''
      } ${
        s.short_id === currentId
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      }`}
    >
      <SessionStatusIndicator session={s} />
      <Link
        to={`/session/${s.short_id}`}
        className="flex-1 min-w-0 line-clamp-2 wrap-break-word leading-snug text-left"
      >
        {s.label || s.repo_full_name}
      </Link>
      {s.pr_status && <PrStatusBadge status={s.pr_status} prUrl={s.pr_url} />}
      {!s.archived_at && (
        <div className="opacity-100 shrink-0">
          <ArchiveSession session={s} onArchive={() => onArchive?.(s)} />
        </div>
      )}
    </div>
  );
}

const VIEWS = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'diff', label: 'Diff', Icon: FolderOpen },
  { id: 'logs', label: 'Logs', Icon: ScrollText },
  { id: 'edit', label: 'Edit', Icon: Pencil },
];

export default function Session() {
  const { short_id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') || 'chat';
  const {
    sessions,
    hasMore: hasMoreSessions,
    loadMore: loadMoreSessions,
  } = useSessionsContext();
  const { selectedRepo, setSelectedRepo, repos } = useRepoContext();
  const { showArchived } = useFilters();
  const { session: sessionFromHook, loading: sessionLoading } = useGetSession(short_id);
  const sessionId = sessionFromHook?.id;
  const { messages: hookMessages, loadMore, loadingMore, hasMore } = useGetMessages(sessionId);
  const { tasks: tasksFromHook } = useGetTasks({ sessionId, skip: !sessionId });

  const [session, setSession] = useState(null);
  const [prInfo, setPrInfo] = useState(null);
  const [killedTaskIds, setKilledTaskIds] = useState(new Set());
  const [showTasks, setShowTasks] = useState(false);
  const [showSidebar, setShowSidebar] = useState(null);
  const [diffFiles, setDiffFiles] = useState([]);
  const [commitsToPush, setCommitsToPush] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [menuModelOverride, setMenuModelOverride] = useState(null);
  const [models, setModels] = useState([]);
  const [_localSha, setLocalSha] = useState(null);
  const [_remoteSha, setRemoteSha] = useState(null);
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
        created_at: t.created_at,
        ports: t.ports ?? {},
        status:
          killedTaskIds.has(t.id) && t.status === 'running' ? 'exited' : (t.status ?? 'running'),
        exitCode: t.exit_code,
      })),
    [tasksFromHook, killedTaskIds]
  );

  useEffect(() => {
    if (!session) return;
    const url =
      session.agent_sdk === 'cursor'
        ? '/api/settings/models?sdk=cursor'
        : '/api/settings/models';
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
    if (!sessionId || session?.status !== 'completed') return;
    sessionsService
      .diff(sessionId)
      .then((res) => {
        setCommitsToPush(res.commitsToPush ?? 0);
        setLocalSha(res.localSha ?? null);
        setRemoteSha(res.remoteSha ?? null);
      })
      .catch(() => {});
  }, [sessionId, session?.status]);

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
      navigate('/');
    }
  }, [sessionLoading, short_id, sessionFromHook, navigate]);

  const prevSelectedRepoRef = useRef(selectedRepo);
  const selectedRepoRef = useRef(selectedRepo);
  useLayoutEffect(() => {
    selectedRepoRef.current = selectedRepo;
  }, [selectedRepo]);

  useEffect(() => {
    if (prevSelectedRepoRef.current === selectedRepo) return;
    prevSelectedRepoRef.current = selectedRepo;
    navigate('/');
  }, [selectedRepo, navigate]);

  // When navigating to a new session URL, sync the repo picker to that session's
  // repo. Tied to short_id (not sessionRepo) so user changing the picker never
  // triggers this — only navigating to a different session does. This also means
  // clicking a session from "All sessions" correctly switches to that session's repo.
  const sessionRepo = sessionFromHook?.repo_full_name;
  const prevShortIdRef = useRef(null);
  useEffect(() => {
    if (!sessionRepo) return;
    if (prevShortIdRef.current === short_id) return;
    prevShortIdRef.current = short_id;
    if (sessionRepo === selectedRepoRef.current) return;
    prevSelectedRepoRef.current = sessionRepo;
    setSelectedRepo(sessionRepo);
  }, [short_id, sessionRepo, setSelectedRepo]);

  useEffect(() => {
    if (!showMenu) {
      setMenuModelOverride(null);
      return;
    }
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const handlePlanToggle = () => {
    if (!session?.id) return;
    sessionsService
      .patch(session.id, { plan_mode: !session?.plan_mode })
      .catch((err) => toastError('Failed to toggle plan mode', err));
    setShowMenu(false);
  };

  const handleModelChange = (model) => {
    if (!session?.id) return;
    sessionsService
      .patch(session.id, { model })
      .catch((err) => toastError('Failed to change model', err));
  };

  const handleTaskStart = (command, ports, label) => {
    tasksService
      .create({
        session_id: session?.id,
        command,
        label: label || undefined,
        ports: ports?.length ? ports : undefined,
        task_key: label || undefined,
      })
      .catch((err) => toastError('Failed to start task', err));
  };

  const handleTaskKill = (taskId) => {
    setKilledTaskIds((prev) => new Set([...prev, taskId]));
    tasksService.kill(taskId).catch((err) => toastError('Failed to kill task', err));
  };

  const handleTaskRetry = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      const ports = task.ports ? Object.keys(task.ports) : undefined;
      tasksService
        .create({
          session_id: session?.id,
          command: task.command,
          label: task.label || undefined,
          ports: ports?.length ? ports : undefined,
        })
        .catch((err) => toastError('Failed to start task', err));
      setActiveTaskModal(null);
    }
  };

  const handleTaskDelete = (taskId) => {
    tasksService.remove(taskId).catch((err) => toastError('Failed to delete task', err));
  };

  const handleViewTaskLogs = (taskId) => {
    setActiveTaskModal(taskId);
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

  const handleStop = async () => {
    setShowMenu(false);
    try {
      await sessionsService.stop(session.id);
    } catch (err) {
      toastError('Failed to stop session', err);
    } finally {
      setSession((prev) => (prev ? { ...prev, status: 'stopped' } : prev));
    }
  };

  const handleArchive = async () => {
    setShowMenu(false);
    try {
      await sessionsService.remove(session.id);
      setSession((prev) => (prev ? { ...prev, archived_at: new Date().toISOString() } : prev));
      if (!showArchived) {
        const firstSession = sessions.find(
          (s) =>
            s.short_id !== short_id &&
            !s.archived_at &&
            (!selectedRepo || selectedRepo === ALL_REPOS || s.repo_full_name === selectedRepo)
        );
        navigate(firstSession ? `/session/${firstSession.short_id}` : '/');
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

  const isReadonly = !!session.archived_at;

    let sidebarClassName = "hidden md:flex"
    if (showSidebar) {
      sidebarClassName = "flex"
    }
    if (showSidebar === false) {
      sidebarClassName = "hidden"
    }
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Top Bar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-3 sm:px-4 py-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/" className="text-zinc-500 hover:text-zinc-300 shrink-0 md:hidden">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex min-h-6 flex-nowrap items-center gap-2">
                <SessionStatusIndicator session={session} />
                <span className="min-w-0 truncate text-sm font-medium leading-snug text-zinc-300">
                  {session.label || session.repo_full_name}
                </span>
                {prInfo && (
                  <PrStatusBadge
                    status={session?.pr_status}
                    prNumber={prInfo.number}
                    prUrl={prInfo.url}
                  />
                )}
                {session.model && (
                  <span className="hidden sm:inline-flex items-center gap-1 shrink-0 text-xs text-zinc-600">
                    <span className="text-zinc-700">·</span>
                    {session.agent_sdk === 'cursor' ? 'Cursor' : 'Claude'}
                    {session.model && (
                      <span className="text-zinc-700">{parseModelField(session.model)}</span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <span className="hidden sm:inline shrink-0 text-zinc-600">{session.base_branch}</span>
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
                    <a
                      href={session.preview_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-300"
                    >
                      Preview
                    </a>
                    {session.is_preview_public && (
                      <span className="text-[10px] text-amber-400 border border-amber-500/30 rounded px-1 py-0.5 leading-none">
                        public
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isReadonly && (
              <>
                {session?.pr_status !== 'merged' && (
                  <button
                    type="button"
                    onClick={handlePush}
                    disabled={pushing}
                    title="Push commits"
                    className="relative hidden sm:flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" />
                    Push
                    {commitsToPush > 0 && (
                      <span className="flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                        {commitsToPush}
                      </span>
                    )}
                  </button>
                )}
                <button
                  onClick={handlePlanToggle}
                  title={session.plan_mode ? 'Disable Plan Mode' : 'Enable Plan Mode'}
                  className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                    session.plan_mode
                      ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  Plan mode
                </button>
              </>
            )}

            <button
              onClick={() => setShowTasks(!showTasks)}
              className={`xl:hidden p-1.5 sm:px-3 sm:py-1 rounded border text-xs transition-colors relative ${
                showTasks
                  ? 'border-amber-500 text-amber-400'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              {activeView === 'diff' ? (
                <FolderOpen className="w-4 h-4 sm:hidden" />
              ) : (
                <ListTodo className="w-4 h-4 sm:hidden" />
              )}
              <span className="hidden sm:inline">{activeView === 'diff' ? 'Files' : 'Tasks'}</span>
            </button>
            {!isReadonly && (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-600"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
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
                        <div className="px-2 py-1 text-xs text-zinc-400">{session.base_branch}</div>
                      </div>
                    )}
                    {(() => {
                      const isCursor = session.agent_sdk === 'cursor';
                      const { id: sessionModelId, params: sessionParams } = parseModelFieldFull(session.model);
                      const menuModelId = menuModelOverride ?? sessionModelId;
                      const menuModelObj = models.find((m) => m.id === menuModelId);
                      const variants = menuModelObj?.variants ?? [];
                      const currentVariantIdx = (() => {
                        if (!variants.length || !sessionParams) return 0;
                        const idx = variants.findIndex((v) =>
                          v.params?.every((p) =>
                            sessionParams.some((sp) => sp.id === p.id && sp.value === p.value)
                          )
                        );
                        return idx >= 0 ? idx : 0;
                      })();
                      return (
                        <div className="p-2 border-b border-zinc-800">
                          <div className="text-[11px] text-zinc-500 px-2 py-1">Model</div>
                          <select
                            value={menuModelId || ''}
                            onChange={(e) => {
                              const newId = e.target.value;
                              const newModelObj = models.find((m) => m.id === newId);
                              if (isCursor && newModelObj?.variants?.length) {
                                setMenuModelOverride(newId);
                                handleModelChange(newId);
                              } else {
                                handleModelChange(newId);
                                setShowMenu(false);
                              }
                            }}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none mb-1"
                          >
                            {models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.display_name}
                              </option>
                            ))}
                            {menuModelId && !models.some((m) => m.id === menuModelId) && (
                              <option value={menuModelId}>{menuModelId}</option>
                            )}
                          </select>
                          {isCursor && variants.length > 0 && (
                            <>
                              <div className="text-[11px] text-zinc-500 px-2 py-1 mt-1">Variant</div>
                              <select
                                value={currentVariantIdx}
                                onChange={(e) => {
                                  const v = variants[parseInt(e.target.value)];
                                  handleModelChange(
                                    JSON.stringify({ id: menuModelId, params: v.params })
                                  );
                                }}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none mb-1"
                              >
                                {variants.map((v, i) => (
                                  <option key={i} value={i}>
                                    {variantLabel(v, menuModelObj.display_name)}
                                    {v.is_default ? ' (default)' : ''}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                        </div>
                      );
                    })()}
                    <div className="p-2 border-b border-zinc-800 sm:hidden">
                      <button
                        onClick={() => { handlePush(); setShowMenu(false); }}
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
                    <div className="p-2 border-b border-zinc-800 sm:hidden">
                      <button
                        onClick={handlePlanToggle}
                        className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors flex items-center justify-between ${
                          session.plan_mode
                            ? 'text-amber-400 bg-amber-500/10'
                            : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        <span>Plan Mode</span>
                        <div
                          className={`relative w-7 h-3.5 rounded-full transition-colors ${session.plan_mode ? 'bg-amber-500' : 'bg-zinc-600'}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${session.plan_mode ? 'translate-x-3.5' : 'translate-x-0'}`}
                          />
                        </div>
                      </button>
                    </div>
                    <div className="p-1">
                      {session.status === 'running' && (
                        <button
                          onClick={handleStop}
                          className="w-full text-left px-3 py-2 text-xs text-amber-400 hover:bg-zinc-800 rounded"
                        >
                          Stop Session
                        </button>
                      )}
                      <button
                        onClick={handleArchive}
                        className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 rounded"
                      >
                        Archive Session
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {isReadonly && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-800/80 border-b border-zinc-700 text-zinc-400 text-xs">
          <span>This session has been deleted — read only</span>
        </div>
      )}

      {error && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-red-950/80 border-b border-red-800 text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 p-1 rounded hover:bg-red-800/50 text-red-200"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sidebar (full height) + main column (tabs + views + tasks) */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Sessions Sidebar - md+ only; top-aligned with tab row */}
        <div className={`${sidebarClassName} w-64 flex-col border-r border-zinc-800 bg-zinc-900 shrink-0 min-h-0`}>
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>New session</span>
            </Link>
            <button
              onClick={() => setShowSidebar(false)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Hide sidebar"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {[
              ...(isReadonly && !sessions.some((s) => s.short_id === short_id) ? [session] : []),
              ...sessions.filter(
                (s) =>
                  (showArchived || !s.archived_at) &&
                  (!selectedRepo || selectedRepo === ALL_REPOS || s.repo_full_name === selectedRepo)
              ),
            ].map((s) => (
              <MiniSessionEntry
                key={s.id}
                session={s}
                currentId={short_id}
                onArchive={(archived) => {
                  if (archived.short_id !== short_id || showArchived) return;
                  const firstSession = sessions.find(
                    (x) =>
                      x.short_id !== short_id &&
                      !x.archived_at &&
                      (!selectedRepo || selectedRepo === ALL_REPOS || x.repo_full_name === selectedRepo)
                  );
                  navigate(firstSession ? `/session/${firstSession.short_id}` : '/');
                }}
              />
            ))}
            {hasMoreSessions && (
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
            {VIEWS.map(({ id, label, Icon }) => (
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
              </button>
            ))}
            </div>
            {!isReadonly && session?.pr_status !== 'merged' && (
              <div className="ml-auto shrink-0 flex items-center gap-2 py-2 pl-2">
                <span className="text-xs text-zinc-500">Auto-push</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!session?.auto_push}
                  onClick={() => {
                    if (!session?.id) return;
                    sessionsService
                      .patch(session.id, { auto_push: !session.auto_push })
                      .catch((err) => toastError('Failed to update auto-push setting', err));
                  }}
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${session?.auto_push ? 'bg-amber-500' : 'bg-zinc-600'}`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${session?.auto_push ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>
            )}
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Active view */}
            {activeView === 'chat' && (
              <ChatView
                messages={messages}
                loadMore={loadMore}
                loadingMore={loadingMore}
                session={session}
                systemPrompt={systemPrompt}
                onViewChange={setView}
                readonly={isReadonly}

              />
            )}
            {activeView === 'diff' && <DiffView session={session} onFilesChange={setDiffFiles} />}
            {activeView === 'logs' && (
              <LogsView rawMessages={rawMessages} loadMore={loadMore} loadingMore={loadingMore} />
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
              ? 'flex fixed inset-y-0 right-0 w-[85vw] max-w-sm z-40 xl:relative xl:inset-auto xl:w-80 xl:z-auto border-l border-zinc-800 bg-zinc-900 flex-col'
              : 'hidden xl:flex xl:w-80 border-l border-zinc-800 bg-zinc-900 flex-col'
          }
        >
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-300">
              {activeView === 'diff' ? 'Files' : 'Tasks'}
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
                  const displayPath =
                    file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        setShowTasks(false);
                        document
                          .getElementById(`diff-file-${i}`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-800 transition-colors border-b border-zinc-800/50"
                    >
                      <span className="font-mono text-xs text-zinc-300 truncate flex-1 min-w-0">
                        {displayPath}
                      </span>
                      <span className="text-xs text-emerald-400 shrink-0">
                        +{file.addedCount}
                      </span>
                      <span className="text-xs text-red-400 shrink-0">
                        -{file.removedCount}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <TaskPanel
              tasks={tasks}
              configCommands={configCommands}
              onStart={handleTaskStart}
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
