import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import { apiFetch } from '../api.js';
import { secretsService, usersService, reposService, pluginsService } from '../feathers.js';

// ─── SecretsTab ───────────────────────────────────────────────────────────────

function SecretsTab() {
  const [variables, setVariables] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    secretsService
      .find()
      .then((d) => setVariables(d.data))
      .catch((err) => toastError('Failed to load secrets', err));
  };

  useEffect(load, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setSaving(true);
    try {
      await secretsService.create({ key: newKey.trim(), value: newValue });
      setNewKey('');
      setNewValue('');
      load();
    } catch (err) {
      toastError('Failed to add secret', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await secretsService.remove(id);
      load();
    } catch (err) {
      toastError('Failed to delete secret', err);
    }
  };

  return (
    <div>
      <p className="text-zinc-400 text-sm mb-4">
        Secrets are available in <code className="text-zinc-300">.baguette.yaml</code> config where
        they can be assigned to environment variables.
      </p>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6">
        {variables.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-8">No secrets configured</p>
        )}
        {variables.map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-0 gap-2"
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <code className="text-sm text-amber-400 font-medium shrink-0">{v.key}</code>
              <code className="text-sm text-zinc-400 truncate hidden sm:block">{v.safeValue}</code>
            </div>
            <button
              onClick={() => handleDelete(v.id)}
              className="text-xs text-red-500 hover:text-red-400 shrink-0"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleAdd}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5"
      >
        <h2 className="text-sm font-medium text-zinc-300 mb-3">Add Secret</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="KEY"
            className="sm:w-40 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
          <button
            type="submit"
            disabled={saving || !newKey.trim()}
            className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── RepositoriesTab ──────────────────────────────────────────────────────────

function RepositoriesTab() {
  const [repos, setRepos] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    reposService
      .findAll({})
      .then(setRepos)
      .catch((err) => toastError('Failed to load repositories', err));
  }, []);

  useEffect(() => {
    load();
    reposService.on('created', load);
    reposService.on('removed', load);
    return () => {
      reposService.off('created', load);
      reposService.off('removed', load);
    };
  }, [load]);

  const handleDeleteClick = (repo) => setConfirmDelete(repo);
  const handleDeleteCancel = () => setConfirmDelete(null);

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await reposService.remove(confirmDelete.id);
      setConfirmDelete(null);
      load();
    } catch (err) {
      toastError('Failed to delete repository', err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <p className="text-zinc-400 text-sm mb-4">
        Repositories registered system-wide. Deleting one removes all sessions, worktrees, and the
        clone for all users.
      </p>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6">
        {repos.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-8">No repositories registered</p>
        )}
        {repos.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-0 gap-3"
          >
            <div className="min-w-0">
              <code className="text-sm text-white font-medium">{r.full_name}</code>
              <div className="text-xs text-zinc-500 mt-0.5">
                {r.session_count} session(s) · {r.exists_on_fs ? 'On disk' : 'Not on disk'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleDeleteClick(r)}
                disabled={deletingId !== null}
                className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl max-w-md w-full p-5">
            <h3 className="text-lg font-semibold text-white mb-2">Delete repository?</h3>
            <p className="text-zinc-400 text-sm mb-4">
              <strong className="text-white">{confirmDelete.full_name}</strong> and all its data
              will be permanently removed for all users.
            </p>
            <div className="bg-amber-900/30 border border-amber-700 rounded-lg px-3 py-2 text-sm text-amber-200 mb-4">
              This will delete all sessions linked to this repo, their worktrees, and the bare
              clone. This cannot be undone.
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleDeleteCancel}
                className="px-4 py-2 text-sm text-zinc-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deletingId !== null}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {deletingId !== null ? 'Deleting…' : 'Delete repository'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UsersTab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState([]);

  const load = () => {
    usersService.find().then((d) => setUsers(d.data));
  };

  useEffect(load, []);

  const handleApprove = async (id) => {
    await usersService.approve(id);
    load();
  };

  const handleReject = async (id) => {
    await usersService.reject(id);
    load();
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {users.length === 0 && (
        <p className="text-zinc-600 text-sm text-center py-8">No users found</p>
      )}
      {users.map((u) => (
        <div
          key={u.id}
          className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-0 gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
            <div className="min-w-0">
              <div className="text-sm text-white font-medium truncate">{u.username}</div>
              <div className="text-xs text-zinc-500">
                Joined {new Date(u.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {u.approved ? (
              <>
                <span className="text-xs text-emerald-400 hidden sm:inline">Approved</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 sm:hidden" />
                <button
                  onClick={() => handleReject(u.id)}
                  className="text-xs text-red-500 hover:text-red-400 ml-1"
                >
                  Revoke
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-amber-400 hidden sm:inline">Pending</span>
                <span className="w-2 h-2 rounded-full bg-amber-400 sm:hidden" />
                <button
                  onClick={() => handleApprove(u.id)}
                  className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded ml-1"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReject(u.id)}
                  className="text-xs text-red-500 hover:text-red-400"
                >
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── DockerTab ────────────────────────────────────────────────────────────────

function DockerTab() {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [services, setServices] = useState([]);
  const [containers, setContainers] = useState([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  const loadContent = () => {
    apiFetch('/api/settings/docker-compose').then((d) => setContent(d.content));
  };

  const loadServices = () => {
    setLoadingServices(true);
    Promise.all([
      apiFetch('/api/settings/docker-compose/services').catch(() => ({ services: [] })),
      apiFetch('/api/settings/docker-compose/containers').catch(() => ({ containers: [] })),
    ])
      .then(([svcData, ctrData]) => {
        setServices(svcData.services || []);
        setContainers(ctrData.containers || []);
      })
      .finally(() => setLoadingServices(false));
  };

  useEffect(() => {
    loadContent();
    loadServices();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch('/api/settings/docker-compose', {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadServices();
    } catch (err) {
      toastError('Failed to save Docker config', err);
    } finally {
      setSaving(false);
    }
  };

  const handleContainerAction = async (name, action) => {
    setActionLoading(`${name}:${action}`);
    try {
      await apiFetch(`/api/settings/docker-compose/containers/${name}/${action}`, {
        method: 'POST',
      });
      loadServices();
    } catch (err) {
      toastError(`Failed to ${action} container`, err);
    } finally {
      setActionLoading(null);
    }
  };

  const statusColor = (state) => {
    if (!state) return 'bg-zinc-600';
    const s = state.toLowerCase();
    if (s.includes('running')) return 'bg-emerald-400';
    if (s.includes('exited') || s.includes('dead')) return 'bg-red-400';
    if (s.includes('paused') || s.includes('restarting')) return 'bg-amber-400';
    return 'bg-zinc-500';
  };

  // Merge services from YAML with container status
  const containerByService = {};
  for (const c of containers) {
    const name = c.Service || c.Name || c.service || c.name;
    if (name) containerByService[name] = c;
  }

  // All service names: defined in YAML + any containers not in YAML
  const allServiceNames = [
    ...services,
    ...containers
      .map((c) => c.Service || c.Name || c.service || c.name)
      .filter((n) => n && !services.includes(n)),
  ];

  return (
    <div>
      <p className="text-zinc-400 text-sm mb-4">
        Global Docker Compose configuration stored in the data directory. Services defined here are
        available to all sessions.
      </p>

      <div className="mb-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={18}
          spellCheck={false}
          className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-y leading-relaxed"
          placeholder="# docker-compose.yml"
        />
      </div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
      </div>

      <h2 className="text-sm font-medium text-zinc-300 mb-3">Services</h2>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loadingServices && allServiceNames.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-6">Loading…</p>
        )}
        {!loadingServices && allServiceNames.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-6">
            No services defined. Add services to your docker-compose.yml and save.
          </p>
        )}
        {allServiceNames.map((name) => {
          const c = containerByService[name];
          const state = c ? c.State || c.state || '' : '';
          const image = c ? c.Image || c.image || '' : '';
          const _isRunning = state.toLowerCase().includes('running');
          return (
            <div
              key={name}
              className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-0 gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(state)}`} />
                <div className="min-w-0">
                  <code className="text-sm text-white font-medium">{name}</code>
                  <div className="text-xs text-zinc-500 mt-0.5 truncate">
                    {image && <span>{image}</span>}
                    {state ? (
                      <span className="ml-2">{state}</span>
                    ) : (
                      <span className="ml-2 italic">not started</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!c && (
                  <button
                    onClick={() => handleContainerAction(name, 'up')}
                    disabled={actionLoading !== null}
                    className="text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    {actionLoading === `${name}:up` ? '…' : 'Start'}
                  </button>
                )}
                {c &&
                  ['start', 'stop', 'restart'].map((action) => (
                    <button
                      key={action}
                      onClick={() => handleContainerAction(name, action)}
                      disabled={actionLoading !== null}
                      className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50 capitalize"
                    >
                      {actionLoading === `${name}:${action}` ? '…' : action}
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      {allServiceNames.length > 0 && (
        <button
          onClick={loadServices}
          disabled={loadingServices}
          className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {loadingServices ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}

// ─── PluginsTab ───────────────────────────────────────────────────────────────

function PluginsTab() {
  const [plugins, setPlugins] = useState([]);
  const [input, setInput] = useState('');
  const [installing, setInstalling] = useState(false);
  const [refreshingId, setRefreshingId] = useState(null);

  const load = useCallback(() => {
    pluginsService
      .find()
      .then((data) => setPlugins(Array.isArray(data) ? data : []))
      .catch((err) => toastError('Failed to load plugins', err));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInstall = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setInstalling(true);
    try {
      const result = await pluginsService.create({ input: input.trim() });
      setInput('');
      load();
      const installed = result.installed?.length ?? 0;
      const skipped = result.skipped?.length ?? 0;
      if (installed > 0) {
        toast.success(
          `Installed ${installed} plugin${installed !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} already up to date` : ''}`
        );
      } else if (skipped > 0) {
        toast.success(`All ${skipped} plugin${skipped !== 1 ? 's' : ''} already up to date`);
      }
    } catch (err) {
      toastError('Failed to install plugin', err);
    } finally {
      setInstalling(false);
    }
  };

  const handleRefresh = async (plugin) => {
    setRefreshingId(plugin.id);
    try {
      const result = await pluginsService.refresh({ id: plugin.id });
      load();
      toast.success(result.refreshed ? 'Plugin updated' : 'Already up to date');
    } catch (err) {
      toastError('Failed to refresh plugin', err);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRemove = async (plugin) => {
    try {
      await pluginsService.remove(plugin.id);
      load();
    } catch (err) {
      toastError('Failed to remove plugin', err);
    }
  };

  // Group plugins by marketplace_repo
  const grouped = plugins.reduce((acc, p) => {
    if (!acc[p.marketplace_repo]) acc[p.marketplace_repo] = [];
    acc[p.marketplace_repo].push(p);
    return acc;
  }, {});

  return (
    <div>
      <p className="text-zinc-400 text-sm mb-4">
        Install Claude Code plugins from GitHub. Plugins are available when starting new sessions.
        Each plugin must contain a <code className="text-zinc-300">.claude-plugin/plugin.json</code>{' '}
        file.
      </p>

      <form
        onSubmit={handleInstall}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 mb-6"
      >
        <h2 className="text-sm font-medium text-zinc-300 mb-1">Install Plugin</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Enter a GitHub URL: repo root (e.g. <code className="text-zinc-400">…/tree/main</code>) or
          a subdirectory (e.g. <code className="text-zinc-400">…/tree/main/plugins/foo</code>).
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://github.com/owner/repo/tree/main"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-mono min-w-0"
          />
          <button
            type="submit"
            disabled={installing || !input.trim()}
            className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
      </form>

      {plugins.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
          <p className="text-zinc-600 text-sm text-center py-8">No plugins installed</p>
        </div>
      ) : (
        Object.entries(grouped).map(([marketplaceRepo, repoPlugins]) => (
          <div key={marketplaceRepo} className="mb-4">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
              {marketplaceRepo}
            </h3>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              {repoPlugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-0 gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-white font-medium">{plugin.name}</div>
                    <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
                      <code className="text-zinc-600 truncate">{plugin.plugin_path}</code>
                      {plugin.git_sha && (
                        <span className="text-zinc-700 font-mono shrink-0">
                          {plugin.git_sha.slice(0, 7)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRefresh(plugin)}
                      disabled={refreshingId !== null}
                      className="text-xs text-zinc-400 hover:text-white disabled:opacity-50 transition-colors"
                    >
                      {refreshingId === plugin.id ? '…' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => handleRemove(plugin)}
                      className="text-xs text-red-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Admin page ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'secrets', label: 'Secrets' },
  { id: 'repos', label: 'Repositories' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'docker', label: 'Docker' },
  { id: 'users', label: 'Users' },
];

export default function Admin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'secrets';

  const setTab = (tab) => setSearchParams({ tab });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-6">Admin</h1>

      <div className="flex border-b border-zinc-800 mb-6 gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${
              activeTab === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'secrets' && <SecretsTab />}
      {activeTab === 'repos' && <RepositoriesTab />}
      {activeTab === 'plugins' && <PluginsTab />}
      {activeTab === 'docker' && <DockerTab />}
      {activeTab === 'users' && <UsersTab />}
    </div>
  );
}
