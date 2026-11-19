import { useState, useEffect, useMemo, useCallback } from 'react';
import { deleteLoopWithConfirm } from '../utils/deleteLoop.js';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { loopsService, sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { isFeathersNotFound } from '../utils/feathersErrors.js';
import { useFilterRoutes } from './useFilterRoutes.js';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE, SHARED_SCOPE } from '../context/RepoContext.jsx';
import { isAllSessionsPath, isSharedWithMePath } from '@baguette/shared/session-scope.js';
import {
  describeSchedule,
  formatLoopRunSubtitle,
  loopDisplayTitle,
} from '../utils/loopSchedule.js';
import { useWorkspaceHeaderEntity } from './useWorkspaceHeaderEntity.js';

/**
 * Loop editor + past runs for the Session page main column.
 * @param {{ routeLoopId?: string, isNewLoopRoute?: boolean, loops?: object[] }} options
 */
export function useLoopWorkspace({ routeLoopId, isNewLoopRoute = false, loops = [] } = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const activeTab = viewParam === 'edit' ? 'edit' : viewParam === 'runs' ? 'overview' : 'overview';
  const { loopEditUrl, loopsHomeUrl } = useFilterRoutes();
  const { selectedRepo } = useRepoContext();
  const fromAllSessions = isAllSessionsPath(pathname);
  const fromSharedWithMe = isSharedWithMePath(pathname);

  const workspaceOpen = isNewLoopRoute || Boolean(routeLoopId);

  const [fetchedLoop, setFetchedLoop] = useState(null);
  const [loopNotFound, setLoopNotFound] = useState(false);
  const [loopLoadFailed, setLoopLoadFailed] = useState(false);
  const [loopLoadAttempt, setLoopLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [runSessions, setRunSessions] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [runningLoop, setRunningLoop] = useState(false);
  const [runsReloadToken, setRunsReloadToken] = useState(0);

  const {
    entity: loop,
    headerEntity: headerLoop,
    awaiting: loopAwaiting,
  } = useWorkspaceHeaderEntity({
    routeId: routeLoopId,
    isNewRoute: isNewLoopRoute,
    fetched: fetchedLoop,
    list: loops,
  });

  const editingLoop = isNewLoopRoute ? null : loop;
  const loopLoading = loopAwaiting && !loopLoadFailed;

  const retryLoadLoop = useCallback(() => {
    setLoopLoadFailed(false);
    setLoopLoadAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!workspaceOpen || !routeLoopId || isNewLoopRoute) {
      setFetchedLoop(null);
      setLoopNotFound(false);
      setLoopLoadFailed(false);
      return;
    }
    let cancelled = false;
    setLoopNotFound(false);
    setLoopLoadFailed(false);
    loopsService
      .get(routeLoopId)
      .then((row) => {
        if (!cancelled) setFetchedLoop(row);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isFeathersNotFound(err)) {
          setLoopNotFound(true);
          setFetchedLoop(null);
        } else {
          setLoopLoadFailed(true);
          toastError('Failed to load loop', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [routeLoopId, isNewLoopRoute, workspaceOpen, loopLoadAttempt]);

  useEffect(() => {
    if (!loop?.id || activeTab !== 'overview') return;
    setRunsLoading(true);
    setRunsLoaded(false);
    sessionsService
      .find({
        query: {
          loop_id: loop.id,
          include_loop_runs: true,
          include_archived: true,
          $limit: 50,
        },
      })
      .then((d) => {
        setRunSessions(d.data ?? d);
        setRunsLoaded(true);
      })
      .catch((err) => toastError('Failed to load loop sessions', err))
      .finally(() => setRunsLoading(false));
  }, [loop?.id, activeTab, runsReloadToken]);

  const builderIsGlobal = useMemo(() => {
    if (editingLoop) return !!editingLoop.is_global;
    if (fromAllSessions || fromSharedWithMe) return false;
    return selectedRepo === GLOBAL_SCOPE || pathname.startsWith('/global/loops');
  }, [editingLoop, fromAllSessions, fromSharedWithMe, selectedRepo, pathname]);

  const builderRepoFullName = useMemo(() => {
    if (editingLoop) {
      return editingLoop.is_global ? null : editingLoop.repo_full_name;
    }
    if (fromAllSessions || fromSharedWithMe || selectedRepo === ALL_REPOS) return null;
    if (selectedRepo === GLOBAL_SCOPE || selectedRepo === SHARED_SCOPE) return null;
    return selectedRepo;
  }, [editingLoop, fromAllSessions, fromSharedWithMe, selectedRepo]);

  const builderAllowRepoChoice =
    fromAllSessions ||
    fromSharedWithMe ||
    selectedRepo === ALL_REPOS ||
    selectedRepo === SHARED_SCOPE;

  const setLoopTab = (tab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'overview') next.delete('view');
        else next.set('view', tab);
        return next;
      },
      { replace: true }
    );
  };

  const handleCancelLoopEdit = useCallback(() => {
    if (isNewLoopRoute) navigate(loopsHomeUrl);
    else setLoopTab('overview');
  }, [isNewLoopRoute, navigate, loopsHomeUrl]);

  const handleRunLoop = useCallback(async () => {
    if (!loop?.id || !loop.enabled || runningLoop) return;
    setRunningLoop(true);
    try {
      const result = await loopsService.runNow(loop.id);
      if (result?.error) {
        toastError('Loop run failed', new Error(result.error));
      } else if (result?.skipped) {
        toast(result.skipped);
      } else {
        toast.success(result?.session_id ? 'Loop run started' : 'Loop ran');
      }
      const refreshed = await loopsService.get(loop.id);
      setFetchedLoop(refreshed);
      setRunsReloadToken((n) => n + 1);
    } catch (err) {
      toastError('Failed to run loop', err);
    } finally {
      setRunningLoop(false);
    }
  }, [loop, runningLoop]);

  const handleCreateLoop = async (payload) => {
    setSaving(true);
    try {
      const created = await loopsService.create(payload);
      const scheduled =
        created.schedule_type === 'manual'
          ? 'Loop created'
          : `Loop created — ${created.name || 'first run'} scheduled`;
      toast.success(scheduled);
      navigate(loopEditUrl(created.id));
      return created;
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLoop = async (id, payload) => {
    setSaving(true);
    try {
      const updated = await loopsService.patch(id, payload);
      setFetchedLoop(updated);
      toast.success('Loop saved');
      return updated;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLoop = useCallback(
    async (targetLoop) => {
      const toDelete = targetLoop ?? loop;
      const deleted = await deleteLoopWithConfirm(toDelete);
      if (!deleted) return;
      if (String(toDelete.id) === String(routeLoopId)) {
        navigate(loopsHomeUrl);
      }
    },
    [loop, routeLoopId, navigate, loopsHomeUrl]
  );

  const headerTitle = isNewLoopRoute ? 'New loop' : loopDisplayTitle(headerLoop);
  const headerSubtitle = headerLoop
    ? [formatLoopRunSubtitle(headerLoop), describeSchedule(headerLoop)].filter(Boolean).join(' · ')
    : null;

  return {
    workspaceOpen,
    loop,
    headerLoop,
    loopLoading,
    loopLoadFailed,
    retryLoadLoop,
    loopNotFound,
    saving,
    editingLoop,
    activeTab,
    setLoopTab,
    runSessions,
    runsLoading,
    runsLoaded,
    builderIsGlobal,
    builderRepoFullName,
    builderAllowRepoChoice,
    handleCreateLoop,
    handleUpdateLoop,
    handleCancelLoopEdit,
    handleDeleteLoop,
    handleRunLoop,
    runningLoop,
    headerTitle,
    headerSubtitle,
  };
}
