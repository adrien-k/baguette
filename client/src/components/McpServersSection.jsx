import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, MinusCircle, PlugZap, XCircle } from 'lucide-react';
import { mcpServersService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { SettingsSection } from './SettingsSection.jsx';
import MaskedSecretInput from './MaskedSecretInput.jsx';
import TextInput from './TextInput.jsx';
import Modal, { ModalActions, ModalHeader } from './Modal.jsx';
import { GHOST_BUTTON_CLASS, PRIMARY_BUTTON_SIZED } from '../utils/buttonStyles.js';
import { INPUT_CLASS } from '../utils/ui.js';

function rowsFromHeaders(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return [{ name: '', value: '' }];
  return entries.map(([name]) => ({ name, value: '' }));
}

function headersFromRows(rows) {
  const out = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    out[name] = row.value;
  }
  return out;
}

function CheckLine({ check }) {
  let Icon = MinusCircle;
  let color = 'text-faint';
  if (check.ok === true) {
    Icon = CheckCircle2;
    color = 'text-success';
  } else if (check.ok === false) {
    Icon = XCircle;
    color = 'text-danger';
  }
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${color}`} />
      <span className={check.ok === false ? 'text-danger' : 'text-secondary'}>
        {check.label}
        {check.detail ? ` — ${check.detail}` : ''}
      </span>
    </div>
  );
}

/** Auth-method for legacy rows without a persisted picker choice. */
function deriveAuthMethod(server) {
  if (server?.oauth_client_id) return 'oauth';
  if (server?.bearer_token_configured) return 'bearer';
  return 'none';
}

function AuthMethodOption({ value, label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-strong/60 bg-control/30 px-3 py-2">
      <input
        type="radio"
        name="mcp-auth-method"
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 rounded-full border-strong text-accent focus:ring-brand/50"
      />
      <span className="text-sm text-secondary leading-tight">
        <span className="font-medium text-heading">{label}</span>
        {hint ? <span className="block text-xs font-normal text-faint mt-0.5">{hint}</span> : null}
      </span>
    </label>
  );
}

function OAuthAvailability({ status }) {
  if (!status) return null;
  if (status.state === 'checking') {
    return <p className="text-xs text-faint">Checking the OAuth server…</p>;
  }
  if (status.state === 'failed') {
    return (
      <p className="text-xs text-warning" title={status.message}>
        OAuth check failed — the server or its authorization server was unreachable.
      </p>
    );
  }
  if (status.dcr_available) {
    return <p className="text-xs text-success">Dynamic client registration available.</p>;
  }
  return (
    <p className="text-xs text-warning">
      No dynamic client registration — pre-register a client id below (plus its secret when one is
      issued).
    </p>
  );
}

function TestResult({ result }) {
  if (!result?.checks?.length) return null;
  const border = result.ok ? 'border-success/40' : 'border-danger/40';
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 space-y-1.5 ${border}`}>
      {result.checks.map((check) => (
        <CheckLine key={check.id} check={check} />
      ))}
      {result.needs_auth ? (
        <p className="text-xs text-warning">This server needs a bearer token or OAuth.</p>
      ) : null}
    </div>
  );
}

