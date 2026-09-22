import { useState, useEffect } from 'react';
import { Loader2, Archive } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { sessionsService } from '../feathers.js';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useRepoContext, ALL_REPOS } from '../context/RepoContext.jsx';
import SessionCard from '../components/SessionCard.jsx';
import BuilderForm from '../components/BuilderForm.jsx';
import { apiFetch } from '../api.js';
import { fileToContentBlock } from '../utils/fileToContentBlock.js';
import NoReposCard from '../components/NoReposCard.jsx';
import { useFilters } from '../context/FilterContext.jsx';
import { repoDisplayName } from '../utils/repoDisplayName.js';
import { buildSeries, recentDays, sumBy } from '../utils/usageSeries.js';
import GithubIcon from '../components/GithubIcon.jsx';

function DimensionToggle({ value, onChange }) {
  const option = (key, label) => (
    <button
      key={key}
      type="button"
      onClick={() => onChange(key)}
      aria-pressed={value === key}
      className={`px-1.5 py-0.5 rounded transition-colors ${
        value === key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 text-xs bg-zinc-800/80 rounded p-0.5">
      {option('repo', 'By repo')}
      {option('sdk', 'By agent')}
    </div>
  );
}

function UsageGraph({ repoFilter }) {
  const [rows, setRows] = useState(null);
  const [dimension, setDimension] = useState('repo');
  const [hoveredDay, setHoveredDay] = useState(null);

  useEffect(() => {
    const query = repoFilter ? `?repo=${encodeURIComponent(repoFilter)}` : '';
    let cancelled = false;
    setHoveredDay(null);
    apiFetch(`/api/usage/breakdown${query}`)
      .then((d) => !cancelled && setRows(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repoFilter]);

  const data = rows ?? [];
  const total = data.reduce((sum, r) => sum + r.cost_usd, 0);

  // A dimension with a single value can't be broken down — drop the toggle and show the
  // other one (picking one repo, for instance, leaves only the agent split worth seeing).
  const canSplitByRepo = sumBy(data, (r) => r.repo_full_name).size > 1;
  const canSplitBySdk = sumBy(data, (r) => r.agent_sdk).size > 1;
  const showToggle = canSplitByRepo && canSplitBySdk;
  const activeDimension = showToggle ? dimension : canSplitBySdk ? 'sdk' : 'repo';

  const { series, byDay } = buildSeries(data, activeDimension);
  const days = recentDays();
  const dayTotal = (day) => [...(byDay.get(day)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const maxDay = Math.max(0, ...days.map(dayTotal));

  // maxDay can be 0 while total isn't if every row falls just outside the 30 rendered
  // days (the server window ends mid-day) — there would be nothing to draw.
  if (total === 0 || maxDay === 0) return null;

  const hoveredSeries = hoveredDay
    ? series
        .map((s) => ({ ...s, cost: byDay.get(hoveredDay)?.get(s.key) ?? 0 }))
        .filter((s) => s.cost > 0)
    : [];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 mb-4 sm:mb-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-zinc-400">
          Cost per day <span className="text-zinc-600 font-normal">(last 30d)</span>
        </span>
        <div className="flex items-center gap-3">
          {showToggle && <DimensionToggle value={dimension} onChange={setDimension} />}
          <span className="text-xs text-zinc-500">${total.toFixed(2)} total</span>
        </div>
      </div>

      <div>
        <div className="flex items-stretch gap-px h-16" onMouseLeave={() => setHoveredDay(null)}>
          {days.map((day) => {
            const costs = byDay.get(day);
            const spent = dayTotal(day);
            return (
              <div
                key={day}
                className={`flex-1 h-full flex flex-col-reverse gap-[2px] cursor-default ${
                  hoveredDay && hoveredDay !== day ? 'opacity-50' : ''
                }`}
                onMouseEnter={() => setHoveredDay(day)}
              >
                {series.map((s) => {
                  const cost = costs?.get(s.key) ?? 0;
                  if (cost <= 0) return null;
                  return (
                    <div
                      key={s.key}
                      className={`${s.color} rounded-sm`}
                      style={{ height: `${Math.max((cost / maxDay) * 100, 3)}%` }}
                    />
                  );
                })}
                {spent === 0 && (
                  <div className="bg-zinc-700/30 rounded-sm" style={{ height: '1px' }} />
                )}
              </div>
            );
          })}
        </div>
        <div className="h-4 mt-1 flex items-center gap-2 overflow-hidden">
          {hoveredDay && hoveredSeries.length > 0 && (
            <>
              <span className="text-xs text-zinc-400 shrink-0">{hoveredDay}</span>
              <span className="text-xs text-zinc-300 shrink-0">
                ${dayTotal(hoveredDay).toFixed(4)}
              </span>
              {hoveredSeries.slice(0, 3).map((s) => (
                <span key={s.key} className="flex items-center gap-1 min-w-0 shrink">
                  <span className={`w-2 h-2 rounded-sm shrink-0 ${s.color}`} />
                  <span className="text-xs text-zinc-500 truncate">{s.label}</span>
                  <span className="text-xs text-zinc-600 shrink-0">${s.cost.toFixed(4)}</span>
                </span>
              ))}
              {hoveredSeries.length > 3 && (
                <span className="text-xs text-zinc-600 shrink-0">
                  +{hoveredSeries.length - 3} more
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {series.length > 1 && (
        <div>
          <div className="flex h-2 rounded-full overflow-hidden gap-[2px] mb-2.5">
            {series.map((s) => (
              <div
                key={s.key}
                className={s.color}
                style={{ width: `${(s.total / total) * 100}%` }}
                title={`${s.title}: $${s.total.toFixed(3)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} />
                <span className="text-xs text-zinc-400 truncate max-w-48" title={s.title}>
                  {s.label}
                </span>
                <span className="text-xs text-zinc-600">${s.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const { repoId } = useParams();
  const { sessions, loading, hasMore, loadMore } = useSessionsContext();
  const { repos, loading: loadingRepos, selectedRepo, setSelectedRepo } = useRepoContext();
  const { showArchived, setShowArchived } = useFilters();

  const [initDefaults, setInitDefaults] = useState(() => location.state ?? {});
  const { initRepo, initPrompt } = initDefaults;

  // Sync selectedRepo from URL param when at /repos/:repoId
  useEffect(() => {
    if (!repos.length) return;
    if (repoId) {
      const repo = repos.find((r) => String(r.id) === String(repoId));
      if (repo && selectedRepo !== repo.full_name) setSelectedRepo(repo.full_name);
    } else {
      // At "/" — show all sessions
      if (selectedRepo !== ALL_REPOS) setSelectedRepo(ALL_REPOS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, repos]);

  useEffect(() => {
    if (initRepo) {
      const repo = repos.find((r) => r.full_name === initRepo);
      if (repo) navigate(`/repos/${repo.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initRepo, repos]);

  const handleCreate = async ({
    repoFullName,
    branch,
    initialPrompt,
    files,
    permissionMode,
    planMode,
    model,
    modelParams,
    createNewBranch,
    branchName,
    autoPush,
    plugins,
    agentSdk,
  }) => {
    const params = {
      repo_full_name: repoFullName,
      base_branch: branch,
      initial_prompt: initialPrompt,
      permission_mode: permissionMode,
      plan_mode: planMode,
      create_new_branch: createNewBranch ?? true,
      auto_push: autoPush ?? true,
    };
    if (agentSdk) params.agent_sdk = agentSdk;
    if (model) params.model = model;
    if (modelParams) params.model_params = modelParams;
    if (branchName) params.branch_name = branchName;
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
        navigate('/', { replace: true });
      }
      return true;
    } catch (err) {
      setCreateError(err?.message ?? 'Failed to create session');
      return false;
    } finally {
      setCreating(false);
    }
  };

  const isAllSessions = selectedRepo === ALL_REPOS;
  const repoFilter = isAllSessions ? null : selectedRepo;
  const filteredSessions = sessions
    .filter((s) => showArchived || !s.archived_at)
    .filter((s) => !repoFilter || s.repo_full_name === repoFilter);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      <h1 className="text-base font-semibold text-white mb-5 font-display">Sessions</h1>

      {isAllSessions && repos.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
          <p className="text-sm text-zinc-400 mb-3">Select a repository to create a session:</p>
          <div className="flex flex-wrap gap-2">
            {repos.map((r) => (
              <Link
                key={r.id}
                to={`/repos/${r.id}`}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
              >
                <GithubIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                {repoDisplayName(r.full_name)}
              </Link>
            ))}
          </div>
        </div>
      )}

      {!isAllSessions && (
        <div className="relative bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
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

          {!loadingRepos && repos.length === 0 ? (
            <NoReposCard />
          ) : (
            <BuilderForm
              key={`builder-${formKey}-${selectedRepo}`}
              onSubmit={handleCreate}
              loading={creating}
              repoFullName={selectedRepo}
              defaultPrompt={initPrompt || ''}
            />
          )}
        </div>
      )}

      <UsageGraph repoFilter={repoFilter} />

      <div className="flex justify-end mb-3">
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
          className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800/80 hover:text-zinc-100 transition-colors"
        >
          <Archive className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>Show archived</span>
          <span
            className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${showArchived ? 'bg-amber-500' : 'bg-zinc-600'}`}
            aria-hidden
          >
            <span
              className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${showArchived ? 'translate-x-3' : 'translate-x-0'}`}
            />
          </span>
        </button>
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
