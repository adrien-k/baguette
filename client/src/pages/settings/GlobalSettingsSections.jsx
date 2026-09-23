import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { toastError } from '../../utils/toastError.jsx';
import { apiFetch } from '../../api.js';
import {
  secretsService,
  usersService,
  reposService,
  pluginsService,
  slackService,
} from '../../feathers.js';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';

function SecretRow({ secret, onDelete }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-0 gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <code className="text-sm text-amber-400 font-medium shrink-0">{secret.key}</code>
        <code className="text-sm text-zinc-400 truncate hidden sm:block">{secret.safeValue}</code>
      </div>
      <button
        onClick={() => onDelete(secret.id)}
        className="text-xs text-red-500 hover:text-red-400 shrink-0"
      >
        Remove
      </button>
    </div>
  );
}

function SecretAddForm({ title, scope, onAdded }) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setSaving(true);
    try {
      await secretsService.create({
        key: newKey.trim(),
        value: newValue,
        scope,
      });
      setNewKey('');
      setNewValue('');
      onAdded();
    } catch (err) {
      toastError('Failed to add secret', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleAdd} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">{title}</h3>
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
  );
}

export function SecretsTab() {
  const [variables, setVariables] = useState([]);

  const load = () => {
    secretsService
      .find()
      .then((d) => setVariables(d.data))
      .catch((err) => toastError('Failed to load secrets', err));
  };

  useEffect(load, []);

  const handleDelete = async (id) => {
    try {
      await secretsService.remove(id);
      load();
    } catch (err) {
      toastError('Failed to delete secret', err);
    }
  };

  const globalSecrets = variables.filter((v) => v.user_id == null);
  const personalSecrets = variables.filter((v) => v.user_id != null);

  return (
    <div className="space-y-10">
      <p className="text-zinc-400 text-sm">
        Secrets are available in <code className="text-zinc-300">.baguette.yaml</code> config where
        they can be assigned to environment variables. Personal secrets override global secrets with
        the same key.
      </p>

      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Global secrets</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4">
          {globalSecrets.length === 0 && (
            <p className="text-zinc-600 text-sm text-center py-8">No global secrets configured</p>
          )}
          {globalSecrets.map((v) => (
            <SecretRow key={v.id} secret={v} onDelete={handleDelete} />
          ))}
        </div>
        <SecretAddForm title="Add global secret" scope="global" onAdded={load} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Personal secrets</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4">
          {personalSecrets.length === 0 && (
            <p className="text-zinc-600 text-sm text-center py-8">No personal secrets yet</p>
          )}
          {personalSecrets.map((v) => (
            <SecretRow key={v.id} secret={v} onDelete={handleDelete} />
          ))}
        </div>
        <SecretAddForm title="Add personal secret" scope="personal" onAdded={load} />
      </div>
    </div>
  );
}