function McpServerForm({ initial, onClose, onSaved }) {
  const editing = initial?.id != null;
  const initialId = initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [transport, setTransport] = useState(initial?.transport || 'http');
  const [url, setUrl] = useState(initial?.url || '');
  const [authMethod, setAuthMethod] = useState(
    () => initial?.auth_method || deriveAuthMethod(initial)
  );
  // Live OAuth-connected view for the dialog (the list reloads separately).
  const [oauthConnected, setOauthConnected] = useState(
    initial?.oauth_connected === true &&
      (initial?.auth_method || deriveAuthMethod(initial)) === 'oauth'
  );
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [description, setDescription] = useState(initial?.description || '');
  const [enabled, setEnabled] = useState(initial ? !!initial.enabled : true);
  const [oauthCheck, setOauthCheck] = useState(null);
  const [scope, setScope] = useState(initial?.oauth_scope || '');
  const [clientId, setClientId] = useState(initial?.oauth_client_id || '');
  const [bearerToken, setBearerToken] = useState(undefined);
  const [clientSecret, setClientSecret] = useState(undefined);
  const [replaceHeaders, setReplaceHeaders] = useState(!editing);
  const [headerRows, setHeaderRows] = useState(rowsFromHeaders(initial?.headers));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showOAuthAdvanced, setShowOAuthAdvanced] = useState(false);

  /** DCR-backed smart connect, when the probe returned availability. */
  const smartConnect = oauthCheck?.state === 'done' && oauthCheck.dcr_available === true;
  /** Manual client fields matter only when dynamic registration is not usable. */
  const oauthManual = authMethod === 'oauth' && !smartConnect;
  const canSave = !!name.trim() && !!url.trim();

  const payload = () => {
    const body = {
      name: name.trim(),
      transport,
      url: url.trim(),
      description: description.trim() || null,
      auth_method: authMethod,
      enabled,
      oauth_scope: scope.trim() || null,
    };
    // Switching methods clears the other method's fields so the credential set
    // matches the picker. Smart connect leaves client fields untouched: a
    // previously stored dynamic registration should survive.
    if (authMethod === 'oauth') {
      body.bearer_token = null;
      if (oauthManual) {
        body.oauth_client_id = clientId.trim() || null;
        if (clientSecret !== undefined) body.oauth_client_secret = clientSecret || null;
      }
    } else {
      body.oauth_client_id = null;
      body.oauth_client_secret = null;
      if (bearerToken !== undefined) body.bearer_token = bearerToken || null;
    }
    if (replaceHeaders) body.headers = headersFromRows(headerRows);
    return body;
  };

  const saveServer = async () => {
    if (editing) await mcpServersService.patch(initialId, payload());
    else return mcpServersService.create(payload());
    return null;
  };

  /** A server that was OAuth-connected and is switched away keeps no tokens. */
  const clearStaleOAuthTokens = async () => {
    if (!editing || !oauthConnected || authMethod === 'oauth') return;
    try {
      await mcpServersService.disconnectOAuth({ id: initialId });
    } catch (err) {
      // Secondary cleanup: the save already succeeded, the picker decides what
      // agents actually use, so a failed token wipe must not block it.
      toastError('Failed to disconnect MCP server', err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveServer();
      await clearStaleOAuthTokens();
      onSaved();
    } catch (err) {
      toastError(editing ? 'Failed to update MCP server' : 'Failed to add MCP server', err);
    } finally {
      setSaving(false);
    }
  };

  /** Save (create or update), then start OAuth and redirect from this browser. */
  const handleSaveAndConnect = async () => {
    setConnecting(true);
    try {
      const saved = await saveServer();
      const id = saved?.id ?? initialId;
      const started = await mcpServersService.startOAuth({ id });
      if (started?.already_authorized) {
        setOauthConnected(true);
        toast.success('MCP server connected');
        onSaved();
        return;
      }
      if (typeof started?.authorization_url === 'string' && started.authorization_url) {
        window.location.assign(started.authorization_url);
      }
    } catch (err) {
      toastError('Failed to start MCP OAuth', err);
    } finally {
      setConnecting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const body = payload();
      if (editing) body.id = initial.id;
      const result = await mcpServersService.testConnectivity(body);
      setTestResult(result);
    } catch (err) {
      toastError('MCP connection test failed', err);
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await mcpServersService.disconnectOAuth({ id: initialId });
      setOauthConnected(false);
    } catch (err) {
      toastError('Failed to disconnect MCP server', err);
    }
  };

  const updateHeader = (index, field, value) => {
    setHeaderRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const checkTarget = url.trim();
  const canCheckOauth = checkTarget.startsWith('http://') || checkTarget.startsWith('https://');
  useEffect(() => {
    if (!canCheckOauth) return undefined;
    let cancelled = false;
    setOauthCheck({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const body = editing ? { id: initialId, url: checkTarget } : { url: checkTarget };
        const result = await mcpServersService.describeOAuth(body);
        if (!cancelled) setOauthCheck({ state: 'done', dcr_available: !!result.dcr_available });
      } catch (err) {
        if (!cancelled) {
          setOauthCheck({ state: 'failed', message: err?.message || 'unreachable' });
        }
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canCheckOauth, checkTarget, editing, initialId]);

  return (
    <Modal maxWidth="max-w-lg" panelClassName="w-full">
      <ModalHeader title={editing ? 'Edit MCP server' : 'Add MCP server'} onClose={onClose} />
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-secondary">Name</span>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="docs"
            className="mt-1"
            autoFocus
          />
          <span className="mt-1 block text-xs text-faint">
            Letters, numbers, underscores, and hyphens. This is the tool namespace agents see.
          </span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-sm sm:col-span-1">
            <span className="text-secondary">Transport</span>
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              className={`${INPUT_CLASS} mt-1`}
            >
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
            </select>
            {transport === 'sse' ? (
              <span className="mt-1 block text-xs text-faint">
                Pi sessions skip SSE servers. Claude and Cursor still attach them.
              </span>
            ) : null}
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-secondary">URL</span>
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              className="mt-1"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-secondary">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — when and why agents should use this server"
            rows={3}
            className={`${INPUT_CLASS} mt-1`}
          />
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-strong text-accent focus:ring-brand/50"
            />
            Enable by default
          </label>
          <p className="text-xs text-faint">
            New sessions start with this server switched on. You can turn it on or off for one
            session from More options or the session Details tab.
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-secondary">Authentication</span>
            <OAuthAvailability status={oauthCheck} />
          </div>
          <AuthMethodOption
            value="none"
            label="None (public)"
            hint="The server alone decides who can call it."
            checked={authMethod === 'none'}
            onChange={() => setAuthMethod('none')}
          />
          <AuthMethodOption
            value="bearer"
            label="Bearer token"
            hint="Sent as an Authorization header on every call."
            checked={authMethod === 'bearer'}
            onChange={() => setAuthMethod('bearer')}
          />
          <AuthMethodOption
            value="oauth"
            label={smartConnect ? 'OAuth — smart connect' : 'OAuth — manual client'}
            hint={
              smartConnect
                ? 'Baguette registers itself during Connect (dynamic client registration).'
                : 'Pre-registered client id, pasted below, then Connect in the browser.'
            }
            checked={authMethod === 'oauth'}
            onChange={() => setAuthMethod('oauth')}
          />
        </div>
        {authMethod === 'bearer' ? (
          <>
            <label className="block text-sm">
              <span className="text-secondary">Bearer token</span>
              <div className="mt-1">
                <MaskedSecretInput
                  maskedValue={initial?.bearer_token || ''}
                  placeholder="Optional"
                  onChange={(value, dirty) => setBearerToken(dirty ? value || '' : undefined)}
                />
              </div>
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-secondary">Extra headers</span>
                {editing ? (
                  <label className="flex items-center gap-2 text-xs text-faint">
                    <input
                      type="checkbox"
                      checked={replaceHeaders}
                      onChange={(e) => setReplaceHeaders(e.target.checked)}
                      className="rounded border-strong text-accent focus:ring-brand/50"
                    />
                    Replace
                  </label>
                ) : null}
              </div>
              {replaceHeaders ? (
                <div className="space-y-2">
                  {headerRows.map((row, index) => (
                    <div key={index} className="grid grid-cols-2 gap-2">
                      <TextInput
                        value={row.name}
                        onChange={(e) => updateHeader(index, 'name', e.target.value)}
                        placeholder="Header name"
                      />
                      <TextInput
                        value={row.value}
                        onChange={(e) => updateHeader(index, 'value', e.target.value)}
                        placeholder="Value"
                        type="password"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-xs text-fg-muted hover:text-heading"
                    onClick={() => setHeaderRows((rows) => [...rows, { name: '', value: '' }])}
                  >
                    Add header
                  </button>
                </div>
              ) : (
                <p className="text-xs text-faint">Stored headers stay unchanged.</p>
              )}
            </div>
          </>
        ) : null}
        {authMethod === 'oauth' ? (
          <>
            {oauthConnected ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/40 px-3 py-2">
                <span className="text-sm text-success">Authenticated with OAuth</span>
                {editing ? (
                  <button
                    type="button"
                    className="text-xs text-danger hover:text-danger disabled:opacity-40"
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
            ) : null}
            {oauthManual ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-secondary">OAuth client ID</span>
                  <TextInput
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="From the provider's console"
                    className="mt-1"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-secondary">OAuth client secret</span>
                  <div className="mt-1">
                    <MaskedSecretInput
                      maskedValue={initial?.oauth_client_secret_configured ? '••••••' : ''}
                      placeholder="Optional"
                      onChange={(value, dirty) => setClientSecret(dirty ? value || '' : undefined)}
                    />
                  </div>
                </label>
              </div>
            ) : null}
            {oauthManual ? (
              <label className="block text-sm">
                <span className="text-secondary">OAuth scope</span>
                <TextInput
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  placeholder="Optional"
                  className="mt-1"
                />
              </label>
            ) : null}
            {smartConnect && !oauthConnected ? (
              <div className="space-y-1.5">
                <button
                  type="button"
                  className="text-xs text-fg-muted hover:text-heading"
                  onClick={() => setShowOAuthAdvanced((show) => !show)}
                >
                  {showOAuthAdvanced ? 'Hide advanced' : 'Advanced — override OAuth scope'}
                </button>
                {showOAuthAdvanced ? (
                  <label className="block text-sm">
                    <span className="text-secondary">OAuth scope</span>
                    <TextInput
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                      placeholder="Optional — the server's advertised scopes are used by default"
                      className="mt-1"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {canSave && !oauthConnected ? (
              <button
                type="button"
                onClick={handleSaveAndConnect}
                disabled={connecting || saving || !url.trim()}
                className={GHOST_BUTTON_CLASS}
              >
                {connecting ? 'Connecting…' : 'Connect with browser'}
              </button>
            ) : null}
          </>
        ) : null}
        <TestResult result={testResult} />
      </div>
      <ModalActions>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !url.trim()}
          className={GHOST_BUTTON_CLASS}
        >
          <PlugZap className={`w-3.5 h-3.5 inline mr-1 ${testing ? 'animate-pulse' : ''}`} />
          {testing ? 'Testing…' : 'Test'}
        </button>
        <button type="button" onClick={onClose} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !name.trim() || !url.trim()}
          className={PRIMARY_BUTTON_SIZED}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </ModalActions>
    </Modal>
  );
}

function authLabel(server) {
  if (server.oauth_connected) return 'OAuth connected';
  if (server.auth_method === 'oauth') return 'OAuth (not connected)';
  if (server.auth_method === 'bearer') return 'Bearer token';
  if (server.auth_method === 'none') return 'No auth';
  return server.bearer_token_configured ? 'Bearer token' : 'No auth';
}

export default function McpServersSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [testById, setTestById] = useState({});

  const reload = () =>
    mcpServersService
      .find()
      .then((res) => setServers(res.data ?? []))
      .catch((err) => toastError('Failed to load MCP servers', err));

  useEffect(() => {
    let cancelled = false;
    mcpServersService
      .find()
      .then((res) => {
        if (!cancelled) setServers(res.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) toastError('Failed to load MCP servers', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const status = searchParams.get('mcp_oauth');
    if (!status) return;
    if (status === 'ok') toast.success('MCP server connected');
    else {
      toastError(
        'MCP connection failed',
        new Error(searchParams.get('mcp_error') || 'OAuth failed')
      );
    }
    const next = new URLSearchParams(searchParams);
    next.delete('mcp_oauth');
    next.delete('mcp_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const patchServer = async (server, data, label) => {
    setBusyId(server.id);
    try {
      await mcpServersService.patch(server.id, data);
      await reload();
    } catch (err) {
      toastError(label, err);
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (server) => {
    setBusyId(server.id);
    try {
      const result = await mcpServersService.testConnectivity({ id: server.id });
      setTestById((prev) => ({ ...prev, [server.id]: result }));
    } catch (err) {
      toastError('MCP connection test failed', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleConnect = async (server) => {
    setBusyId(server.id);
    try {
      const result = await mcpServersService.startOAuth({ id: server.id });
      if (result.already_authorized) {
        toast.success('MCP server already connected');
        await reload();
        return;
      }
      window.location.assign(result.authorization_url);
    } catch (err) {
      toastError('Failed to start MCP OAuth', err);
      setBusyId(null);
    }
  };

  const handleDisconnect = async (server) => {
    setBusyId(server.id);
    try {
      await mcpServersService.disconnectOAuth({ id: server.id });
      await reload();
    } catch (err) {
      toastError('Failed to disconnect MCP server', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (server) => {
    if (!window.confirm(`Remove MCP server “${server.name}”?`)) return;
    setBusyId(server.id);
    try {
      await mcpServersService.remove(server.id);
      await reload();
    } catch (err) {
      toastError('Failed to delete MCP server', err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsSection
      title="MCP servers"
      description="HTTP and SSE servers your agents can call. Pi sessions use HTTP only and skip SSE. The enable switch is the default for new sessions. Override it from More options or the session Details tab. OAuth tokens are used instead of a bearer token when both are set."
      headerAside={
        <button type="button" className={PRIMARY_BUTTON_SIZED} onClick={() => setAdding(true)}>
          Add server
        </button>
      }
    >
      {loading ? <p className="text-sm text-faint">Loading…</p> : null}
      {!loading && servers.length === 0 ? (
        <p className="text-sm text-faint">No MCP servers yet.</p>
      ) : null}
      <div className="space-y-3">
        {servers.map((server) => (
          <div key={server.id} className="rounded-lg border border-strong/80 px-3 py-3 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-heading">
                  {server.name}{' '}
                  <span className="text-xs font-normal uppercase text-faint">
                    {server.transport}
                  </span>
                </p>
                <p className="text-xs text-faint truncate" title={server.url}>
                  {server.url}
                </p>
                {server.description ? (
                  <p className="text-xs text-secondary mt-1 whitespace-pre-wrap max-w-md">
                    {server.description}
                  </p>
                ) : null}
                {server.transport === 'sse' ? (
                  <p className="text-xs text-faint">Not attached on Pi sessions.</p>
                ) : null}
                <p className="text-xs text-fg-muted mt-1">{authLabel(server)}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-secondary shrink-0">
                <input
                  type="checkbox"
                  checked={!!server.enabled}
                  disabled={busyId === server.id}
                  onChange={(e) =>
                    patchServer(
                      server,
                      { enabled: e.target.checked },
                      'Failed to update MCP server'
                    )
                  }
                  className="rounded border-strong text-accent focus:ring-brand/50"
                />
                Enabled
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs text-fg-muted hover:text-heading disabled:opacity-40"
                disabled={busyId === server.id}
                onClick={() => handleTest(server)}
              >
                Test
              </button>
              {server.oauth_connected ? (
                <button
                  type="button"
                  className="text-xs text-fg-muted hover:text-heading disabled:opacity-40"
                  disabled={busyId === server.id}
                  onClick={() => handleDisconnect(server)}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="text-xs text-fg-muted hover:text-heading disabled:opacity-40"
                  disabled={busyId === server.id}
                  onClick={() => handleConnect(server)}
                >
                  Connect
                </button>
              )}
              <button
                type="button"
                className="text-xs text-fg-muted hover:text-heading"
                onClick={() => setEditing(server)}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-xs text-danger hover:text-danger disabled:opacity-40"
                disabled={busyId === server.id}
                onClick={() => handleDelete(server)}
              >
                Delete
              </button>
            </div>
            <TestResult result={testById[server.id]} />
          </div>
        ))}
      </div>
      {adding ? (
        <McpServerForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}
      {editing ? (
        <McpServerForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
