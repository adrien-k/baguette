import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, GitBranch, Bell, KeyRound, Puzzle, Box, Users, Blocks } from 'lucide-react';
import { toastError } from '../utils/toastError.jsx';
import { usersService, reposService, userReposService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { requestNotificationPermission } from '../utils/notifications.js';
import { useRepoContext } from '../context/RepoContext.jsx';
import { repoDisplayName, isLocalRepo } from '../utils/repoDisplayName.js';
import MaskedSecretInput from '../components/MaskedSecretInput.jsx';
import RepoSearchInput from '../components/RepoSearchInput.jsx';
import {
  SecretsTab,
  AllRepositoriesSection,
  PluginsTab,
  DockerTab,
  UsersTab,
  SlackTab,
} from './settings/GlobalSettingsSections.jsx';

// ─── RepositoriesTab ──────────────────────────────────────────────────────────

function RepositoriesTab() {
  const { repos, refetch: refetchRepos } = useRepoContext();

  // GitHub repo state
  const [selectedRepo, setSelectedRepo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [unlinkingId, setUnlinkingId] = useState(null);
  const [confirmUnlink, setConfirmUnlink] = useState(null);

  // New local repo state
  const [localName, setLocalName] = useState('');
  const [addingLocal, setAddingLocal] = useState(false);
  // Per-repo key state (anthropic + cursor)
  const [repoKeyEditingId, setRepoKeyEditingId] = useState(null);
  const [repoKeyField, setRepoKeyField] = useState('anthropic'); // 'anthropic' | 'cursor'
  const [repoKeyValue, setRepoKeyValue] = useState(null);
  const [repoKeyDirty, setRepoKeyDirty] = useState(false);
  const [repoKeySaving, setRepoKeySaving] = useState(false);
  // Local overrides per repo after save, until refetch
  const [repoKeyOverrides, setRepoKeyOverrides] = useState({});
  const [repoCursorKeyOverrides, setRepoCursorKeyOverrides] = useState({});

  const openRepoKeyEdit = (repoId, field) => {
    if (repoKeyEditingId === repoId && repoKeyField === field) {
      setRepoKeyEditingId(null);
    } else {
      setRepoKeyEditingId(repoId);
      setRepoKeyField(field);
      setRepoKeyValue(null);
      setRepoKeyDirty(false);
    }
  };

  const handleRepoKeySave = async (repoId, userRepoId) => {
    setRepoKeySaving(true);
    try {
      if (repoKeyField === 'anthropic') {
        const result = await userReposService.patch(userRepoId, {
          anthropic_api_key: repoKeyValue ?? '',
        });
        setRepoKeyOverrides((prev) => ({ ...prev, [repoId]: result.anthropic_api_key }));
      } else {
        const result = await userReposService.patch(userRepoId, {
          cursor_api_key: repoKeyValue ?? '',
        });
        setRepoCursorKeyOverrides((prev) => ({ ...prev, [repoId]: result.cursor_api_key }));
      }
      setRepoKeyEditingId(null);
      setRepoKeyValue(null);
      setRepoKeyDirty(false);
    } catch (err) {
      toastError(
        `Failed to save ${repoKeyField === 'anthropic' ? 'Anthropic' : 'Cursor'} Key`,
        err
      );
    } finally {
      setRepoKeySaving(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!selectedRepo) return;
    setAdding(true);
    setAddResult(null);
    try {
      const result = await reposService.create({ fullName: selectedRepo });
      setSelectedRepo('');
      setAddResult(result);
      await refetchRepos();
    } catch (err) {
      toastError('Failed to add repository', err);
    } finally {
      setAdding(false);
    }
  };

  const handleAddLocal = async (e) => {
    e.preventDefault();
    if (!localName.trim()) return;
    setAddingLocal(true);
    try {
      const result = await reposService.createLocal({ name: localName.trim() });
      setLocalName('');
      setAddResult(result);
      await refetchRepos();
    } catch (err) {
      toastError('Failed to create repository', err);
    } finally {
      setAddingLocal(false);
    }
  };

  const handleUnlinkClick = (repo) => setConfirmUnlink(repo);
  const handleUnlinkCancel = () => setConfirmUnlink(null);

  const handleUnlinkConfirm = async () => {
    if (!confirmUnlink) return;
    setUnlinkingId(confirmUnlink.id);
    try {
      await reposService.unlink(confirmUnlink.id);
      setConfirmUnlink(null);
      await refetchRepos();
    } catch (err) {
      toastError('Failed to remove repository', err);
    } finally {
      setUnlinkingId(null);
    }
  };

  const addedNames = new Set(repos.map((r) => r.full_name));

  return (
    <div className="space-y-12">
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">My repositories</h2>

        <form
          onSubmit={handleAdd}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 mb-4"
        >
          <p className="text-zinc-400 text-sm mb-3">
            Add repositories to use them as session targets. Removing one will clean up its data if
            no other users have it linked.
          </p>
          <RepoSearchInput
            value={selectedRepo}
            onSelect={setSelectedRepo}
            addedNames={addedNames}
            trailing={
              <button
                type="submit"
                disabled={adding || !selectedRepo}
                className="inline-flex items-center justify-center bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0"
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
            }
          />
        </form>

        <form
          onSubmit={handleAddLocal}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 mb-4"
        >
          <p className="text-zinc-400 text-sm mb-3">
            Create a new local repository — no GitHub required.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              placeholder="Repository name (e.g. my-project)"
              required
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
            <button
              type="submit"
              disabled={addingLocal || !localName.trim()}
              className="inline-flex items-center justify-center bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              {addingLocal ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>

        {addResult && !addResult.hasBaguetteConfig && (
          <div className="bg-amber-900/20 border border-amber-700 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm text-amber-200">
              <strong>{addResult.repo.full_name}</strong> doesn&apos;t have a baguette configuration
              yet. Start a session on this repo — the agent will offer to configure it
              automatically.
            </p>
            <button
              onClick={() => setAddResult(null)}
              className="mt-2 text-sm text-zinc-400 hover:text-zinc-300"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {repos.length === 0 && (
            <p className="text-zinc-600 text-sm text-center py-8">No repositories added</p>
          )}
          {repos.map((r) => {
            const maskedAnthropicKey =
              repoKeyOverrides[r.id] !== undefined ? repoKeyOverrides[r.id] : r.anthropic_api_key;
            const maskedCursorKey =
              repoCursorKeyOverrides[r.id] !== undefined
                ? repoCursorKeyOverrides[r.id]
                : r.cursor_api_key;
            const isEditing = repoKeyEditingId === r.id;
            const editingAnthropicKey = isEditing && repoKeyField === 'anthropic';
            const _editingCursorKey = isEditing && repoKeyField === 'cursor';
            const activeKeyMasked = editingAnthropicKey ? maskedAnthropicKey : maskedCursorKey;
            return (
              <div key={r.id} className="border-b border-zinc-800 last:border-0">
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-white font-medium">
                        {repoDisplayName(r.full_name)}
                      </code>
                      {isLocalRepo(r.full_name) && (
                        <span className="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded font-mono">
                          local
                        </span>
                      )}
                    </div>
                    {r.full_name.startsWith('/') && (
                      <div className="text-xs text-zinc-600 mt-0.5 font-mono truncate">
                        {r.full_name}
                      </div>
                    )}
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {r.session_count} session(s) · {r.exists_on_fs ? 'On disk' : 'Not on disk'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openRepoKeyEdit(r.id, 'anthropic')}
                      className={`text-xs ${maskedAnthropicKey ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-zinc-300'}`}
                    >
                      {maskedAnthropicKey ? 'Claude Key ✓' : 'Claude Key'}
                    </button>
                    <button
                      onClick={() => openRepoKeyEdit(r.id, 'cursor')}
                      className={`text-xs ${maskedCursorKey ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-zinc-300'}`}
                    >
                      {maskedCursorKey ? 'Cursor Key ✓' : 'Cursor Key'}
                    </button>
                    <button
                      onClick={() => handleUnlinkClick(r)}
                      disabled={unlinkingId !== null}
                      className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div className="px-4 pb-3 space-y-2">
                    <p className="text-xs text-zinc-400">
                      {editingAnthropicKey
                        ? 'Claude credential for this repo (overrides your account). Console API key or claude setup-token output.'
                        : 'Cursor API key for this repo (overrides your account key)'}
                    </p>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <MaskedSecretInput
                          key={`${r.id}-${repoKeyField}`}
                          maskedValue={activeKeyMasked}
                          placeholder={editingAnthropicKey ? 'sk-ant-…' : 'cursor-…'}
                          onChange={(val, dirty) => {
                            setRepoKeyValue(val);
                            setRepoKeyDirty(dirty);
                          }}
                        />
                      </div>
                      <button
                        onClick={() => handleRepoKeySave(r.id, r.user_repo_id)}
                        disabled={repoKeySaving || !repoKeyDirty}
                        className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0"
                      >
                        {repoKeySaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setRepoKeyEditingId(null);
                          setRepoKeyValue(null);
                          setRepoKeyDirty(false);
                        }}
                        className="text-xs text-zinc-400 hover:text-zinc-300 shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                    {activeKeyMasked && (
                      <button
                        onClick={() => {
                          setRepoKeyValue('');
                          setRepoKeyDirty(true);
                        }}
                        className="text-xs text-zinc-500 hover:text-zinc-400"
                      >
                        Clear key (use account default)
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <AllRepositoriesSection />

      {confirmUnlink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl max-w-md w-full p-5">
            <h3 className="text-lg font-semibold text-white mb-2">Remove repository?</h3>
            <p className="text-zinc-400 text-sm mb-4">
              <strong className="text-white">{confirmUnlink.full_name}</strong> will be removed from
              your account.
            </p>
            <div className="bg-amber-900/30 border border-amber-700 rounded-lg px-3 py-2 text-sm text-amber-200 mb-4">
              If you are the last user with this repository, all its sessions, worktrees, and the
              local clone will also be deleted.
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleUnlinkCancel}
                className="px-4 py-2 text-sm text-zinc-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlinkConfirm}
                disabled={unlinkingId !== null}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {unlinkingId !== null ? 'Removing…' : 'Remove repository'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NotificationsSection ─────────────────────────────────────────────────────

function NotificationsSection() {
  const [permission, setPermission] = useState(() => {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });
  const [requesting, setRequesting] = useState(false);

  const handleEnable = async () => {
    setRequesting(true);
    const result = await requestNotificationPermission();
    setPermission(result);
    setRequesting(false);
  };

  const statusLabel =
    {
      granted: 'Enabled',
      denied: 'Blocked',
      default: 'Not enabled',
      unsupported: 'Not supported by this browser',
    }[permission] ?? permission;

  const statusColor =
    {
      granted: 'text-emerald-400',
      denied: 'text-red-400',
      default: 'text-zinc-400',
      unsupported: 'text-zinc-500',
    }[permission] ?? 'text-zinc-400';

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-300 mb-3">Notifications</h2>
      <p className="text-zinc-400 text-sm mb-4">
        Enable browser notifications to receive alerts when sessions complete or approvals are
        requested, even when the tab is hidden.
      </p>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-300 mb-0.5">Browser notifications</p>
            <p className={`text-xs ${statusColor}`}>{statusLabel}</p>
          </div>
          {permission === 'denied' ? (
            <p className="text-xs text-zinc-500 text-right max-w-[160px]">
              Unblock in browser settings to enable.
            </p>
          ) : permission !== 'granted' && permission !== 'unsupported' ? (
            <button
              onClick={handleEnable}
              disabled={requesting}
              className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              {requesting ? 'Requesting…' : 'Enable Notifications'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── AgentTab ─────────────────────────────────────────────────────────────────

function AgentTab({ settings, onSave }) {
  const { user } = useAuth();
  const [anthropicApiKey, setAnthropicApiKey] = useState(null);
  const [anthropicApiKeyDirty, setAnthropicApiKeyDirty] = useState(false);
  const [cursorApiKey, setCursorApiKey] = useState(null);
  const [cursorApiKeyDirty, setCursorApiKeyDirty] = useState(false);
  const [branchPrefix, setBranchPrefix] = useState('baguette/');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBranchPrefix(settings.branch_prefix ?? 'baguette/');
    setAnthropicApiKey(null);
    setAnthropicApiKeyDirty(false);
    setCursorApiKey(null);
    setCursorApiKeyDirty(false);
  }, [settings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const patch = { branch_prefix: branchPrefix };
      if (anthropicApiKeyDirty) patch.anthropic_api_key = anthropicApiKey ?? '';
      if (cursorApiKeyDirty) patch.cursor_api_key = cursorApiKey ?? '';
      const updated = await usersService.patch(user.id, patch);
      onSave(updated);
      setAnthropicApiKey(null);
      setAnthropicApiKeyDirty(false);
      setCursorApiKey(null);
      setCursorApiKeyDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toastError('Failed to save agent settings', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {/* General */}
      <div className="space-y-4 max-w-xl">
        <h2 className="text-sm font-semibold text-zinc-300">General</h2>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Branch prefix</label>
          <input
            type="text"
            value={branchPrefix}
            onChange={(e) => setBranchPrefix(e.target.value)}
            placeholder="baguette/"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Prefix added to all generated branch names. Leave empty for no prefix.
          </p>
        </div>
      </div>

      {/* Claude */}
      <div className="space-y-4 max-w-xl">
        <h2 className="text-sm font-semibold text-zinc-300">Claude</h2>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Credential</label>
          <MaskedSecretInput
            maskedValue={settings?.anthropic_api_key}
            placeholder="sk-ant-…"
            onChange={(val, dirty) => {
              setAnthropicApiKey(val);
              setAnthropicApiKeyDirty(dirty);
            }}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Console API key (<code className="text-zinc-400">sk-ant-api…</code>, billed per token)
            or a subscription token from <code className="text-zinc-400">claude setup-token</code> (
            <code className="text-zinc-400">sk-ant-oat…</code>, Pro/Max/Team/Enterprise, lasts about
            a year). Saving replaces the previous value; format is detected automatically. Leave
            empty to use Claude Code&apos;s default configuration.
          </p>
        </div>
      </div>

      {/* Cursor */}
      <div className="space-y-4 max-w-xl">
        <h2 className="text-sm font-semibold text-zinc-300">Cursor</h2>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">API Key</label>
          <MaskedSecretInput
            maskedValue={settings?.cursor_api_key}
            placeholder="cursor-…"
            onChange={(val, dirty) => {
              setCursorApiKey(val);
              setCursorApiKeyDirty(dirty);
            }}
          />
          <p className="mt-1 text-xs text-zinc-500">Required to use the Cursor agent SDK.</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-zinc-950 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'repos', label: 'Repositories', icon: GitBranch },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'integrations', label: 'Integrations', icon: Blocks },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'docker', label: 'Docker', icon: Box },
  { id: 'users', label: 'Users', icon: Users },
];

const DEFAULT_TAB = TABS[0].id;

export default function Settings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || DEFAULT_TAB;
  const requestedTab = rawTab === 'slack' ? 'integrations' : rawTab;
  const activeTab = TABS.some((t) => t.id === requestedTab) ? requestedTab : DEFAULT_TAB;
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);

  const setTab = (tab) => setSearchParams({ tab });

  useEffect(() => {
    if (!user?.id) return;
    usersService
      .get(user.id)
      .then((d) => setSettings(d))
      .catch((err) => setError(err.message));
  }, [user?.id]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-6">Settings</h1>

      <div className="flex flex-col sm:flex-row sm:items-start gap-6">
        <nav className="sm:w-52 shrink-0 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${active ? 'text-amber-400' : 'text-zinc-500'}`}
                />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300 mb-6">
              {error}
            </div>
          )}

          {activeTab === 'agent' && !settings && !error && (
            <p className="text-zinc-500">Loading…</p>
          )}
          {activeTab === 'agent' && settings && (
            <AgentTab settings={settings} onSave={setSettings} />
          )}
          {activeTab === 'repos' && <RepositoriesTab />}
          {activeTab === 'notifications' && <NotificationsSection />}
          {activeTab === 'secrets' && <SecretsTab />}
          {activeTab === 'integrations' && <SlackTab />}
          {activeTab === 'plugins' && <PluginsTab />}
          {activeTab === 'docker' && <DockerTab />}
          {activeTab === 'users' && <UsersTab />}
        </div>
      </div>
    </div>
  );
}
