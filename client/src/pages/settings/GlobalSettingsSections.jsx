import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { toastError } from '../../utils/toastError.jsx';
import {
  secretsService,
  usersService,
  reposService,
  pluginsService,
  slackService,
} from '../../feathers.js';
import MaskedSecretInput from '../../components/MaskedSecretInput.jsx';
import SystemWideBadge from '../../components/SystemWideBadge.jsx';
import { SettingsSection, SettingsTabHeader } from '../../components/SettingsSection.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import Modal, { ModalActions, ModalHeader } from '../../components/Modal.jsx';
import { DANGER_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../../utils/buttonStyles.js';
import { BANNER_WARN, INPUT_CLASS, TEXT_MUTED, TEXT_PRIMARY } from '../../utils/ui.js';

function SecretRow({ secret, onDelete }) {
  return (
    <div className="flex items-center justify-between py-3 gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <code className="text-sm text-accent font-medium shrink-0">{secret.key}</code>
        <code className="text-sm text-fg-muted truncate hidden sm:block">{secret.safeValue}</code>
      </div>
      <button
        onClick={() => onDelete(secret.id)}
        className="text-xs text-danger hover:text-danger shrink-0"
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
    <form onSubmit={handleAdd}>
      <h4 className="text-xs font-medium text-fg-muted mb-2">{title}</h4>
      <div className="flex flex-col sm:flex-row gap-3">
        <TextInput
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="KEY"
          className="sm:w-40 font-mono"
        />
        <TextInput
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          className="flex-1 font-mono"
        />
        <button
          type="submit"
          disabled={saving || !newKey.trim()}
          className={`${PRIMARY_BUTTON_SIZED} shrink-0`}
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
    <div>
      <SettingsTabHeader title="Secrets">
        Secrets are available in <code className="text-secondary">.baguette.yaml</code> config where
        they can be assigned to environment variables. Personal secrets override system-wide secrets
        with the same key.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="System-wide secrets"
          description="Shared across all users and sessions on this Baguette instance."
        >
          <div className="divide-y divide-line">
            {globalSecrets.length === 0 && (
              <p className="text-faint text-sm text-center py-8">
                No system-wide secrets configured
              </p>
            )}
            {globalSecrets.map((v) => (
              <SecretRow key={v.id} secret={v} onDelete={handleDelete} />
            ))}
          </div>
          <SecretAddForm title="Add system-wide secret" scope="global" onAdded={load} />
        </SettingsSection>

        <SettingsSection
          title="Personal secrets"
          description="Only for your account. Same key as a system-wide secret wins for your sessions."
        >
          <div className="divide-y divide-line">
            {personalSecrets.length === 0 && (
              <p className="text-faint text-sm text-center py-8">No personal secrets yet</p>
            )}
            {personalSecrets.map((v) => (
              <SecretRow key={v.id} secret={v} onDelete={handleDelete} />
            ))}
          </div>
          <SecretAddForm title="Add personal secret" scope="personal" onAdded={load} />
        </SettingsSection>
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
    <SettingsSection
      title="All repositories"
      headerAside={<SystemWideBadge />}
      description="Repositories registered system-wide. Deleting one removes all sessions, worktrees, and the clone for all users."
    >
      <div className="divide-y divide-line">
        {repos.length === 0 && (
          <p className="text-faint text-sm text-center py-8">No repositories registered</p>
        )}
        {repos.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <code className="text-sm text-fg font-medium">{r.full_name}</code>
              <div className="text-xs text-faint mt-0.5">
                {r.session_count} session(s) · {r.exists_on_fs ? 'On disk' : 'Not on disk'}
              </div>
            </div>
            <button
              onClick={() => setConfirmDelete(r)}
              disabled={deletingId !== null}
              className="text-xs text-danger hover:text-danger disabled:opacity-50 shrink-0"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <Modal maxWidth="max-w-md" padding="p-5">
          <ModalHeader title="Delete repository?" onClose={() => setConfirmDelete(null)} />
          <p className={`${TEXT_MUTED} text-sm mb-4`}>
            <strong className={TEXT_PRIMARY}>{confirmDelete.full_name}</strong> and all its data
            will be permanently removed for all users.
          </p>
          <div className={`${BANNER_WARN} rounded-lg px-3 py-2 text-sm text-warning`}>
            This will delete all sessions linked to this repo, their worktrees, and the main clone.
            This cannot be undone.
          </div>
          <ModalActions className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="px-4 py-2 text-sm text-secondary hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteConfirm}
              disabled={deletingId !== null}
              className={DANGER_BUTTON_CLASS}
            >
              {deletingId !== null ? 'Deleting…' : 'Delete repository'}
            </button>
          </ModalActions>
        </Modal>
      )}
    </SettingsSection>
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
    <div>
      <SettingsTabHeader title="Users">
        People who can sign in to this Baguette instance. New users must be approved before they can
        start sessions.
      </SettingsTabHeader>

      <SettingsSection title="Accounts">
        <div className="divide-y divide-line">
          {users.length === 0 && (
            <p className="text-faint text-sm text-center py-8">No users found</p>
          )}
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between py-3 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-fg font-medium truncate">{u.username}</div>
                  <div className="text-xs text-faint">
                    Joined {new Date(u.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {u.approved ? (
                  <>
                    <span className="text-xs text-success hidden sm:inline">Approved</span>
                    <span className="w-2 h-2 rounded-full bg-ok sm:hidden" />
                    <button
                      onClick={() => handleReject(u.id)}
                      className="text-xs text-danger hover:text-danger ml-1"
                    >
                      Revoke
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-accent hidden sm:inline">Pending</span>
                    <span className="w-2 h-2 rounded-full bg-brand sm:hidden" />
                    <button
                      onClick={() => handleApprove(u.id)}
                      className="text-xs bg-ok hover:bg-ok-hover text-on-solid px-3 py-1 rounded ml-1"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(u.id)}
                      className="text-xs text-danger hover:text-danger"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
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
      <SettingsTabHeader title="Plugins">
        Install Claude Code plugins from GitHub. Plugins are system-wide — available to all users
        when starting new sessions. Each plugin must contain a{' '}
        <code className="text-secondary">.claude-plugin/plugin.json</code> file.
      </SettingsTabHeader>

      <div className="space-y-6">
        <SettingsSection
          title="Install plugin"
          description={
            <>
              Enter a GitHub URL: repo root (e.g. <code className="text-fg-muted">…/tree/main</code>
              ) or a subdirectory (e.g.{' '}
              <code className="text-fg-muted">…/tree/main/plugins/foo</code>).
            </>
          }
        >
          <form onSubmit={handleInstall} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://github.com/owner/repo/tree/main"
              className={`${INPUT_CLASS} flex-1 font-mono min-w-0`}
            />
            <button
              type="submit"
              disabled={installing || !input.trim()}
              className={`${PRIMARY_BUTTON_SIZED} shrink-0`}
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
          </form>
        </SettingsSection>

        <SettingsSection title="Installed plugins">
          {plugins.length === 0 ? (
            <p className="text-faint text-sm text-center py-8">No plugins installed</p>
          ) : (
            Object.entries(grouped).map(([marketplaceRepo, repoPlugins]) => (
              <div key={marketplaceRepo}>
                <h4 className="text-xs font-medium text-faint uppercase tracking-wide mb-2">
                  {marketplaceRepo}
                </h4>
                <div className="divide-y divide-line">
                  {repoPlugins.map((plugin) => (
                    <div key={plugin.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-fg font-medium">{plugin.name}</div>
                        <div className="text-xs text-faint mt-0.5 flex items-center gap-2">
                          <code className="text-faint truncate">{plugin.plugin_path}</code>
                          {plugin.git_sha && (
                            <span className="text-faint font-mono shrink-0">
                              {plugin.git_sha.slice(0, 7)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleRefresh(plugin)}
                          disabled={refreshingId !== null}
                          className="text-xs text-fg-muted hover:text-fg disabled:opacity-50 transition-colors"
                        >
                          {refreshingId === plugin.id ? '…' : 'Refresh'}
                        </button>
                        <button
                          onClick={() => handleRemove(plugin)}
                          className="text-xs text-danger hover:text-danger"
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
        </SettingsSection>
      </div>
    </div>
  );
}

// ─── SlackTab ─────────────────────────────────────────────────────────────────

const SLACK_SCOPES =
  'app_mentions:read, users:read, files:read, chat:write, assistant:write, channels:read, groups:read, channels:history, groups:history';
const SLACK_EVENTS = 'app_mention, message.channels, message.groups, agent_session_stopped';
const DEFAULT_SLACK_APP_NAME = 'baguette';
// The API never returns stored secrets; a set one is shown as dots.
const SECRET_PLACEHOLDER = '••••••••••';

const inputClass = INPUT_CLASS;

function SlackAppCard({ app, onChanged }) {
  const [name, setName] = useState(app.name);
  const [tokenPatch, setTokenPatch] = useState(undefined);
  const [appTokenPatch, setAppTokenPatch] = useState(undefined);
  const [clientId, setClientId] = useState(app.client_id ?? '');
  const [clientSecretPatch, setClientSecretPatch] = useState(undefined);
  const [signingSecretPatch, setSigningSecretPatch] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [identity, setIdentity] = useState(null);

  useEffect(() => {
    setName(app.name);
    setTokenPatch(undefined);
    setAppTokenPatch(undefined);
    setClientId(app.client_id ?? '');
    setClientSecretPatch(undefined);
    setSigningSecretPatch(undefined);
    setIdentity(null);
  }, [
    app.id,
    app.name,
    app.has_bot_token,
    app.has_app_token,
    app.client_id,
    app.has_client_secret,
    app.has_signing_secret,
  ]);

  const dirty =
    name.trim() !== app.name ||
    tokenPatch !== undefined ||
    appTokenPatch !== undefined ||
    clientId.trim() !== (app.client_id ?? '') ||
    clientSecretPatch !== undefined ||
    signingSecretPatch !== undefined;
  const canInstall =
    Boolean(app.client_id && app.has_client_secret && app.has_signing_secret) && !dirty;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: name.trim() };
      if (tokenPatch !== undefined) payload.bot_token = tokenPatch;
      if (appTokenPatch !== undefined) payload.app_token = appTokenPatch;
      if (clientId.trim() !== (app.client_id ?? '')) payload.client_id = clientId.trim();
      if (clientSecretPatch !== undefined) payload.client_secret = clientSecretPatch;
      if (signingSecretPatch !== undefined) payload.signing_secret = signingSecretPatch;
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
    <form onSubmit={handleSave}>
      <Field label="Name" hint="How agents refer to this app in SlackPostMessage.">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        label="App-level token (Socket Mode)"
        hint="Starts with xapp-. With it, Baguette connects to Slack itself: no public URL, Request URL or Signing secret needed."
      >
        <MaskedSecretInput
          maskedValue={app.has_app_token ? SECRET_PLACEHOLDER : ''}
          placeholder="xapp-…"
          onChange={(value, dirtyToken) => setAppTokenPatch(dirtyToken ? value : undefined)}
        />
      </Field>

      <Field
        label="Bot user OAuth token"
        hint="Slack app → OAuth & Permissions → Bot User OAuth Token (starts with xoxb-)."
      >
        <MaskedSecretInput
          maskedValue={app.has_bot_token ? SECRET_PLACEHOLDER : ''}
          placeholder="xoxb-…"
          onChange={(value, dirtyToken) => setTokenPatch(dirtyToken ? value : undefined)}
        />
      </Field>

      <details className="mb-4" open={Boolean(app.client_id || app.installed)}>
        <summary className="text-xs font-medium text-fg-muted cursor-pointer mb-2">
          Advanced: public URL setup (Events API + Add to Slack)
        </summary>
        <Field
          label="Client ID"
          hint={
            <>
              From <span className="text-fg-muted">Basic Information → App Credentials</span>.
              Needed for the Add to Slack install.
            </>
          }
        >
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="Client secret">
          <MaskedSecretInput
            maskedValue={app.has_client_secret ? SECRET_PLACEHOLDER : ''}
            placeholder="Client secret"
            onChange={(value, dirtySecret) => setClientSecretPatch(dirtySecret ? value : undefined)}
          />
        </Field>

        <Field
          label="Signing secret"
          hint="Used to verify that incoming events really come from Slack."
        >
          <MaskedSecretInput
            maskedValue={app.has_signing_secret ? SECRET_PLACEHOLDER : ''}
            placeholder="Signing secret"
            onChange={(value, dirtySecret) =>
              setSigningSecretPatch(dirtySecret ? value : undefined)
            }
          />
        </Field>

        <div className="mb-4 text-sm text-faint space-y-1">
          <p>
            In Slack, set <span className="text-fg-muted">Event Subscriptions → Request URL</span>{' '}
            to <code className="text-fg-muted break-all">{app.events_url}</code>, subscribe to{' '}
            <code className="text-fg-muted">{SLACK_EVENTS}</code>, and add the redirect URL{' '}
            <code className="text-fg-muted break-all">{app.redirect_uri}</code> under OAuth &amp;
            Permissions.
          </p>
          {app.installed && (
            <p className="text-success">
              Installed in {app.team_name || app.team_id}. Invite the bot to a channel with{' '}
              <code>/invite @bot</code>, then tag it.
            </p>
          )}
        </div>
      </details>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          disabled={saving || !dirty || !name.trim()}
          className={PRIMARY_BUTTON_SIZED}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <a
          href={canInstall ? `/api/slack/install?app_id=${app.id}` : undefined}
          aria-disabled={!canInstall}
          className={`${PRIMARY_BUTTON_SIZED} inline-block ${canInstall ? '' : 'opacity-50 pointer-events-none'}`}
        >
          {app.installed ? 'Reinstall to Slack' : 'Add to Slack'}
        </a>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="text-sm text-secondary hover:text-fg disabled:text-faint px-3 py-2"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          onClick={handleRemove}
          className="text-sm text-danger hover:text-danger px-3 py-2"
        >
          Remove
        </button>
        {identity && (
          <span className="text-sm text-success">
            Connected to {identity.team} as @{identity.user}
          </span>
        )}
      </div>
    </form>
  );
}

export function SlackTab() {
  const [apps, setApps] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState(DEFAULT_SLACK_APP_NAME);
  const [newToken, setNewToken] = useState('');
  const [newAppToken, setNewAppToken] = useState('');
  const [newClientId, setNewClientId] = useState('');
  const [newClientSecret, setNewClientSecret] = useState('');
  const [newSigningSecret, setNewSigningSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    slackService
      .find()
      .then((d) => setApps(Array.isArray(d) ? d : d.data))
      .catch((err) => toastError('Failed to load Slack apps', err));
  }, []);

  useEffect(load, [load]);

  const closeAddForm = () => {
    setShowAddForm(false);
    setNewName(DEFAULT_SLACK_APP_NAME);
    setNewToken('');
    setNewAppToken('');
    setNewClientId('');
    setNewClientSecret('');
    setNewSigningSecret('');
  };

  const hasOAuthCredentials = Boolean(
    newClientId.trim() && newClientSecret.trim() && newSigningSecret.trim()
  );
  const canAdd = Boolean(newName.trim() && (newToken.trim() || hasOAuthCredentials));

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!canAdd) return;
    setSaving(true);
    try {
      const payload = { name: newName.trim() };
      if (newToken.trim()) payload.bot_token = newToken.trim();
      if (newAppToken.trim()) payload.app_token = newAppToken.trim();
      if (hasOAuthCredentials) {
        payload.client_id = newClientId.trim();
        payload.client_secret = newClientSecret.trim();
        payload.signing_secret = newSigningSecret.trim();
      }
      await slackService.create(payload);
      closeAddForm();
      toast.success('Slack app added');
      load();
    } catch (err) {
      toastError('Failed to add Slack app', err);
    } finally {
      setSaving(false);
    }
  };

  if (!apps) return <p className="text-faint text-sm text-center py-8">Loading…</p>;

  return (
    <SettingsSection
      title="Slack"
      headerAside={<SystemWideBadge />}
      description={
        <>
          Install a Slack app so people can tag it in a channel to start sessions (each person links
          their own Baguette account the first time), and so agents can post updates. The{' '}
          <code className="text-secondary">SlackPostMessage</code> tool only appears in sessions
          once an app has a bot token. Bot scopes:{' '}
          <code className="text-fg-muted">{SLACK_SCOPES}</code>.
        </>
      }
    >
      {apps.length === 0 && (
        <p className="text-faint text-sm text-center py-8">No Slack apps configured</p>
      )}
      {apps.map((app) => (
        <SlackAppCard key={app.id} app={app} onChanged={load} />
      ))}

      {showAddForm ? (
        <form onSubmit={handleAdd}>
          <h4 className="text-xs font-medium text-fg-muted mb-2">Add Slack app</h4>

          <Field label="Name">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="baguette"
              className={inputClass}
            />
          </Field>

          <Field
            label="App-level token (Socket Mode)"
            hint={
              <>
                Slack app →{' '}
                <span className="text-fg-muted">Basic Information → App-Level Tokens</span> with the
                connections:write scope (starts with xapp-). Needs Socket Mode enabled.
              </>
            }
          >
            <input
              type="password"
              value={newAppToken}
              onChange={(e) => setNewAppToken(e.target.value)}
              placeholder="xapp-…"
              autoComplete="off"
              className={`${inputClass} font-mono`}
            />
          </Field>

          <Field
            label="Bot user OAuth token"
            hint={
              <>
                Slack app →{' '}
                <span className="text-fg-muted">
                  OAuth &amp; Permissions → Bot User OAuth Token
                </span>{' '}
                (starts with xoxb-).
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

          <details className="mb-4">
            <summary className="text-xs font-medium text-fg-muted cursor-pointer mb-2">
              Advanced: public URL setup (Events API + Add to Slack)
            </summary>
            <Field
              label="Client ID"
              hint={
                <>
                  From your Slack app under{' '}
                  <span className="text-fg-muted">Basic Information → App Credentials</span>.
                </>
              }
            >
              <input
                type="text"
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
                autoComplete="off"
                className={`${inputClass} font-mono`}
              />
            </Field>

            <Field label="Client secret">
              <input
                type="password"
                value={newClientSecret}
                onChange={(e) => setNewClientSecret(e.target.value)}
                autoComplete="off"
                className={`${inputClass} font-mono`}
              />
            </Field>

            <Field label="Signing secret">
              <input
                type="password"
                value={newSigningSecret}
                onChange={(e) => setNewSigningSecret(e.target.value)}
                autoComplete="off"
                className={`${inputClass} font-mono`}
              />
            </Field>
          </details>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="submit"
              disabled={saving || !canAdd}
              className={`${PRIMARY_BUTTON_SIZED} disabled:bg-disabled disabled:text-faint`}
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              onClick={closeAddForm}
              disabled={saving}
              className="text-sm text-secondary hover:text-fg disabled:text-faint px-3 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setShowAddForm(true)} className={PRIMARY_BUTTON_SIZED}>
          Add Slack app
        </button>
      )}

      <div>
        <h4 className="text-xs font-medium text-fg-muted mb-2">Tools exposed to agents</h4>
        <p className="text-sm text-faint">
          <code className="text-fg-muted">SlackPostMessage</code> — post a message to a channel.
          Requires a channel id or <code className="text-fg-muted">#name</code>
          {apps.length > 1 ? (
            <>
              {' '}
              and an <code className="text-fg-muted">app</code> name (
              {apps.map((a) => a.name).join(', ')}).
            </>
          ) : (
            '.'
          )}{' '}
          Every message carries a footer linking back to the session that posted it.
        </p>
      </div>
    </SettingsSection>
  );
}
