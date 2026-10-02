import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';
import { useAgentActivityRefresh } from './useAgentActivityRefresh.js';

const POLL_MS = 30_000;

/**
 * @param {{ intervalMs?: number | null, onError?: (err: unknown) => void }} options
 */
export function useActiveAgents({ intervalMs = POLL_MS, onError } = {}) {
  const [agents, setAgents] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (isRefresh = false) => {
      try {
        const data = await apiFetch('/api/usage/active-agents');
        setAgents(Array.isArray(data) ? data : []);
      } catch (err) {
        onError?.(err);
      } finally {
        if (!isRefresh) setLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    load();
    if (!intervalMs) return undefined;
    const id = setInterval(() => load(true), intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  useAgentActivityRefresh(load);

  return { agents: agents ?? [], loading: loading && agents === null, reload: () => load(true) };
}
