import { useState, useEffect, useCallback, useRef } from 'react';
import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';

/**
 * Branch or single-commit diff text. Fetches only while `enabled` is true (e.g. Diff tab
 * visible), but keeps the last result in memory when `enabled` is false so tab switches
 * do not refetch. `refresh()` and turn completion invalidate and refetch on next enable.
 *
 * When the API returns `file_by_file`, pass `selectedFile` to load another file without
 * re-fetching the full diff.
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
  const [refreshNonce, setRefreshNonce] = useState(0);
  const satisfiedFetchKeyRef = useRef(null);

  const fetchKey = skip
    ? null
    : `${sessionId}:${selectedCommit}:${selectedFile ?? ''}:${refreshNonce}`;

  const invalidate = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  useEffect(() => {
    setDiff(null);
    setFileByFile(false);
    setDiffFile(null);
    setError(null);
    satisfiedFetchKeyRef.current = null;
    setLoading(false);
  }, [sessionId, selectedCommit]);

  useEffect(() => {
    if (skip || !enabled) {
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
  ]);

  const refresh = useCallback(() => {
    satisfiedFetchKeyRef.current = null;
    setRefreshNonce((n) => n + 1);
  }, []);

  return { diff, fileByFile, diffFile, loading, error, refresh };
}
