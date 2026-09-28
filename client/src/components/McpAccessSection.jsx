import { useState } from 'react';
import { usersService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { SettingsSection } from './SettingsSection.jsx';

export default function McpAccessSection({
  configured,
  maskedToken,
  endpoint: endpointFromSettings,
  onTokenChange,
}) {
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revealedToken, setRevealedToken] = useState(null);
  const [endpoint, setEndpoint] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setRevealedToken(null);
    setEndpoint(null);
    try {
      const result = await usersService.generateMcpToken();
      setRevealedToken(result.token);
      setEndpoint(result.endpoint);
      await onTokenChange?.();
    } catch (err) {
      toastError('Failed to generate MCP token', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await usersService.revokeMcpToken();
      setRevealedToken(null);
      setEndpoint(null);
      await onTokenChange?.();
    } catch (err) {
      toastError('Failed to revoke MCP token', err);
    } finally {
      setRevoking(false);
    }
  };

  const copyToken = async () => {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
    } catch (err) {
      toastError('Failed to copy token', err);
    }
  };

  const displayedEndpoint = endpoint ?? endpointFromSettings;
  const showMasked = configured && maskedToken && !revealedToken;

  return (
    <SettingsSection
      title="External MCP access"
      description="Connect external agents (Cursor, Claude Desktop, etc.) to Baguette over HTTP MCP. Tools include listing repos, branches, models, sessions, and creating sessions."
    >
      <p className="text-xs text-faint">
        Status:{' '}
        <span className={configured ? 'text-success' : 'text-fg-muted'}>
          {configured ? 'Token configured' : 'No token — external MCP disabled'}
        </span>
      </p>

      {displayedEndpoint && configured && (
        <p className="text-xs text-fg-muted">
          Endpoint: <code className="text-secondary">{displayedEndpoint}</code>
        </p>
      )}

      {revealedToken && (
        <div className="space-y-2">
          <p className="text-xs text-warning bg-soft-accent/30 border border-warning/50 rounded-lg px-3 py-2">
            Copy this token now. It is shown only once; regenerating discards the previous token.
          </p>
          <div className="flex gap-2 items-start">
            <code className="flex-1 text-xs bg-control border border-strong rounded-lg px-3 py-2 text-heading break-all">
              {revealedToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="shrink-0 text-xs bg-control-hover hover:bg-track text-fg px-3 py-2 rounded-lg"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {showMasked && (
        <div className="space-y-2">
          <label className="text-xs text-fg-muted">Token</label>
          <code className="block text-xs bg-control border border-strong rounded-lg px-3 py-2 text-fg-muted font-mono break-all">
            {maskedToken}
          </code>
          <p className="text-xs text-faint">
            Full token is only shown when you generate or regenerate. Use header{' '}
            <code className="text-fg-muted">Authorization: Bearer &lt;token&gt;</code>
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="bg-brand hover:bg-brand-hover disabled:bg-disabled text-on-brand px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {generating ? 'Generating…' : configured ? 'Regenerate token' : 'Generate token'}
        </button>
        {configured && (
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking}
            className="text-sm text-danger hover:text-danger px-3 py-2 disabled:opacity-50"
          >
            {revoking ? 'Revoking…' : 'Revoke token'}
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
