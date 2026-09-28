import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bot,
  GitBranch,
  Bell,
  KeyRound,
  Puzzle,
  Users,
  Blocks,
  Monitor,
  ScrollText,
} from 'lucide-react';
import { toastError } from '../utils/toastError.jsx';
import { usersService, reposService, userReposService } from '../feathers.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { requestNotificationPermission } from '../utils/notifications.js';
import { useRepoContext } from '../context/RepoContext.jsx';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { repoDisplayName, isLocalRepo } from '../utils/repoDisplayName.js';
import McpAccessSection from '../components/McpAccessSection.jsx';
import RepoSearchInput from '../components/RepoSearchInput.jsx';
import {
  SecretsTab,
  PluginsTab,
  SystemTab,
  UsersTab,
  SlackTab,
} from './settings/GlobalSettingsSections.jsx';
import AgentSettingsTab from './settings/AgentSettingsTab.jsx';
import PromptsSettingsTab from './settings/PromptsSettingsTab.jsx';
import {
  SettingsSection,
  SettingsTabHeader,
  SettingsSaveRow,
} from '../components/SettingsSection.jsx';
import MaskedSecretInput from '../components/MaskedSecretInput.jsx';
import TextInput from '../components/TextInput.jsx';
import Modal, { ModalActions, ModalHeader } from '../components/Modal.jsx';
import { DANGER_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { BANNER_WARN, TEXT_MUTED, TEXT_PRIMARY, TEXT_SUCCESS } from '../utils/ui.js';

function RepositoriesTab({ settings, onSave }) {
  const { user } = useAuth();
  const { repos, refetch: refetchRepos } = useRepoContext();
  const { refetch: refetchSessions } = useSessionsContext();
  const [branchPrefix, setBranchPrefix] = useState('baguette/');
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchSaved, setBranchSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBranchPrefix(settings.branch_prefix ?? 'baguette/');
  }, [settings]);

  const handleBranchSave = async (e) => {
    e.preventDefault();
    if (!user?.id) return;
    setBranchSaving(true);
    setBranchSaved(false);
    try {
      const updated = await usersService.patch(user.id, { branch_prefix: branchPrefix });
      onSave(updated);
      setBranchSaved(true);
      setTimeout(() => setBranchSaved(false), 2000);
    } catch (err) {
      toastError('Failed to save branch settings', err);
    } finally {
      setBranchSaving(false);
    }
  };

  // GitHub repo state
  const [selectedRepo, setSelectedRepo] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState(null);
  const [unlinkingId, setUnlinkingId] = useState(null);
  const [confirmUnlink, setConfirmUnlink] = useState(null);
  const [togglingShowInAllId, setTogglingShowInAllId] = useState(null);
  const [githubToken, setGithubToken] = useState(null);
  const [githubTokenDirty, setGithubTokenDirty] = useState(false);
  const [githubTokenSaving, setGithubTokenSaving] = useState(false);
  const [githubTokenSaved, setGithubTokenSaved] = useState(false);

  // New local repo state
  const [localName, setLocalName] = useState('');
  const [addingLocal, setAddingLocal] = useState(false);
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

  const handleShowInAllSessionsChange = async (repo, checked) => {
    if (!repo.user_repo_id) return;
    setTogglingShowInAllId(repo.id);
    try {
      await userReposService.patch(repo.user_repo_id, { show_in_all_sessions: checked });
      await refetchRepos();
      refetchSessions();
    } catch (err) {
      toastError('Failed to update repository setting', err);
    } finally {
      setTogglingShowInAllId(null);
    }
  };

  const handleGithubTokenSave = async () => {
    if (!user?.id || !githubTokenDirty) return;
    setGithubTokenSaving(true);
    setGithubTokenSaved(false);
    try {
      const updated = await usersService.patch(user.id, {
        github_token: githubToken ?? '',
      });
      onSave(updated);
      setGithubToken(null);
      setGithubTokenDirty(false);
      setGithubTokenSaved(true);
      setTimeout(() => setGithubTokenSaved(false), 2000);
    } catch (err) {
      toastError('Failed to save GitHub token', err);
    } finally {
      setGithubTokenSaving(false);
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
    <div>
      <SettingsTabHeader title="Repositories">
        Repositories you can start sessions on. Link GitHub repositories or create local ones.
        Per-repo API keys are under Agent; per-repo prompts are under Prompts.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Branch"
          description="Default prefix for new session branches created from the dashboard or MCP."
        >
          <form onSubmit={handleBranchSave} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Branch prefix</label>
              <TextInput
                type="text"
                value={branchPrefix}
                onChange={(e) => setBranchPrefix(e.target.value)}
                placeholder="baguette/"
                className="font-mono"
              />
              <p className="mt-1 text-xs text-faint">
                Prefix added to all generated branch names. Leave empty for no prefix.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={branchSaving} className={PRIMARY_BUTTON_SIZED}>
                {branchSaving ? 'Saving…' : 'Save'}
              </button>
              {branchSaved ? <span className={`text-sm ${TEXT_SUCCESS}`}>Saved</span> : null}
            </div>
          </form>
        </SettingsSection>

        <SettingsSection
          title="My repositories"
          description="Repositories linked to your account. Removing one cleans up its data if no other users have it linked."
        >
          <div>
            <h4 className="text-xs font-medium text-fg-muted mb-2">Add from GitHub</h4>
            <form onSubmit={handleAdd}>
              <RepoSearchInput
                value={selectedRepo}
                onSelect={setSelectedRepo}
                addedNames={addedNames}
                trailing={
                  <button
                    type="submit"
                    disabled={adding || !selectedRepo}
                    className={`${PRIMARY_BUTTON_SIZED} py-2.5 shrink-0`}
                  >
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                }
              />
            </form>
          </div>

          <div>
            <h4 className="text-xs font-medium text-fg-muted mb-2">
              Create a local repository (no GitHub required)
            </h4>
            <form onSubmit={handleAddLocal} className="flex flex-col sm:flex-row gap-2">
              <TextInput
                type="text"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                placeholder="Repository name (e.g. my-project)"
                required
                className="flex-1"
              />
              <button
                type="submit"
                disabled={addingLocal || !localName.trim()}
                className={`${PRIMARY_BUTTON_SIZED} py-2.5 shrink-0`}
              >
                {addingLocal ? 'Creating…' : 'Create'}
              </button>
            </form>
          </div>

          {addResult && !addResult.hasBaguetteConfig && (
            <div className={`${BANNER_WARN} rounded-xl px-4 py-3`}>
              <p className="text-sm text-warning">
                <strong>{addResult.repo.full_name}</strong> doesn&apos;t have a baguette
                configuration yet. Start a session on this repo — the agent will offer to configure
                it automatically.
              </p>
              <button
                onClick={() => setAddResult(null)}
                className="mt-2 text-sm text-fg-muted hover:text-secondary"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="divide-y divide-line">
            {repos.length === 0 && (
              <p className="text-faint text-sm text-center py-8">No repositories added</p>
            )}
            {repos.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-fg font-medium">
                      {repoDisplayName(r.full_name)}
                    </code>
                    {isLocalRepo(r.full_name) && (
                      <span className="text-xs bg-control-hover text-secondary px-1.5 py-0.5 rounded font-mono">
                        local
                      </span>
                    )}
                  </div>
                  {r.full_name.startsWith('/') && (
                    <div className="text-xs text-faint mt-0.5 font-mono truncate">
                      {r.full_name}
                    </div>
                  )}
                  <div className="text-xs text-faint mt-0.5">
                    {r.session_count} session(s) · {r.exists_on_fs ? 'On disk' : 'Not on disk'}
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-strong bg-control text-accent focus:ring-brand/50"
                      checked={r.show_in_all_sessions !== false}
                      disabled={togglingShowInAllId === r.id}
                      onChange={(e) => handleShowInAllSessionsChange(r, e.target.checked)}
                    />
                    Include in "All sessions" view
                  </label>
                </div>
                <button
                  onClick={() => handleUnlinkClick(r)}
                  disabled={unlinkingId !== null}
                  className="text-xs text-danger hover:text-danger disabled:opacity-50 shrink-0 self-start"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title="GitHub token"
          description="Optional personal access token for GitHub API calls (listing repos, branches, PRs). When set, it is used instead of the token from GitHub App sign-in."
        >
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">
              Personal access token
            </label>
            <MaskedSecretInput
              maskedValue={settings?.github_token}
              placeholder="ghp_… or github_pat_…"
              onChange={(val, dirty) => {
                setGithubToken(val);
                setGithubTokenDirty(dirty);
              }}
            />
            <p className="mt-1 text-xs text-faint">
              Fine-grained or classic PAT with access to the repositories you use in Baguette. Leave
              blank and save to clear a stored token.
            </p>
          </div>
          <SettingsSaveRow
            saving={githubTokenSaving}
            saved={githubTokenSaved}
            onSave={handleGithubTokenSave}
            disabled={!githubTokenDirty}
          />
        </SettingsSection>
      </div>

      {confirmUnlink && (
        <Modal maxWidth="max-w-md" padding="p-5">
          <ModalHeader title="Remove repository?" onClose={handleUnlinkCancel} />
          <p className={`${TEXT_MUTED} text-sm mb-4`}>
            <strong className={TEXT_PRIMARY}>{confirmUnlink.full_name}</strong> will be removed from
            your account.
          </p>
          <div className={`${BANNER_WARN} rounded-lg px-3 py-2 text-sm text-warning mb-0`}>
            If you are the last user with this repository, all its sessions, worktrees, and the
            local clone will also be deleted.
          </div>
          <ModalActions className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={handleUnlinkCancel}
              className="px-4 py-2 text-sm text-secondary hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUnlinkConfirm}
              disabled={unlinkingId !== null}
              className={DANGER_BUTTON_CLASS}
            >
              {unlinkingId !== null ? 'Removing…' : 'Remove repository'}
            </button>
          </ModalActions>
        </Modal>
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
      granted: 'text-success',
      denied: 'text-danger',
      default: 'text-fg-muted',
      unsupported: 'text-faint',
    }[permission] ?? 'text-fg-muted';

  return (
    <div>
      <SettingsTabHeader title="Notifications">
        Get alerted when sessions complete or approvals are requested, even when this tab is hidden.
      </SettingsTabHeader>

      <SettingsSection title="Browser notifications">
        <div className="flex items-center justify-between gap-4">
          <p className={`text-xs ${statusColor}`}>{statusLabel}</p>
          {permission === 'denied' ? (
            <p className="text-xs text-faint text-right max-w-[160px]">
              Unblock in browser settings to enable.
            </p>
          ) : permission !== 'granted' && permission !== 'unsupported' ? (
            <button
              onClick={handleEnable}
              disabled={requesting}
              className={`${PRIMARY_BUTTON_SIZED} shrink-0`}
            >
              {requesting ? 'Requesting…' : 'Enable Notifications'}
            </button>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}

// ─── IntegrationsTab ──────────────────────────────────────────────────────────

function IntegrationsTab({ settings, onRefreshSettings }) {
  return (
    <div>
      <SettingsTabHeader title="Integrations">
        Connect external tools to Baguette: MCP clients for remote access, and Slack bots so agents
        can post updates to your channels.
      </SettingsTabHeader>

      <div className="space-y-6">
        <McpAccessSection
          configured={Boolean(settings?.mcp_token_configured)}
          maskedToken={settings?.mcp_api_token}
          endpoint={settings?.mcp_endpoint}
          onTokenChange={onRefreshSettings}
        />
        <SlackTab />
      </div>
    </div>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'repos', label: 'Repositories', icon: GitBranch },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'prompts', label: 'Prompts', icon: ScrollText },
  { id: 'integrations', label: 'Integrations', icon: Blocks },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'users', label: 'Users', icon: Users },
];

const DEFAULT_TAB = TABS[0].id;

export default function Settings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || DEFAULT_TAB;
  const requestedTab =
    rawTab === 'slack' ? 'integrations' : rawTab === 'docker' ? 'system' : rawTab;
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
      <h1 className="text-xl sm:text-2xl font-bold text-fg mb-4 sm:mb-6">Settings</h1>

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
                    ? 'bg-control-hover text-fg'
                    : 'text-faint hover:text-heading hover:bg-inset'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-accent' : 'text-faint'}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {error && (
            <div className="bg-soft-danger/30 border border-danger rounded-lg px-4 py-3 text-sm text-danger mb-6">
              {error}
            </div>
          )}

          {activeTab === 'agent' && !settings && !error && <p className="text-faint">Loading…</p>}
          {activeTab === 'agent' && settings && (
            <AgentSettingsTab settings={settings} onSave={setSettings} />
          )}
          {activeTab === 'prompts' && !settings && !error && <p className="text-faint">Loading…</p>}
          {activeTab === 'prompts' && settings && (
            <PromptsSettingsTab settings={settings} onSave={setSettings} />
          )}
          {activeTab === 'integrations' && !settings && !error && (
            <p className="text-faint">Loading…</p>
          )}
          {activeTab === 'integrations' && settings && (
            <IntegrationsTab
              settings={settings}
              onRefreshSettings={async () => {
                if (!user?.id) return;
                const d = await usersService.get(user.id);
                setSettings(d);
              }}
            />
          )}
          {activeTab === 'repos' && !settings && !error && <p className="text-faint">Loading…</p>}
          {activeTab === 'repos' && settings && (
            <RepositoriesTab settings={settings} onSave={setSettings} />
          )}
          {activeTab === 'notifications' && <NotificationsSection />}
          {activeTab === 'secrets' && <SecretsTab />}
          {activeTab === 'plugins' && <PluginsTab />}
          {activeTab === 'system' && <SystemTab />}
          {activeTab === 'users' && <UsersTab />}
        </div>
      </div>
    </div>
  );
}
