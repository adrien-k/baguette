import { useState, useEffect, useCallback, useRef } from 'react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { parseChangedFilesResponse } from '../utils/changedFilesResponse.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';

/**
 * Session-wide changed files vs base, loaded once per session. `refresh()` is the
 * only later session fetch. When `commitSha` is set, the list is replaced by that
 * commit's files (fetched once per sha until refresh).
 */
export function useSessionChangedFiles(session, commitSha = null) {
  const sessionId = session?.id;
  const skip = !sessionId || isGlobalSession(session ?? {});
  const [sessionFiles, setSessionFiles] = useState(undefined);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [commitFilesBySha, setCommitFilesBySha] = useState({});
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitNonce, setCommitNonce] = useState(0);
  const commitFilesRef = useRef(commitFilesBySha);
  commitFilesRef.current = commitFilesBySha;

  useEffect(() => {
    setCommitFilesBySha({});
  }, [sessionId]);

  useEffect(() => {
    if (skip) {
      setSessionFiles([]);
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    sessionsService
      .changedFiles(sessionId)
      .then((res) => {
        if (!cancelled) setSessionFiles(parseChangedFilesResponse(res));
      })
      .catch((err) => {
        if (!cancelled) {
          setSessionFiles([]);
          toastError('Failed to load changed files', err);
        }
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skip, sessionId, sessionNonce]);

  useEffect(() => {
    if (skip || !commitSha) {
      setCommitLoading(false);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(commitFilesRef.current, commitSha)) {
      setCommitLoading(false);
      return;
    }
    let cancelled = false;
    setCommitLoading(true);
    sessionsService
      .changedFiles({ id: sessionId, commit: commitSha })
      .then((res) => {
        if (cancelled) return;
        setCommitFilesBySha((prev) => ({
          ...prev,
          [commitSha]: parseChangedFilesResponse(res),
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setCommitFilesBySha((prev) => ({ ...prev, [commitSha]: [] }));
        toastError('Failed to load changed files', err);
      })
      .finally(() => {
        if (!cancelled) setCommitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skip, sessionId, commitSha, commitNonce]);

  const refresh = useCallback(() => {
    if (commitSha) {
      setCommitFilesBySha((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, commitSha)) return prev;
        const next = { ...prev };
        delete next[commitSha];
        return next;
      });
      setCommitNonce((n) => n + 1);
      return;
    }
    setSessionNonce((n) => n + 1);
  }, [commitSha]);

  const files = commitSha
    ? Object.prototype.hasOwnProperty.call(commitFilesBySha, commitSha)
      ? commitFilesBySha[commitSha]
      : undefined
    : sessionFiles;
  const loading = commitSha ? commitLoading : sessionLoading;

  return { files, loading, refresh };
}
