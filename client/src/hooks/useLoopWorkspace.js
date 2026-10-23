import { useState, useEffect, useMemo, useCallback } from 'react';
import { deleteLoopWithConfirm } from '../utils/deleteLoop.js';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { loopsService, sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { isFeathersNotFound } from '../utils/feathersErrors.js';
import { useFilterRoutes } from './useFilterRoutes.js';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import { isAllSessionsPath } from '@baguette/shared/session-scope.js';
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
  const activeTab = viewParam === 'runs' ? 'runs' : 'edit';
  const { loopEditUrl, loopsHomeUrl } = useFilterRoutes();
  const { selectedRepo } = useRepoContext();
  const fromAllSessions = isAllSessionsPath(pathname);

  const workspaceOpen = isNewLoopRoute || Boolean(routeLoopId);

  const [fetchedLoop, setFetchedLoop] = useState(null);
  const [loopNotFound, setLoopNotFound] = useState(false);
  const [loopLoadFailed, setLoopLoadFailed] = useState(false);
  const [loopLoadAttempt, setLoopLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [runSessions, setRunSessions] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsLoaded, setRunsLoaded] = useState(false);

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
    if (!loop?.id || activeTab !== 'runs') return;
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
  }, [loop?.id, activeTab]);

  const builderIsGlobal = useMemo(() => {
    if (editingLoop) return !!editingLoop.is_global;
    if (fromAllSessions) return false;
    return selectedRepo === GLOBAL_SCOPE || pathname.startsWith('/global/loops');
  }, [editingLoop, fromAllSessions, selectedRepo, pathname]);

  const builderRepoFullName = useMemo(() => {
    if (editingLoop) {
      return editingLoop.is_global ? null : editingLoop.repo_full_name;
    }
    if (fromAllSessions || selectedRepo === ALL_REPOS) return null;
    if (selectedRepo === GLOBAL_SCOPE) return null;
    return selectedRepo;
  }, [editingLoop, fromAllSessions, selectedRepo]);

  const builderAllowRepoChoice = fromAllSessions || selectedRepo === ALL_REPOS;

  const setLoopTab = (tab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === 'edit') next.delete('view');
        else next.set('view', 'runs');
        return next;
      },
      { replace: true }
    );
  };

  const handleCreateLoop = async (payload) => {
    setSaving(true);
    try {
      const created = await loopsService.create(payload);
      toast.success(`Loop created — ${created.name || 'first run'} scheduled`);
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
    handleDeleteLoop,
    headerTitle,
    headerSubtitle,
  };
}
