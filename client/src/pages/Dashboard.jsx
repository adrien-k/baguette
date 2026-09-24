import { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2, Archive, Repeat } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { sessionsService, loopsService } from '../feathers.js';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useRepoContext, ALL_REPOS, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import SessionCard from '../components/SessionCard.jsx';
import BuilderForm from '../components/BuilderForm.jsx';
import LoopsPanel from '../components/LoopsPanel.jsx';
import { fileToContentBlock } from '../utils/fileToContentBlock.js';
import NoReposCard from '../components/NoReposCard.jsx';
import { toastError } from '../utils/toastError.jsx';
import { useFilters } from '../context/FilterContext.jsx';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';

function FilterToggle({ icon: Icon, label, checked, onChange }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onChange}
      className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100 transition-colors"
    >
      <Icon className="w-4 h-4 text-zinc-500 shrink-0" />
      <span>{label}</span>
      <span
        className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${checked ? 'bg-amber-500' : 'bg-zinc-600'}`}
        aria-hidden
      >
        <span
          className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}

export default function Dashboard() {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const [editingLoop, setEditingLoop] = useState(null);
  const [loopsRefresh, setLoopsRefresh] = useState(0);
  const builderRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { repoId, loopId } = useParams();
  const { homeUrl, loopEditUrl } = useFilterRoutes();
  const { sessions, loading, hasMore, loadMore } = useSessionsContext();
  const { repos, loading: loadingRepos, selectedRepo, setSelectedRepo } = useRepoContext();
  const { showArchived, setShowArchived, showLoopRuns, setShowLoopRuns } = useFilters();

  const [initDefaults, setInitDefaults] = useState(() => location.state ?? {});
  const { initRepo, initPrompt } = initDefaults;

  // Sync selectedRepo from URL: /repos/:repoId, /global, or /
  useEffect(() => {
    if (location.pathname.startsWith('/global')) {
      if (selectedRepo !== GLOBAL_SCOPE) setSelectedRepo(GLOBAL_SCOPE);
      return;
    }
    if (repoId) {
      if (!repos.length) return;
      const repo = repos.find((r) => String(r.id) === String(repoId));
      if (repo && selectedRepo !== repo.full_name) setSelectedRepo(repo.full_name);
    } else if (selectedRepo !== ALL_REPOS) {
      setSelectedRepo(ALL_REPOS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, repos, location.pathname]);

  useEffect(() => {
    if (initRepo) {
      const repo = repos.find((r) => r.full_name === initRepo);
      if (repo) navigate(`/repos/${repo.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initRepo, repos]);

  const handleCreate = async ({
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
        setCreateError(err?.message ?? 'Failed to read attached files');
        return false;
      }
    }
    setCreating(true);
    setCreateError(null);
    try {
      await sessionsService.create(params);
      setInitDefaults({});
      setFormKey((k) => k + 1);
      if (initRepo || initPrompt) {
        navigate(isGlobal ? '/global' : '/', { replace: true });
      }
      return true;
    } catch (err) {
      setCreateError(err?.message ?? 'Failed to create session');
      return false;
    } finally {
      setCreating(false);
    }
  };

  const handleCreateLoop = async (loop) => {
    const created = await loopsService.create(loop);
    setLoopsRefresh((n) => n + 1);
    toast.success(`Loop created — ${created.name || 'first run'} scheduled`);
    return created;
  };

  const handleUpdateLoop = async (id, loop) => {
    const updated = await loopsService.patch(id, loop);
    setEditingLoop(null);
    setLoopsRefresh((n) => n + 1);
    toast.success('Loop saved');
    navigate(homeUrl);
    return updated;
  };

  // Editing swaps the builder card into loop mode, which is easy to miss if it scrolled away.
  const startEditingLoop = (loop) => {
    navigate(loopEditUrl(loop.id));
  };

  useEffect(() => {
    if (!loopId) {
      setEditingLoop(null);
      return;
    }
    let cancelled = false;
    loopsService
      .get(loopId)
      .then((loop) => {
        if (cancelled) return;
        setEditingLoop(loop);
        builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch((err) => toastError('Failed to load loop', err));
    return () => {
      cancelled = true;
    };
  }, [loopId]);

  const isAllSessions = selectedRepo === ALL_REPOS;
  const isGlobal = selectedRepo === GLOBAL_SCOPE;
  const repoFilter = isAllSessions || isGlobal ? null : selectedRepo;
  const filteredSessions = sessions
    .filter((s) => showArchived || !s.archived_at)
    .filter((s) => showLoopRuns || !s.loop_id)
    .filter((s) => {
      if (isGlobal) return !!s.is_global;
      if (!repoFilter) return true;
      return s.repo_full_name === repoFilter;
    });

  const loopsQuery = useMemo(() => {
    if (isAllSessions) return {};
    if (isGlobal) return { is_global: true };
    if (selectedRepo) return { repo_full_name: selectedRepo };
    return null;
  }, [isAllSessions, isGlobal, selectedRepo]);
  const builderIsGlobal = editingLoop ? !!editingLoop.is_global : isGlobal;
  const builderRepoFullName = editingLoop
    ? editingLoop.is_global
      ? null
      : editingLoop.repo_full_name
    : isGlobal || isAllSessions
      ? null
      : selectedRepo;
  const lastCreatedTargetScope = useMemo(() => {
    if (!sessions.length) return null;
    const last = sessions.reduce((a, b) =>
      new Date(a.created_at) >= new Date(b.created_at) ? a : b
    );
    if (last.is_global) return GLOBAL_SCOPE;
    return last.repo_full_name || null;
  }, [sessions]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      {isAllSessions && (
        <h1 className="text-base font-semibold text-white mb-5 font-display">Sessions</h1>
      )}
      {isGlobal && <h1 className="text-base font-semibold text-white mb-5 font-display">Global</h1>}

      <div
        ref={builderRef}
        className="relative bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6"
      >
        {creating && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
              <p className="text-sm font-medium text-zinc-100">Starting your agent session…</p>
              <p className="text-xs text-zinc-400">This usually only takes a few seconds.</p>
            </div>
          </div>
        )}
        {createError && (
          <div className="mb-4 bg-red-900/30 border border-red-700 rounded-md px-3 sm:px-4 py-3 text-sm text-red-300">
            <div className="flex items-start justify-between gap-2">
              <p className="break-all">{createError}</p>
              <button
                onClick={() => setCreateError(null)}
                className="text-red-400 hover:text-red-200 shrink-0 text-lg leading-none"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {!loadingRepos && repos.length === 0 && !builderIsGlobal && !isAllSessions ? (
          <NoReposCard />
        ) : (
          <BuilderForm
            // Remounting on the edited loop reseeds every field from it.
            key={`builder-${formKey}-${selectedRepo}-${editingLoop?.id ?? 'new'}`}
            onSubmit={handleCreate}
            onCreateLoop={handleCreateLoop}
            onUpdateLoop={handleUpdateLoop}
            onCancelEdit={() => navigate(homeUrl)}
            editingLoop={editingLoop}
            loading={creating}
            repoFullName={builderRepoFullName}
            isGlobal={builderIsGlobal}
            allowRepoChoice={isAllSessions}
            defaultTargetScope={isAllSessions ? lastCreatedTargetScope : undefined}
            defaultPrompt={initPrompt || ''}
          />
        )}
      </div>

      {loopsQuery && (
        <LoopsPanel
          query={loopsQuery}
          editingLoopId={editingLoop?.id ?? null}
          onEdit={startEditingLoop}
          refreshToken={loopsRefresh}
        />
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-3">
        <FilterToggle
          icon={Repeat}
          label="Show loop runs"
          checked={showLoopRuns}
          onChange={() => setShowLoopRuns(!showLoopRuns)}
        />
        <FilterToggle
          icon={Archive}
          label="Show archived"
          checked={showArchived}
          onChange={() => setShowArchived(!showArchived)}
        />
      </div>

      <div className="space-y-3">
        {loading && sessions.length === 0 && (
          <p className="text-zinc-500 text-center py-12">Loading sessions...</p>
        )}
        {!loading && filteredSessions.length === 0 && sessions.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3 opacity-50">
            <img src="/baguette.svg" alt="" className="w-10 h-10" />
            <p className="text-zinc-500 text-sm">No sessions yet. Create one to get started.</p>
          </div>
        )}
        {!loading && filteredSessions.length === 0 && sessions.length > 0 && repoFilter && (
          <div className="flex flex-col items-center py-12 gap-2 opacity-50">
            <p className="text-zinc-500 text-sm">
              No sessions for {repoFilter.split('/')[1] ?? repoFilter}.
            </p>
          </div>
        )}
        {filteredSessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
        {hasMore && sessions.length > 0 && (
          <button
            onClick={loadMore}
            className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
