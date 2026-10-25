import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { fileToContentBlock } from '../utils/fileToContentBlock.js';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import toast from 'react-hot-toast';
import { toastError, toastFeathersError } from '../utils/toastError.jsx';
import { useAgentConfigs } from '../hooks/useAgentConfigs.js';
import { agentsService, sessionsService, tasksService } from '../feathers.js';
import {
  sessionActivityAt,
  sessionNeedsLastViewedUpdate,
} from '@baguette/shared/session-unread.js';
import { useGetSession } from '../hooks/useGetSession.js';
import { useGetMessages } from '../hooks/useGetMessages.js';
import { useSessionAgents } from '../hooks/useSessionAgents.js';
import { useGetTasks } from '../hooks/useGetTasks.js';
import { useGetSessionIssues } from '../hooks/useGetSessionIssues.js';
import { useSessionBranchCommits } from '../hooks/useSessionBranchCommits.js';
import { useSessionCommitsToPush } from '../hooks/useSessionCommitsToPush.js';
import { useSessionPushInProgress } from '../hooks/useSessionPushInProgress.js';
import { useSessionChangedFiles } from '../hooks/useSessionChangedFiles.js';
import { useSessionDiff } from '../hooks/useSessionDiff.js';
import { useSessionConfigCommands } from '../hooks/useSessionConfigCommands.js';
import { taskConfirmStateFromCommand } from '../utils/taskPanelGrouping.js';
import { modelPatchFromConfigDefault } from '../utils/agentConfigDefaultModel.js';
import ChatView from './session/ChatView.jsx';
import DiffView from './session/DiffView.jsx';
import PreviewView from './session/PreviewView.jsx';
import ReviewView from './session/ReviewView.jsx';
import DetailsView from './session/DetailsView.jsx';
import PlanView from './session/PlanView.jsx';
import LoopWorkspaceBody from './session/LoopWorkspaceBody.jsx';
import { useLoopWorkspace } from '../hooks/useLoopWorkspace.js';
import { useWorkspaceHeaderEntity } from '../hooks/useWorkspaceHeaderEntity.js';
import SessionSidePanel from './session/SessionSidePanel.jsx';
import SessionMainViewFooter from './session/SessionMainViewFooter.jsx';
import SessionListRail from './session/SessionListRail.jsx';
import SessionWorkspaceHeader from './session/SessionWorkspaceHeader.jsx';
import SessionStatusBanners from './session/SessionStatusBanners.jsx';
import SessionViewTabs from './session/SessionViewTabs.jsx';
import SessionCreateBody from './session/SessionCreateBody.jsx';
import SessionWorkspaceModals from './session/SessionWorkspaceModals.jsx';
import { SESSION_VIEWS } from './session/sessionViews.js';
import { nextVisibleSession } from './session/sessionListDisplay.js';
import { resolveSidePanelTab, SIDE_PANEL_TAB_IDS } from './session/sessionSidePanelTabs.js';
import { enrichChatMessages } from '../utils/enrichChatMessages.js';
import { useSessionColumnLayout } from '../hooks/useSessionColumnLayout.js';
import { useCursorModelPrefs } from '../hooks/useAgentPreferences.js';
import {
  isGlobalSession,
  isAllSessionsPath,
  isNewSessionRouteId,
  agentsScopePathFromPathname,
  isLoopHomePathname,
  isLoopsPath,
  isNewLoopRouteId,
  isSessionHomePathname,
} from '@baguette/shared/session-scope.js';
import { sortSessionsForList } from '@baguette/shared/session-sort.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import NotFound from './NotFound.jsx';
import { isFeathersNotFound } from '../utils/feathersErrors.js';
import { SESSION_MAIN_MIN_WIDTH } from '../utils/sessionLayout.js';
import { useGetLoops } from '../hooks/useGetLoops.js';
import { diffFileDisplayPath } from '../utils/paths.js';
import { autoPushEnabledForRepo, isLocalRepo } from '../utils/repoDisplayName.js';
import { parseMessageRow } from '@baguette/shared/parse-message-row.ts';
import { isGlobalSessionDisabledView } from './session/sessionViews.js';

