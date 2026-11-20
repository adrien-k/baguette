import { useState, useEffect, useCallback } from 'react';
import { agentsService } from '../feathers.js';
import { toastFeathersError } from '../utils/toastError.jsx';
import {
  boundScopeLoading,
  boundScopeValue,
  rowsForSession,
  sameScopeId,
  scopeKeyOf,
} from '../utils/boundScope.js';
import { mergeAgentServicePatch } from '../utils/sessionAgents.js';
import { useScopeRequest } from './useScopeRequest.js';

function normalizeList(res) {
  return Array.isArray(res) ? res : (res?.data ?? []);
}

export function useSessionAgents(sessionId) {
  const requestedKey = sessionId == null ? '' : scopeKeyOf(sessionId);
  const { begin, isKeyCurrent } = useScopeRequest(requestedKey);
  const [agents, setAgents] = useState([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!sessionId) {
      begin('');
      setAgents([]);
      setLoadedKey('');
      setLoading(false);
      return;
    }
    const key = requestedKey;
    const isCurrent = begin(key);
    setLoading(true);
    agentsService
      .find({ query: { session_id: sessionId, $sort: { ref: 1 }, $limit: 100 } })
      .then((res) => {
        if (!isCurrent()) return;
        setAgents(normalizeList(res));
        setLoadedKey(key);
      })
      .catch((err) => {
        if (!isCurrent()) return;
        toastFeathersError('Failed to load agents', err);
        setAgents([]);
        setLoadedKey(key);
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  }, [sessionId, requestedKey, begin]);

  useEffect(() => {
    reload();
    if (!sessionId) return undefined;
    const key = requestedKey;

    const onPatched = (row) => {
      if (!sameScopeId(row.session_id, sessionId) || !isKeyCurrent(key)) return;
      let replaced = false;
      setAgents((prev) => {
        const idx = prev.findIndex((a) => a.id === row.id);
        if (idx < 0) return prev;
        const merged = mergeAgentServicePatch(prev[idx], row);
        if (merged === prev[idx]) return prev;
        replaced = true;
        const next = prev.slice();
        next[idx] = merged;
        return next;
      });
      if (!replaced) reload();
    };
    const onCreated = (row) => {
      if (!sameScopeId(row.session_id, sessionId) || !isKeyCurrent(key)) return;
      reload();
    };
    const onRemoved = (row) => {
      if (!sameScopeId(row.session_id, sessionId) || !isKeyCurrent(key)) return;
      setAgents((prev) => {
        const next = prev.filter((a) => a.id !== row.id);
        return next.length === prev.length ? prev : next;
      });
    };
    agentsService.on('created', onCreated);
    agentsService.on('patched', onPatched);
    agentsService.on('removed', onRemoved);
    return () => {
      agentsService.off('created', onCreated);
      agentsService.off('patched', onPatched);
      agentsService.off('removed', onRemoved);
    };
  }, [sessionId, reload, requestedKey, isKeyCurrent]);

  const scopedAgents = boundScopeValue(
    requestedKey,
    loadedKey,
    rowsForSession(agents, sessionId),
    []
  );
  const agentsLoading = boundScopeLoading(requestedKey, loadedKey, loading);
  const primaryBuilder =
    scopedAgents.find((a) => a.is_primary) ?? scopedAgents.find((a) => a.agent_type === 'builder');
  const reviewer = scopedAgents.find((a) => a.agent_type === 'reviewer');

  return {
    agents: scopedAgents,
    loading: agentsLoading,
    reload,
    primaryBuilder,
    reviewer,
  };
}
