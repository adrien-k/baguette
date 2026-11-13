import { useEffect, useState } from 'react';
import { mcpServersService, sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

function isOn(map, id) {
  const value = map?.[id] ?? map?.[String(id)];
  return value === true || value === 1;
}

export default function McpSessionServers({ session, readonly, onSessionUpdate }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    mcpServersService
      .find()
      .then((res) => {
        if (!cancelled) setCatalog(res.data ?? []);
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
  }, [session?.id]);

  const toggle = async (server, next) => {
    setSavingId(server.id);
    try {
      const updated = await sessionsService.patch(session.id, {
        mcp_servers: { [server.id]: next },
      });
      onSessionUpdate?.(updated);
    } catch (err) {
      toastError('Failed to update MCP servers', err);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <p className="text-sm text-faint">Loading MCP servers…</p>;
  if (!catalog.length) {
    return (
      <p className="text-sm text-faint">No MCP servers yet. Add them in Settings → Integrations.</p>
    );
  }

  const enabledMap = session?.mcp_servers || {};
  return (
    <div className="space-y-2">
      <p className="text-xs text-faint">
        Servers added after this session was created stay off until you enable them here.
      </p>
      {catalog.map((server) => (
        <label
          key={server.id}
          className="flex items-start gap-2 rounded-md border border-strong/80 bg-control/40 px-3 py-2"
        >
          <input
            type="checkbox"
            checked={isOn(enabledMap, server.id)}
            disabled={readonly || savingId === server.id}
            onChange={(e) => toggle(server, e.target.checked)}
            className="mt-0.5 rounded border-strong text-accent focus:ring-brand/50"
          />
          <span className="text-sm text-secondary leading-tight min-w-0">
            <span className="font-medium text-heading">{server.name}</span>
            <span className="block text-xs font-normal text-faint mt-0.5 truncate">
              {server.url}
            </span>
            {server.description ? (
              <span className="block text-xs font-normal text-secondary mt-0.5 whitespace-pre-wrap">
                {server.description}
              </span>
            ) : null}
            {server.transport === 'sse' ? (
              <span className="block text-xs font-normal text-faint">
                Not attached when this session uses Pi.
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}
