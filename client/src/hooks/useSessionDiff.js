import { useState, useEffect, useCallback, useRef } from 'react';
import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { useMarkSessionDiffStaleOnFileTools } from './useMarkSessionDiffStaleOnFileTools.js';

/**
 * Branch or single-commit diff text. Loads when the Diff tab is first opened (or commit
 * changes). While `stale`, keeps the cached diff until `refresh()`. Does not refetch
 * when switching back to the tab if the cache is marked stale.
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
  const [diff, setDiff] = useState(null);
  const [fileByFile, setFileByFile] = useState(false);
  const [diffFile, setDiffFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const satisfiedFetchKeyRef = useRef(null);
  const staleRef = useRef(false);

  const fetchKey = skip
    ? null
    : `${sessionId}:${selectedCommit}:${selectedFile ?? ''}:${refreshNonce}`;

  const markStale = useCallback(() => {
    staleRef.current = true;
    setStale(true);
  }, []);

  useMarkSessionDiffStaleOnFileTools(sessionId, markStale);
  useInvalidateOnSessionTurnComplete(sessionId, markStale);

  useEffect(() => {
    setDiff(null);
    setFileByFile(false);
    setDiffFile(null);
    setError(null);
    setStale(false);
    staleRef.current = false;
    setHasFetched(false);
    satisfiedFetchKeyRef.current = null;
    setRefreshNonce(0);
    setLoading(false);
  }, [sessionId, selectedCommit]);

  useEffect(() => {
    if (skip || !enabled) {
      setLoading(false);
      return;
    }
    // Stale cache for this file/commit selection — keep until refresh; still fetch other keys.
    if (
      staleRef.current &&
      hasFetched &&
      refreshNonce === 0 &&
      fetchKey &&
      satisfiedFetchKeyRef.current === fetchKey
    ) {
      setLoading(false);
      return;
    }
    if (fetchKey && satisfiedFetchKeyRef.current === fetchKey) {
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
          setDiff(res.diff || '');
          setFileByFile(!!res.file_by_file);
          setDiffFile(res.file_path || null);
          setStale(false);
          staleRef.current = false;
          setHasFetched(true);
          satisfiedFetchKeyRef.current = fetchKey;
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
    stale,
    hasFetched,
    // staleRef is synchronous; `stale` state retriggers this effect when marking stale.
  ]);

  const refresh = useCallback(() => {
    satisfiedFetchKeyRef.current = null;
    setRefreshNonce((n) => (n === 0 ? 1 : n + 1));
  }, []);

  return { diff, fileByFile, diffFile, loading, error, stale, hasFetched, refresh };
}
