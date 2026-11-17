import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState.js';

/**
 * Device-level map of the agent the user last had open, per session
 * (`{ [sessionId]: agentId }`, localStorage). When a session is opened without
 * an explicit `agent` URL param, the workspace reopens this agent instead of
 * always falling back to the primary builder.
 */
export function useLastOpenedAgents() {
  const persist = usePersistentState('session-agents');
  const [store, setStore] = persist.useState('last-opened', {});

  const getLastOpenedAgentId = useCallback(
    (sessionId) => {
      if (sessionId == null) return null;
      const value = store[String(sessionId)];
      return Number.isFinite(value) ? value : null;
    },
    [store]
  );

  const setLastOpenedAgentId = useCallback(
    (sessionId, agentId) => {
      if (sessionId == null || agentId == null) return;
      setStore((prev) => {
        const key = String(sessionId);
        if (prev[key] === agentId) return prev;
        return { ...prev, [key]: agentId };
      });
    },
    [setStore]
  );

  return { getLastOpenedAgentId, setLastOpenedAgentId };
}
