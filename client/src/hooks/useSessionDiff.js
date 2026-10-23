import { useState, useEffect, useCallback, useRef } from 'react';
import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { useMarkSessionDiffStaleOnFileTools } from './useMarkSessionDiffStaleOnFileTools.js';

/** @typedef {null | 'viewing' | 'background'} DiffStaleMode */

/**
 * Branch or single-commit diff text. Loads when the Diff tab is first opened (or commit
 * changes). While the Diff tab is open and the cache becomes `stale`, keeps showing the
 * cached diff until `refresh()`. Leaving the tab or opening it with a stale cache refetches.
 */
export function useSessionDiff(
  session,
  selectedCommit = 'all',
  enabled = true,
  selectedFile = null
) {
  const sessionId = session?.id;
  const skip = !sessionId || isGlobalSession(session ?? {});
  const isSingleCommit = selectedCommit && selectedCommit !== 'all';
  const [cache, setCache] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [staleMode, setStaleModeState] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const enabledRef = useRef(enabled);
  const staleModeRef = useRef(null);

  const syncStaleMode = useCallback((/** @type {DiffStaleMode} */ mode) => {
    staleModeRef.current = mode;
    setStaleModeState(mode);
  }, []);

  const fetchKey = skip
    ? null
    : `${sessionId}:${selectedCommit}:${selectedFile ?? ''}:${refreshNonce}`;

  const hasFetched = cache !== null;
  const stale = staleMode !== null;
  const fileByFile = cache?.fileByFile ?? false;
  const diffFile = cache?.diffFile ?? null;

  const markStale = useCallback(() => {
    const mode = enabledRef.current ? 'viewing' : 'background';
    syncStaleMode(mode);
  }, [syncStaleMode]);

  useMarkSessionDiffStaleOnFileTools(sessionId, markStale);
  useInvalidateOnSessionTurnComplete(sessionId, markStale);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled && staleModeRef.current === 'viewing') {
      syncStaleMode('background');
    }
  }, [enabled, syncStaleMode]);

  useEffect(() => {
    setCache(null);
    setError(null);
    syncStaleMode(null);
    setRefreshNonce(0);
    setLoading(false);
  }, [sessionId, selectedCommit, syncStaleMode]);

  useEffect(() => {
    if (skip || !enabled) {
      setLoading(false);
      return;
    }
    // Stale cache while Diff tab stays open — keep until refresh; still fetch other keys.
    if (staleModeRef.current === 'viewing' && hasFetched && fetchKey && cache?.key === fetchKey) {
      setLoading(false);
      return;
    }
    if (fetchKey && cache?.key === fetchKey && staleModeRef.current === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const payload = { id: sessionId };
    if (isSingleCommit) payload.commit = selectedCommit;
    const effectiveFile = selectedFile ?? (fileByFile ? diffFile : null);
    if (fileByFile && effectiveFile) {
      payload.file_path = effectiveFile;
      payload.file_by_file = true;
    }
    sessionsService
      .diff(payload)
      .then((res) => {
        if (!cancelled) {
          setCache({
            key: fetchKey,
            diff: res.diff || '',
            fileByFile: !!res.file_by_file,
            diffFile: res.file_path || null,
          });
          syncStaleMode(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load diff');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    skip,
    sessionId,
    enabled,
    isSingleCommit,
    selectedCommit,
    selectedFile,
    fileByFile,
    diffFile,
    refreshNonce,
    fetchKey,
    staleMode,
    hasFetched,
    cache,
    // staleModeRef is synchronous; `staleMode` state retriggers this effect when marking stale.
  ]);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => (n === 0 ? 1 : n + 1));
  }, []);

  return {
    diff: cache?.diff ?? null,
    fileByFile,
    diffFile,
    loading,
    error,
    stale,
    hasFetched,
    refresh,
  };
}
