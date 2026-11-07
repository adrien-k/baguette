import { useState } from 'react';
import { mcpServersService } from '../../feathers.js';
import { GHOST_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { parseMcpJsonResult } from '../../utils/parseMcpJsonResult.ts';

/** Block copy of the saved/updated server from `ConfigureMcpServer` results. */
export type ConfigureServer = {
  id?: number | string;
  name?: string;
  transport?: string;
  url?: string;
  description?: string | null;
  oauth_connected?: boolean;
};

/**
 * Card for `ConfigureMcpServer` tool results: what was saved, the when/why
 * guidance the user wrote, and a Connect action that starts the OAuth flow
 * from the browser session and redirects — same behavior as the Settings
 * → Integrations Connect button. The authorization link from the tool stays
 * available as a fallback.
 */
export default function ConfigureMcpServerBlock({
  args,
  result,
  isError,
}: {
  args: Record<string, unknown>;
  result?: unknown;
  isError: boolean;
}) {
  const mcpResult = parseMcpJsonResult(result);
  const server = mcpResult?.server as ConfigureServer | undefined;
  const running = result == null;
  const failed = mcpResult?.ok === false;
  const errorMessage =
    (failed && typeof mcpResult?.error === 'string' ? mcpResult.error : null) ??
    (isError && result != null ? String(result).slice(0, 200) : null);
  const name = (server?.name as string) ?? (args.name as string) ?? '(unnamed server)';
  const url = (server?.url as string) ?? (args.url as string) ?? '';
  const transport = (server?.transport as string) ?? (args.transport as string) ?? 'http';
  const description =
    (server?.description as string | null | undefined) ??
    (args.description as string | null | undefined) ??
    '';
  const authorizationUrl =
    typeof mcpResult?.authorization_url === 'string' ? mcpResult.authorization_url : null;
  const sessionEnabled = mcpResult?.session_enabled === true;
  const [connecting, setConnecting] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(server?.oauth_connected === true);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnect = async () => {
    const id = server?.id;
    if (id == null || connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const started = await mcpServersService.startOAuth({ id: Number(id) });
      if (started?.already_authorized) {
        setOauthConnected(true);
        return;
      }
      if (typeof started?.authorization_url === 'string' && started.authorization_url) {
        window.location.assign(started.authorization_url);
      }
    } catch (err) {
      setConnectError((err as Error)?.message || 'Failed to start MCP OAuth');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      className={`bg-inset/50 rounded-lg border overflow-hidden ${failed || isError ? 'border-danger/60' : 'border-info/50'}`}
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 min-w-0">
        <span className="text-accent text-xs font-mono shrink-0">MCP server</span>
        {(failed || isError) && (
          <span className="shrink-0 text-danger text-xs font-medium bg-soft-danger px-1.5 py-0.5 rounded">
            error
          </span>
        )}
        {running ? (
          <div className="w-3.5 h-3.5 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : null}
      </div>
      <div className="px-3 sm:px-4 py-3 border-t border-line text-xs space-y-2">
        <div className="flex flex-wrap items-baseline gap-2 min-w-0">
          <span className="text-fg text-sm font-semibold">{name}</span>
          <span className="text-[10px] font-normal uppercase text-faint">{transport}</span>
        </div>
        {url ? (
          <p className="text-faint truncate" title={url}>
            {url}
          </p>
        ) : null}
        {!running ? (
          <>
            {description ? (
              <p className="text-secondary whitespace-pre-wrap">{description}</p>
            ) : null}
            {server?.id != null ? (
              <p className={sessionEnabled ? 'text-success' : 'text-faint'}>
                {sessionEnabled ? 'Enabled on this session' : 'Not enabled on this session'}
              </p>
            ) : null}
            {oauthConnected ? <p className="text-success">Connected with OAuth</p> : null}
          </>
        ) : null}
        {errorMessage ? <p className="text-danger whitespace-pre-wrap">{errorMessage}</p> : null}
        {connectError ? <p className="text-danger text-[11px]">{connectError}</p> : null}
        {!running ? (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {server?.id != null && !oauthConnected ? (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className={GHOST_BUTTON_CLASS}
              >
                {connecting ? 'Connecting…' : 'Connect with browser'}
              </button>
            ) : null}
            {authorizationUrl ? (
              <a
                href={authorizationUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Open authorization link
              </a>
            ) : null}
            {server?.id != null && !failed && !oauthConnected ? (
              <span className="text-faint">
                Returns to Settings → Integrations after approving.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
