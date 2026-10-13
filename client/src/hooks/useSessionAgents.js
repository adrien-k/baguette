import { useState, useEffect, useCallback } from 'react';
import { agentsService } from '../feathers.js';
import { toastFeathersError } from '../utils/toastError.jsx';

function normalizeList(res) {
  return Array.isArray(res) ? res : (res?.data ?? []);
}

export function useSessionAgents(sessionId) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!sessionId) {
      setAgents([]);
      return;
    }
    setLoading(true);
    agentsService
      .find({ query: { session_id: sessionId, $sort: { id: 1 }, $limit: 10 } })
      .then((res) => setAgents(normalizeList(res)))
      .catch((err) => toastFeathersError('Failed to load agents', err))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    reload();
    if (!sessionId) return undefined;

    const onChange = (row) => {
      if (row.session_id !== sessionId) return;
      reload();
    };
    agentsService.on('created', onChange);
    agentsService.on('patched', onChange);
    agentsService.on('removed', onChange);
    return () => {
      agentsService.off('created', onChange);
      agentsService.off('patched', onChange);
      agentsService.off('removed', onChange);
    };
  }, [sessionId, reload]);

  const primaryBuilder =
    agents.find((a) => a.is_primary) ?? agents.find((a) => a.agent_type === 'builder');
  const reviewer = agents.find((a) => a.agent_type === 'reviewer');

  return { agents, loading, reload, primaryBuilder, reviewer };
}