export default function Session() {
  const { id: routeSessionId, repoId, loopId: routeLoopId } = useParams();
  const { pathname } = useLocation();
  const isNewSessionRoute = isNewSessionRouteId(routeSessionId) || isSessionHomePathname(pathname);
  const isNewLoopRoute = isNewLoopRouteId(routeLoopId) || isLoopHomePathname(pathname);
  const fromAllSessions = isAllSessionsPath(pathname);
  const isGlobalSessionsRoute = pathname.startsWith('/global/');
  const {
    homeUrl,
    loopsHomeUrl,
    sessionUrl,
    sessionNewUrl,
    loopEditUrl,
    loopNewUrl,
    isLoopsView,
    showRepoDetails,
  } = useFilterRoutes();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const activeView = viewParam === 'logs' ? 'chat' : viewParam || 'chat';
  const {
    sessions,
    hasMore: hasMoreSessions,
    loadMore: loadMoreSessions,
    refetch: refetchSessions,
  } = useSessionsContext();
  const { selectedRepo, setSelectedRepo, repos } = useRepoContext();

  const loopsQuery = useMemo(() => {
    if (!isLoopsView) return null;
    const isAll = selectedRepo === ALL_REPOS;
    const isGlobal = selectedRepo === GLOBAL_SCOPE;
    if (isAll) return {};
    if (isGlobal) return { is_global: true };
    if (selectedRepo) return { repo_full_name: selectedRepo };
    return null;
  }, [isLoopsView, selectedRepo]);
  const { loops, loaded: loopsLoaded, reload: reloadLoops } = useGetLoops(loopsQuery);
  const loopWorkspace = useLoopWorkspace({
    routeLoopId: isLoopsView ? routeLoopId : undefined,
    isNewLoopRoute: isLoopsView && isNewLoopRoute,
    loops,
  });
  const loopTabActive = isNewLoopRoute ? 'edit' : loopWorkspace.activeTab;
  const {
    session: sessionFromHook,
    loading: sessionLoading,
    error: sessionLoadError,
  } = useGetSession(isNewSessionRoute ? null : routeSessionId);
  const sessionId = useMemo(() => {
    if (isNewSessionRoute || !routeSessionId) return null;
    const parsed = Number(routeSessionId);
    return Number.isFinite(parsed) ? parsed : null;
  }, [isNewSessionRoute, routeSessionId]);
  const { agents, primaryBuilder, reviewer } = useSessionAgents(sessionId);
  const agentParam = searchParams.get('agent');
  const activeAgent = useMemo(() => {
    if (!agents.length) return null;
    const parsedId = agentParam ? Number(agentParam) : null;
    if (parsedId != null && agents.some((a) => a.id === parsedId)) {
      return agents.find((a) => a.id === parsedId) ?? null;
    }
    return primaryBuilder ?? agents[0] ?? null;
  }, [agents, agentParam, primaryBuilder]);
  const {
    messages: hookMessages,
    loading: messagesLoading,
    loadMore,
    loadingMore,
    hasMore,
  } = useGetMessages(sessionId, activeAgent?.id ?? null);
  const chatViewOpen = activeView === 'chat';
  const agentLabelById = useMemo(() => {
    const map = new Map();
    for (const agent of agents) {
      map.set(agent.id, { name: agent.name, agent_type: agent.agent_type });
    }
    return map;
  }, [agents]);
  const { tasks: tasksFromHook } = useGetTasks({ sessionId, skip: !sessionId });
  const shouldLoadSessionIssues = activeView === 'review';
  const { issues: sessionIssues, loading: sessionIssuesLoading } = useGetSessionIssues(sessionId, {
    enabled: shouldLoadSessionIssues,
  });
  const [sessionOverride, setSession] = useState(null);
  const fetchedSession = useMemo(() => {
    if (sessionOverride && String(sessionOverride.id) === String(routeSessionId)) {
      return { ...(sessionFromHook || {}), ...sessionOverride };
    }
    return sessionFromHook;
  }, [sessionOverride, sessionFromHook, routeSessionId]);
  const {
    entity: session,
    headerEntity: headerSession,
    awaiting: awaitingSession,
  } = useWorkspaceHeaderEntity({
    routeId: routeSessionId,
    isNewRoute: isNewSessionRoute,
    fetched: fetchedSession,
    list: sessions,
  });
  const openIssuesTabCount = useMemo(() => {
    if (shouldLoadSessionIssues) {
      return sessionIssues.filter((i) => i.status === 'opened').length;
    }
    return session?.open_issues_count ?? 0;
  }, [shouldLoadSessionIssues, sessionIssues, session?.open_issues_count]);
  const [prInfo, setPrInfo] = useState(null);
  const [showTasks, setShowTasks] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  );
  const {
    isMdUp,
    isSidebarOpen,
    isSidePanelOpen,
    showSidebar,
    setShowSidebar,
    sessionsSidebarElRef,
    sidePanelElRef,
    sessionsSidebarResizing,
    sessionsSidebarWidth,
    setSessionsSidebarWidth,
    sidePanelWidth,
    setSidePanelWidth,
    handleSessionsSidebarResizeStart,
    handleSidePanelResizeStart,
  } = useSessionColumnLayout({ isNewSessionRoute, isLoopsView, showTasks });
  const [lastSidePanelTab, setLastSidePanelTab] = useState('tasks');
  const [scrollToDiffFile, setScrollToDiffFile] = useState(null);
  const [selectedDiffFile, setSelectedDiffFile] = useState(null);
  /** File path chosen from the sidebar while the diff request is still in flight. */
  const [pendingSidebarDiffFile, setPendingSidebarDiffFile] = useState(null);
  const diffCommitParam = searchParams.get('commit');
  const selectedDiffCommit = diffCommitParam && diffCommitParam !== 'all' ? diffCommitParam : 'all';
  const filesCommitSha =
    activeView === 'diff' && selectedDiffCommit !== 'all' ? selectedDiffCommit : null;
  const panelParam = searchParams.get('panel');
  const sidePanelTab = useMemo(
    () => resolveSidePanelTab(panelParam, lastSidePanelTab),
    [panelParam, lastSidePanelTab]
  );

  useEffect(() => {
    if (panelParam && SIDE_PANEL_TAB_IDS.has(panelParam)) {
      setLastSidePanelTab(panelParam);
    }
  }, [panelParam]);
  const shouldLoadBranchCommits = sidePanelTab === 'commits' || activeView === 'diff';
  const shouldLoadChangedFiles = sidePanelTab === 'files' || activeView === 'diff';
  const gitSession = session ?? sessionFromHook;
  const { configOptions } = useAgentConfigs();
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
  const diffViewActive = activeView === 'diff';
  const {
    diff: sessionDiff,
    fileByFile: sessionDiffFileByFile,
    diffFile: sessionDiffActiveFile,
    loading: sessionDiffLoading,
    error: sessionDiffError,
    stale: sessionDiffStale,
    hasFetched: sessionDiffHasFetched,
    refresh: refreshSessionDiff,
  } = useSessionDiff(
    gitSession,
    selectedDiffCommit,
    diffViewActive,
    selectedDiffFile ?? pendingSidebarDiffFile
  );
  const diffSelectorFile = selectedDiffFile ?? sessionDiffActiveFile;

  useEffect(() => {
    setSelectedDiffFile(null);
    setPendingSidebarDiffFile(null);
  }, [gitSession?.id, selectedDiffCommit]);

  useEffect(() => {
    if (!pendingSidebarDiffFile || sessionDiffLoading) return;
    if (sessionDiffFileByFile) {
      setSelectedDiffFile(pendingSidebarDiffFile);
      setPendingSidebarDiffFile(null);
      return;
    }
    setScrollToDiffFile(pendingSidebarDiffFile);
    setPendingSidebarDiffFile(null);
  }, [sessionDiffFileByFile, sessionDiffLoading, pendingSidebarDiffFile]);

  const { cursorModelPrefs, setCursorModelPref } = useCursorModelPrefs();
  const { pushing, beginLocalPush, endLocalPush } = useSessionPushInProgress(gitSession?.id);
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushRequest, setPushRequest] = useState(null);
  const [activeTaskModal, setActiveTaskModal] = useState(null);
  const [pendingTaskConfirm, setPendingTaskConfirm] = useState(null);
  const configCommands = useSessionConfigCommands(gitSession);
  const [showBaguetteConfigModal, setShowBaguetteConfigModal] = useState(false);
  const [error, setError] = useState(null);
  const selectAgent = useCallback(
    (agent) => {
      if (!agent?.id) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('agent', String(agent.id));
          next.set('view', 'chat');
          next.set('panel', 'agents');
          return next;
        },
        { replace: true }
      );
      setShowTasks(true);
    },
    [setSearchParams, setShowTasks]
  );
  const handleReviewerCleared = useCallback(() => {
    if (primaryBuilder) selectAgent(primaryBuilder);
  }, [primaryBuilder, selectAgent]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [createSessionError, setCreateSessionError] = useState(null);
  const [newSessionFormKey, setNewSessionFormKey] = useState(0);

  const rawMessages = useMemo(() => (hookMessages || []).map(parseMessageRow), [hookMessages]);
  const messages = useMemo(() => enrichChatMessages(rawMessages), [rawMessages]);
  const systemPrompt = useMemo(
    () => rawMessages.find((m) => m.type === 'system' && m.subtype === 'prompt')?.content,
    [rawMessages]
  );

  // When switching sessions the resolved session (and therefore the messages keyed off
  // its id) lags behind the URL for a few renders. Treat that window as loading so the
  // chat shows a loader instead of the previous session's conversation.
  const switchingSession = !!sessionId && !isNewSessionRoute && session?.id !== sessionId;
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

  useEffect(() => {
    setSession(null);
  }, [routeSessionId]);

  useEffect(() => {
    if (isNewSessionRoute) {
      setPrInfo(null);
      return;
    }
    if (!sessionFromHook) return;
    if (sessionFromHook.pr_url) {
      setPrInfo({ url: sessionFromHook.pr_url, number: sessionFromHook.pr_number });
    } else {
      setPrInfo(null);
    }
  }, [sessionFromHook, isNewSessionRoute]);

  useEffect(() => {
    setCreateSessionError(null);
  }, [routeSessionId]);

  const tasks = useMemo(
    () =>
      (tasksFromHook || []).map((t) => ({
        id: t.id,
        pid: t.pid,
        command: t.command,
        label: t.label,
        task_key: t.task_key ?? null,
        created_at: t.created_at,
        started_at: t.started_at,
        exited_at: t.exited_at,
        ports: t.ports ?? {},
        status: t.status ?? 'waiting',
        exitCode: t.exit_code,
      })),
    [tasksFromHook]
  );

  const globalSessionViewDisabled = isGlobalSession(session);

  const viewTabStripKey = SESSION_VIEWS.map((v) => v.id).join(',');

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
    const onAppError = (msg) => {
      const text = msg.message || 'Something went wrong';
      const shortText = text.split('\n')[0]?.trim() || text;
      toast.error(shortText);
      if (msg.sessionId && sessionId && msg.sessionId === sessionId) {
        setError(shortText);
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
    if (isNewSessionRoute || !routeSessionId || sessionLoading || sessionFromHook) return;
    if (!sessionLoadError || isFeathersNotFound(sessionLoadError)) return;
    toastError('Failed to load session', sessionLoadError);
    navigate(homeUrl);
  }, [
    isNewSessionRoute,
    routeSessionId,
    sessionLoading,
    sessionFromHook,
    sessionLoadError,
    navigate,
    homeUrl,
  ]);

  useEffect(() => {
    if (isNewSessionRoute || sessionLoading || !sessionFromHook?.id) return;
    if (String(sessionFromHook.id) !== String(routeSessionId)) return;
    if (!sessionNeedsLastViewedUpdate(sessionFromHook)) return;
    const activityAt = sessionActivityAt(sessionFromHook);
    sessionsService.patch(sessionFromHook.id, { last_viewed_at: activityAt }).catch(() => {});
  }, [isNewSessionRoute, sessionLoading, sessionFromHook, routeSessionId]);

  // Sync selectedRepo from URL so RepoPicker displays the current repo
  const sessionRepo = sessionFromHook?.repo_full_name;
  useEffect(() => {
    if (!isSessionHomePathname(pathname)) return;
    if (pathname === '/global') {
      if (selectedRepo !== GLOBAL_SCOPE) setSelectedRepo(GLOBAL_SCOPE);
      return;
    }
    if (repoId) {
      if (!repos.length) return;
      const repo = repos.find((r) => String(r.id) === String(repoId));
      if (repo && selectedRepo !== repo.full_name) setSelectedRepo(repo.full_name);
      return;
    }
    if (pathname === '/' && selectedRepo !== ALL_REPOS) {
      setSelectedRepo(ALL_REPOS);
    }
  }, [pathname, repoId, repos, selectedRepo, setSelectedRepo]);

  useEffect(() => {
    if (!isLoopsPath(pathname)) return;
    const scopePath = agentsScopePathFromPathname(pathname);
    if (scopePath === '/global' || pathname.startsWith('/global/loops')) {
      if (selectedRepo !== GLOBAL_SCOPE) setSelectedRepo(GLOBAL_SCOPE);
      return;
    }
    const repoMatch = scopePath.match(/^\/repos\/(\d+)/);
    if (repoMatch) {
      if (!repos.length) return;
      const repo = repos.find((r) => String(r.id) === String(repoMatch[1]));
      if (repo && selectedRepo !== repo.full_name) setSelectedRepo(repo.full_name);
      return;
    }
    if (selectedRepo !== ALL_REPOS) setSelectedRepo(ALL_REPOS);
  }, [pathname, repos, selectedRepo, setSelectedRepo]);

  // Keep All sessions context on /sessions/:id so the logo and picker stay on `/`.
  useEffect(() => {
    if (isSessionHomePathname(pathname)) return;
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

  const [pendingAgentConfigId, setPendingAgentConfigId] = useState(null);
  const [switchingAgentSdk, setSwitchingAgentSdk] = useState(false);

  const handleModelChange = (modelId, modelParams = null) => {
    if (!session?.id) return;
    const patch = { model: modelId, model_params: modelParams };
    if (!activeAgent?.id) return;
    agentsService
      .patch(activeAgent.id, patch)
      .catch((err) => toastFeathersError('Failed to change model', err));
  };

  const applyAgentConfigChange = async (configId, { clearModel = false } = {}) => {
    if (!session?.id || !configId || switchingAgentSdk) return;
    const picked = configOptions.find((c) => c.key === String(configId));
    if (!activeAgent?.id) return;
    setSwitchingAgentSdk(true);
    try {
      await agentsService.patch(activeAgent.id, {
        agent_config_id: Number(configId),
        agent_sdk: picked?.sdk ?? undefined,
        ...modelPatchFromConfigDefault(picked, { clearIfMissing: clearModel }),
      });
      setPendingAgentConfigId(null);
    } catch (err) {
      toastFeathersError('Failed to switch agent configuration', err);
    } finally {
      setSwitchingAgentSdk(false);
    }
  };

  const handleAgentConfigChangeRequest = (configId) => {
    if (!session?.id || session?.archived_at || session?.status === 'archiving') return;
    const isReviewer = activeAgent?.agent_type === 'reviewer';
    const currentConfigId = isReviewer
      ? (activeAgent?.agent_config_id ?? session.review_agent_config_id)
      : (activeAgent?.agent_config_id ?? session.agent_config_id);
    if (!configId || String(configId) === String(currentConfigId)) return;
    const next = configOptions.find((c) => c.key === String(configId));
    const current = configOptions.find((c) => c.key === String(currentConfigId));
    const currentSdk = current?.sdk ?? session.agent_sdk;
    const nextSdk = next?.sdk;
    if (nextSdk && currentSdk && String(nextSdk) === String(currentSdk)) {
      void applyAgentConfigChange(configId);
      return;
    }
    setPendingAgentConfigId(configId);
  };

  const handleAgentSdkSwitchCancel = () => {
    if (switchingAgentSdk) return;
    setPendingAgentConfigId(null);
  };

  const handleAgentSdkSwitchConfirm = () => {
    if (!pendingAgentConfigId) return;
    void applyAgentConfigChange(pendingAgentConfigId, { clearModel: true });
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
    tasksService.kill(taskId).catch((err) => toastError('Failed to kill task', err));
  };

  const runConfiguredTask = (taskKey, { closeTaskLogModal = false } = {}) => {
    tasksService
      .create({ session_id: session?.id, task_key: taskKey })
      .catch((err) => toastFeathersError('Failed to start task', err));
    if (closeTaskLogModal) setActiveTaskModal(null);
  };

  const handleTaskRetry = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.task_key) {
      const cmd = configCommands.find((c) => c.label === task.task_key);
      if (cmd?.confirm) {
        setPendingTaskConfirm({
          ...taskConfirmStateFromCommand(cmd, task.task_key),
          closeTaskLogModal: true,
        });
        return;
      }
      runConfiguredTask(task.task_key, { closeTaskLogModal: true });
      return;
    }
    tasksService
      .create({ session_id: session?.id, command: task.command })
      .catch((err) => toastFeathersError('Failed to start task', err));
    setActiveTaskModal(null);
  };

  const handleTaskDelete = (taskId) => {
    tasksService.remove(taskId).catch((err) => toastError('Failed to delete task', err));
  };

  const handleViewTaskLogs = (taskId) => {
    setActiveTaskModal(taskId);
  };

  const linkedSessionRepo =
    session?.repo_id != null || session?.repo_full_name
      ? repos.find(
          (r) =>
            (session.repo_id != null && r.id === session.repo_id) ||
            r.full_name === session.repo_full_name
        )
      : null;
  const sessionIsLocalRepo = Boolean(
    session?.repo_full_name && isLocalRepo(linkedSessionRepo ?? session.repo_full_name)
  );
  const sessionAutoPushOn = sessionIsLocalRepo ? false : !!session?.auto_push;

  const handleAutoPushChange = (enabled) => {
    if (!session?.id || sessionIsLocalRepo) return;
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
    beginLocalPush();
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
      endLocalPush();
    }
  };

  const setSidePanelTab = useCallback(
    (tab, { openMobile = true } = {}) => {
      if (isNewSessionRoute || !SIDE_PANEL_TAB_IDS.has(tab)) return;
      setLastSidePanelTab(tab);
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
    if (isMdUp) return;
    setShowTasks(false);
    clearPanelFromUrl();
  }, [setShowTasks, isMdUp, clearPanelFromUrl]);

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
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('view', 'diff');
          if (sha && sha !== 'all') next.set('commit', sha);
          else next.delete('commit');
          if (!isMdUp) next.delete('panel');
          return next;
        },
        { replace: true }
      );
      if (!isMdUp) setShowTasks(false);
    },
    [setSearchParams, isMdUp, setShowTasks]
  );

  const toggleSidePanel = useCallback(() => {
    if (showTasks) {
      setShowTasks(false);
      clearPanelFromUrl();
      return;
    }
    const tab =
      activeView === 'diff' && sidePanelTab !== 'files' && sidePanelTab !== 'commits'
        ? 'files'
        : sidePanelTab;
    setSidePanelTab(tab, { openMobile: true });
  }, [activeView, showTasks, setShowTasks, clearPanelFromUrl, setSidePanelTab, sidePanelTab]);

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
            if (showTasks) {
              const keepFilesOrCommits = prevPanel === 'files' || prevPanel === 'commits';
              next.set('panel', keepFilesOrCommits && panelIsValid ? prevPanel : 'files');
            }
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
    [isNewSessionRoute, setSearchParams, showTasks]
  );

  const handleViewBaguetteConfig = useCallback(() => {
    setShowBaguetteConfigModal(true);
  }, [setShowBaguetteConfigModal]);

  const builderIsGlobal = isNewSessionRoute
    ? pathname === '/global' || (!fromAllSessions && isGlobalSessionsRoute)
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
    model,
    modelParams,
    createNewBranch,
    branchName,
    autoPush,
    plugins,
    agentConfigId,
  }) => {
    const params = isGlobal
      ? {
          is_global: true,
          initial_prompt: initialPrompt,
        }
      : {
          repo_full_name: repoFullName,
          base_branch: branch,
          initial_prompt: initialPrompt,
          create_new_branch: createNewBranch ?? true,
          auto_push: autoPushEnabledForRepo(
            repoFullName,
            autoPush,
            repos.find((r) => r.full_name === repoFullName)
          ),
        };
    if (agentConfigId) params.agent_config_id = agentConfigId;
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
      navigate(sessionUrl(created.id));
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
  }, [routeSessionId, viewParam, setSearchParams, setShowTasks]);

  useEffect(() => {
    if (panelParam === 'preview') {
      if (!isNewSessionRoute && sessionLoading && !(session ?? sessionFromHook)) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('panel');
          next.set('view', 'preview');
          return next;
        },
        { replace: true }
      );
      return;
    }
    const sessionForView = session ?? sessionFromHook;
    if (
      sessionForView &&
      isGlobalSession(sessionForView) &&
      isGlobalSessionDisabledView(viewParam)
    ) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('view');
          next.delete('commit');
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
    routeSessionId,
    activeView,
    panelParam,
    viewParam,
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
    if (readonly && !sessions.some((s) => String(s.id) === String(routeSessionId))) {
      return sortSessionsForList([session, ...sessions.filter((s) => s.id !== session.id)]);
    }
    return sessions;
  }, [session, sessions, routeSessionId, isNewSessionRoute]);

  const hideSessionListRepo = useMemo(() => {
    const keys = new Set(
      sidebarSessions.map((s) => (isGlobalSession(s) ? '__global__' : s.repo_full_name || ''))
    );
    return keys.size <= 1;
  }, [sidebarSessions]);

  const handleSessionDeletedPermanently = useCallback(() => {
    refetchSessions({ silent: true });
    const firstSession = nextVisibleSession({
      sessions,
      sessionId: routeSessionId,
      session,
      repoId,
      fromAllSessions,
    });
    navigate(firstSession ? sessionUrl(firstSession.id) : homeUrl);
  }, [
    sessions,
    routeSessionId,
    session,
    repoId,
    fromAllSessions,
    navigate,
    sessionUrl,
    homeUrl,
    refetchSessions,
  ]);

  const mobilePreferList =
    !isMdUp && (isSessionHomePathname(pathname) || isLoopHomePathname(pathname));
  const highlightNewCreate =
    !mobilePreferList && (isLoopsView ? isNewLoopRoute : isNewSessionRoute);
  const showWorkspaceHeader =
    !mobilePreferList &&
    (isLoopsView
      ? isNewLoopRoute || Boolean(loopWorkspace.loop)
      : isNewSessionRoute || Boolean(session));

  const isReadonly =
    !isNewSessionRoute && (!!session?.archived_at || session?.status === 'archiving');
  const isArchiving =
    !isNewSessionRoute && !session?.archived_at && session?.status === 'archiving';

  useLayoutEffect(() => {
    if (isNewSessionRoute) return;
    scrollActiveViewTabIntoView();
    const frame = requestAnimationFrame(() => {
      scrollActiveViewTabIntoView();
      requestAnimationFrame(scrollActiveViewTabIntoView);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeView, isNewSessionRoute, routeSessionId, viewTabStripKey, scrollActiveViewTabIntoView]);

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
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (activeView !== 'diff') next.set('view', 'diff');
          if (!isMdUp) next.delete('panel');
          return next;
        },
        { replace: true }
      );
      if (sessionDiffFileByFile) {
        setSelectedDiffFile(path);
        setPendingSidebarDiffFile(null);
      } else if (sessionDiffLoading) {
        setPendingSidebarDiffFile(path);
      } else {
        setScrollToDiffFile(path);
        setPendingSidebarDiffFile(null);
      }
      if (!isMdUp) setShowTasks(false);
    },
    [
      activeView,
      sessionDiffFileByFile,
      sessionDiffLoading,
      isMdUp,
      setSearchParams,
      setShowTasks,
      setSelectedDiffFile,
      setPendingSidebarDiffFile,
    ]
  );

  const clearScrollToDiffFile = useCallback(() => setScrollToDiffFile(null), []);

  const suppressOpenSessionUnread =
    !isNewSessionRoute &&
    !sessionLoading &&
    String(sessionFromHook?.id ?? '') === String(routeSessionId) &&
    sessionNeedsLastViewedUpdate(sessionFromHook);

  const sessionNotFound =
    !isNewSessionRoute &&
    routeSessionId &&
    !sessionLoading &&
    !sessionFromHook &&
    isFeathersNotFound(sessionLoadError);

  if (sessionNotFound) {
    return (
      <div className="flex-1 min-h-0 overflow-auto">
        <NotFound
          title="Session not found"
          message="This session may have been deleted or you may not have access to it."
        />
      </div>
    );
  }

  if (isLoopsView && loopWorkspace.loopNotFound) {
    return (
      <div className="flex-1 min-h-0 overflow-auto">
        <NotFound
          title="Loop not found"
          message="This loop may have been deleted or you may not have access to it."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {showWorkspaceHeader && (
        <SessionWorkspaceHeader
          isLoopsView={isLoopsView}
          routeLoopId={routeLoopId}
          loopWorkspace={loopWorkspace}
          isNewLoopRoute={isNewLoopRoute}
          loopsHomeUrl={loopsHomeUrl}
          showRepoDetails={showRepoDetails}
          isNewSessionRoute={isNewSessionRoute}
          homeUrl={homeUrl}
          headerSession={headerSession}
          isMdUp={isMdUp}
          loopEditUrl={loopEditUrl}
          handlePush={handlePush}
          pushing={pushing}
          commitsToPush={commitsToPush}
          session={session}
          prInfo={prInfo}
        />
      )}

      <SessionStatusBanners
        session={session}
        isArchiving={isArchiving}
        isReadonly={isReadonly}
        error={error}
        onDismissError={() => setError(null)}
      />

      {/* Sidebar (full height) + main column (tabs + views + tasks) */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <SessionListRail
          sessionsSidebarElRef={sessionsSidebarElRef}
          mobilePreferList={mobilePreferList}
          sessionsSidebarResizing={sessionsSidebarResizing}
          showSidebar={showSidebar}
          isSidebarOpen={isSidebarOpen}
          sessionsSidebarWidth={sessionsSidebarWidth}
          isSidebarOpenForResize={isSidebarOpen}
          onSessionsSidebarResizeStart={(event) =>
            handleSessionsSidebarResizeStart(event, sessionsSidebarWidth, setSessionsSidebarWidth)
          }
          homeUrl={homeUrl}
          loopsHomeUrl={loopsHomeUrl}
          isLoopsView={isLoopsView}
          highlightNewCreate={highlightNewCreate}
          onNewLoop={() => navigate(loopNewUrl())}
          onNewSession={() => {
            setCreateSessionError(null);
            navigate(sessionNewUrl());
          }}
          loopsLoaded={loopsLoaded}
          loops={loops}
          routeLoopId={routeLoopId}
          isNewLoopRoute={isNewLoopRoute}
          mobilePreferListForHighlight={mobilePreferList}
          reloadLoops={reloadLoops}
          onDeleteLoop={loopWorkspace.handleDeleteLoop}
          sidebarSessions={sidebarSessions}
          routeSessionId={routeSessionId}
          isNewSessionRoute={isNewSessionRoute}
          hideSessionListRepo={hideSessionListRepo}
          suppressOpenSessionUnread={suppressOpenSessionUnread}
          hasMoreSessions={hasMoreSessions}
          sessionsLength={sessions.length}
          onLoadMoreSessions={loadMoreSessions}
        />

        <div
          className={`${mobilePreferList ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col md:min-w-[var(--session-main-min-w)]`}
          style={{ '--session-main-min-w': `${SESSION_MAIN_MIN_WIDTH}px` }}
        >
          <SessionViewTabs
            isLoopsView={isLoopsView}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setShowSidebar(!isSidebarOpen)}
            loopTabActive={loopTabActive}
            isNewLoopRoute={isNewLoopRoute}
            onLoopTabChange={loopWorkspace.setLoopTab}
            viewTabsScrollRef={viewTabsScrollRef}
            activeViewTabRef={activeViewTabRef}
            globalSessionViewDisabled={globalSessionViewDisabled}
            isNewSessionRoute={isNewSessionRoute}
            activeView={activeView}
            onViewTabClick={handleViewTabClick}
            openIssuesTabCount={openIssuesTabCount}
            toggleSidePanel={toggleSidePanel}
            showTasks={showTasks}
            reviewer={reviewer}
          />

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {isLoopsView && (
              <LoopWorkspaceBody
                workspaceOpen={loopWorkspace.workspaceOpen}
                loopLoading={loopWorkspace.loopLoading}
                loopLoadFailed={loopWorkspace.loopLoadFailed}
                onRetryLoadLoop={loopWorkspace.retryLoadLoop}
                isNewLoopRoute={isNewLoopRoute}
                activeTab={loopWorkspace.activeTab}
                loop={loopWorkspace.loop}
                editingLoop={loopWorkspace.editingLoop}
                saving={loopWorkspace.saving}
                builderIsGlobal={loopWorkspace.builderIsGlobal}
                builderRepoFullName={loopWorkspace.builderRepoFullName}
                builderAllowRepoChoice={loopWorkspace.builderAllowRepoChoice}
                onCreateLoop={loopWorkspace.handleCreateLoop}
                onUpdateLoop={loopWorkspace.handleUpdateLoop}
                onDeleteLoop={() => loopWorkspace.handleDeleteLoop()}
                runSessions={loopWorkspace.runSessions}
                runsLoading={loopWorkspace.runsLoading}
                runsLoaded={loopWorkspace.runsLoaded}
              />
            )}
            {!isLoopsView && isNewSessionRoute && (
              <SessionCreateBody
                creatingSession={creatingSession}
                createSessionError={createSessionError}
                onDismissCreateError={() => setCreateSessionError(null)}
                newSessionFormKey={newSessionFormKey}
                builderAllowRepoChoice={builderAllowRepoChoice}
                builderRepoFullName={builderRepoFullName}
                onSubmit={handleCreateSession}
                loading={creatingSession}
                isGlobal={builderIsGlobal}
              />
            )}
            {!isLoopsView && awaitingSession && (
              <div className="flex flex-1 min-h-0 items-center justify-center bg-page">
                <Loader2
                  className="w-8 h-8 animate-spin text-accent"
                  aria-label="Loading session"
                />
              </div>
            )}
            {!isLoopsView &&
              !isNewSessionRoute &&
              !awaitingSession &&
              session &&
              activeView === 'chat' && (
                <ChatView
                  messages={messages}
                  loading={chatLoading}
                  loadMore={loadMore}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  session={session}
                  activeAgent={activeAgent}
                  agents={agents}
                  onSelectAgent={selectAgent}
                  systemPrompt={systemPrompt}
                  onViewChange={setView}
                  readonly={isReadonly}
                  onModelChange={handleModelChange}
                  onAgentConfigChange={handleAgentConfigChangeRequest}
                  onAutoPushChange={handleAutoPushChange}
                  autoPushDisabled={sessionIsLocalRepo}
                  autoPush={sessionAutoPushOn}
                  cursorModelPrefs={cursorModelPrefs}
                  onCursorModelPrefChange={setCursorModelPref}
                  commitsToPush={commitsToPush}
                  onPush={handlePush}
                  pushing={pushing}
                  onDeletePermanently={handleSessionDeletedPermanently}
                />
              )}
            {!isLoopsView &&
              !isNewSessionRoute &&
              !awaitingSession &&
              session &&
              activeView === 'review' && (
                <ReviewView
                  session={session}
                  readonly={isReadonly}
                  issues={sessionIssues}
                  issuesLoading={sessionIssuesLoading}
                  onOpenReviewerChat={selectAgent}
                />
              )}
            {!isLoopsView &&
              !isNewSessionRoute &&
              !awaitingSession &&
              session &&
              activeView === 'diff' && (
                <DiffView
                  session={session}
                  selectedCommit={selectedDiffCommit}
                  commits={branchCommits}
                  onSelectedCommitChange={handleDiffCommitChange}
                  onRefreshCommits={refreshBranchCommits}
                  onRefreshChangedFiles={refreshChangedFiles}
                  commitsLoading={branchCommitsLoading}
                  changedFilesLoading={changedFilesLoading}
                  diff={sessionDiff}
                  diffLoading={sessionDiffLoading}
                  diffError={sessionDiffError}
                  diffStale={sessionDiffStale}
                  diffHasFetched={sessionDiffHasFetched}
                  onRefreshDiff={refreshSessionDiff}
                  fileByFile={sessionDiffFileByFile}
                  changedFiles={diffFiles}
                  selectedFile={diffSelectorFile}
                  onSelectedFileChange={setSelectedDiffFile}
                  scrollToFile={scrollToDiffFile}
                  onScrolledToFile={clearScrollToDiffFile}
                  readonly={isReadonly}
                  onModelChange={handleModelChange}
                  onAgentConfigChange={handleAgentConfigChangeRequest}
                  cursorModelPrefs={cursorModelPrefs}
                  onCursorModelPrefChange={setCursorModelPref}
                />
              )}
            {!isLoopsView &&
              !isNewSessionRoute &&
              !awaitingSession &&
              session &&
              activeView === 'preview' && (
                <PreviewView
                  session={session}
                  readonly={isReadonly}
                  onViewLogs={handleViewTaskLogs}
                />
              )}
            {!isLoopsView &&
              !isNewSessionRoute &&
              !awaitingSession &&
              session &&
              activeView === 'plan' && <PlanView session={session} readonly={isReadonly} />}
            {!isLoopsView &&
              !isNewSessionRoute &&
              !awaitingSession &&
              session &&
              activeView === 'details' && (
                <DetailsView session={session} readonly={isReadonly} onSessionUpdate={setSession} />
              )}
          </div>

          {!isNewSessionRoute && (
            <SessionMainViewFooter
              session={session}
              onShowTasks={() => setSidePanelTab('tasks')}
              onShowAgents={() => setSidePanelTab('agents')}
            />
          )}
        </div>

        {/* Task / files / reviewer panel — drawer below md, inline column md+ */}
        {showTasks && !isNewSessionRoute && (
          <div
            className="md:hidden fixed inset-0 z-30 bg-black/50"
            onClick={hideSidePanel}
            aria-hidden={false}
          />
        )}
        {isSidePanelOpen && (
          <div
            ref={sidePanelElRef}
            className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-line bg-nav fixed inset-y-0 right-0 z-40 w-[85vw] max-w-sm md:relative md:inset-auto md:z-auto md:w-[var(--side-panel-w)] md:max-w-[min(85vw,100%)]"
            style={{ '--side-panel-w': `${sidePanelWidth}px` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize side panel"
              onPointerDown={(event) =>
                handleSidePanelResizeStart(event, sidePanelWidth, setSidePanelWidth)
              }
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
              selectedDiffFilePath={
                diffViewActive && sessionDiffFileByFile ? diffSelectorFile : null
              }
              branchCommits={branchCommits}
              branchCommitsLoading={branchCommitsLoading}
              onRefreshBranchCommits={refreshBranchCommits}
              selectedDiffCommit={selectedDiffCommit}
              diffViewActive={diffViewActive}
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
              chatOpen={chatViewOpen}
              agentLabelById={agentLabelById}
              sessionId={sessionId}
              selectedAgentId={activeAgent?.id}
              onSelectAgent={selectAgent}
              onReviewerCleared={handleReviewerCleared}
            />
          </div>
        )}
      </div>

      <SessionWorkspaceModals
        pendingAgentConfigId={pendingAgentConfigId}
        session={session}
        configOptions={configOptions}
        switchingAgentSdk={switchingAgentSdk}
        onAgentSdkSwitchConfirm={handleAgentSdkSwitchConfirm}
        onAgentSdkSwitchCancel={handleAgentSdkSwitchCancel}
        pendingTaskConfirm={pendingTaskConfirm}
        onTaskConfirmCancel={() => setPendingTaskConfirm(null)}
        onTaskConfirm={() => {
          runConfiguredTask(pendingTaskConfirm.taskKey, {
            closeTaskLogModal: pendingTaskConfirm.closeTaskLogModal,
          });
          setPendingTaskConfirm(null);
        }}
        showPushModal={showPushModal}
        repos={repos}
        commitsToPush={commitsToPush}
        pushRequest={pushRequest}
        sessionAutoPushOn={sessionAutoPushOn}
        sessionIsLocalRepo={sessionIsLocalRepo}
        onAutoPushChange={handleAutoPushChange}
        onPushConfirmed={handlePushConfirmed}
        onPushCancel={() => {
          setShowPushModal(false);
          setPushRequest(null);
        }}
        activeTaskModal={activeTaskModal}
        tasks={tasks}
        onTaskKill={handleTaskKill}
        onTaskRetry={handleTaskRetry}
        onCloseTaskLog={() => setActiveTaskModal(null)}
        showBaguetteConfigModal={showBaguetteConfigModal}
        onCloseBaguetteConfig={() => setShowBaguetteConfigModal(false)}
      />
    </div>
  );
}