export function AllRepositoriesSection() {
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
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">All repositories</h2>
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
            <button
              onClick={() => setConfirmDelete(r)}
              disabled={deletingId !== null}
              className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 shrink-0"
            >
              Delete
            </button>
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
                onClick={() => setConfirmDelete(null)}
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

export function UsersTab() {
  const [users, setUsers] = useState([]);

  const load = () => {
    usersService.find().then((d) => setUsers(d.data));
  };

  useEffect(load, []);

  const handleApprove = async (id) => {
    try {
      await usersService.approve(id);
      load();
    } catch (err) {
      toastError('Failed to approve user', err);
    }
  };

  const handleReject = async (id) => {
    try {
      await usersService.reject(id);
      load();
    } catch (err) {
      toastError('Failed to reject user', err);
    }
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

export function DockerTab() {
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

  const containerByService = {};
  for (const c of containers) {
    const name = c.Service || c.Name || c.service || c.name;
    if (name) containerByService[name] = c;
  }

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

export function PluginsTab() {
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

  const grouped = plugins.reduce((acc, p) => {
    if (!acc[p.marketplace_repo]) acc[p.marketplace_repo] = [];
    acc[p.marketplace_repo].push(p);
    return acc;
  }, {});

  return (
    <div>
      <p className="text-zinc-400 text-sm mb-4">
        Install Claude Code plugins from GitHub. Plugins are global — available to all users when
        starting new sessions. Each plugin must contain a{' '}
        <code className="text-zinc-300">.claude-plugin/plugin.json</code> file.
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

// ─── SlackTab ─────────────────────────────────────────────────────────────────

const SLACK_SCOPES = 'chat:write, channels:read, groups:read';

const inputClass =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50';

function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-zinc-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-zinc-500 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

function SlackAppCard({ app, onChanged }) {
  const [name, setName] = useState(app.name);
  const [tokenPatch, setTokenPatch] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [identity, setIdentity] = useState(null);

  useEffect(() => {
    setName(app.name);
    setTokenPatch(undefined);
    setIdentity(null);
  }, [app.id, app.name, app.bot_token]);

  const dirty = name.trim() !== app.name || tokenPatch !== undefined;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: name.trim() };
      if (tokenPatch !== undefined) payload.bot_token = tokenPatch;
      await slackService.patch(app.id, payload);
      toast.success(`Saved ${name.trim()}`);
      onChanged();
    } catch (err) {
      toastError('Failed to save Slack app', err);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await slackService.test(app.id);
      setIdentity(result);
      toast.success(`Connected to ${result.team} as @${result.user}`);
    } catch (err) {
      setIdentity(null);
      toastError('Slack connection test failed', err);
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    try {
      await slackService.remove(app.id);
      toast.success(`Removed ${app.name}`);
      onChanged();
    } catch (err) {
      toastError('Failed to remove Slack app', err);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 mb-4"
    >
      <Field label="Name" hint="How agents refer to this app in SlackPostMessage.">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Bot user OAuth token">
        <MaskedSecretInput
          maskedValue={app.bot_token}
          placeholder="xoxb-…"
          onChange={(value, dirtyToken) => setTokenPatch(dirtyToken ? value : undefined)}
        />
      </Field>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          disabled={saving || !dirty || !name.trim()}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="text-sm text-zinc-300 hover:text-white disabled:text-zinc-600 px-3 py-2"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          onClick={handleRemove}
          className="text-sm text-red-500 hover:text-red-400 px-3 py-2"
        >
          Remove
        </button>
        {identity && (
          <span className="text-sm text-emerald-400">
            Connected to {identity.team} as @{identity.user}
          </span>
        )}
      </div>
    </form>
  );
}

export function SlackTab() {
  const [apps, setApps] = useState(null);
  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    slackService
      .find()
      .then((d) => setApps(Array.isArray(d) ? d : d.data))
      .catch((err) => toastError('Failed to load Slack apps', err));
  }, []);

  useEffect(load, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newToken.trim()) return;
    setSaving(true);
    try {
      await slackService.create({ name: newName.trim(), bot_token: newToken.trim() });
      setNewName('');
      setNewToken('');
      toast.success('Slack app added');
      load();
    } catch (err) {
      toastError('Failed to add Slack app', err);
    } finally {
      setSaving(false);
    }
  };

  if (!apps) return <p className="text-zinc-600 text-sm text-center py-8">Loading…</p>;

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">Slack</h2>
      <p className="text-zinc-400 text-sm mb-4">
        Connect one or more Slack bots so agents can post updates to a channel. The{' '}
        <code className="text-zinc-300">SlackPostMessage</code> tool only appears in sessions once
        at least one app is saved. Bot token scopes:{' '}
        <code className="text-zinc-400">{SLACK_SCOPES}</code>.
      </p>

      {apps.length === 0 && (
        <p className="text-zinc-600 text-sm text-center py-8 bg-zinc-900 border border-zinc-800 rounded-xl mb-6">
          No Slack apps configured
        </p>
      )}
      {apps.map((app) => (
        <SlackAppCard key={app.id} app={app} onChanged={load} />
      ))}

      <form
        onSubmit={handleAdd}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 mb-6"
      >
        <h2 className="text-sm font-medium text-zinc-300 mb-4">Add Slack app</h2>

        <Field label="Name">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="acme"
            className={inputClass}
          />
        </Field>

        <Field
          label="Bot user OAuth token"
          hint={
            <>
              From your Slack app under{' '}
              <span className="text-zinc-400">OAuth &amp; Permissions</span> (starts with{' '}
              <code className="text-zinc-400">xoxb-</code>).
            </>
          }
        >
          <input
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="xoxb-…"
            autoComplete="off"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <button
          type="submit"
          disabled={saving || !newName.trim() || !newToken.trim()}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
        <h2 className="text-sm font-medium text-zinc-300 mb-2">Tools exposed to agents</h2>
        <p className="text-sm text-zinc-500">
          <code className="text-zinc-400">SlackPostMessage</code> — post a message to a channel.
          Requires a channel id or <code className="text-zinc-400">#name</code>
          {apps.length > 1 ? (
            <>
              {' '}
              and an <code className="text-zinc-400">app</code> name (
              {apps.map((a) => a.name).join(', ')}).
            </>
          ) : (
            '.'
          )}{' '}
          Every message carries a footer linking back to the session that posted it.
        </p>
      </div>
    </div>
  );
}
