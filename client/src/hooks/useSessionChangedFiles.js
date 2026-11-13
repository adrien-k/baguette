import { useState, useCallback, useEffect } from 'react';
import { sessionsService } from '../feathers.js';
import { toastFeathersError } from '../utils/toastError.jsx';
import { parseChangedFilesResponse } from '../utils/changedFilesResponse.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';
import { sameScopeId, scopeKeyOf } from '../utils/boundScope.js';
import { useScopedResource } from './useScopedResource.js';

const EMPTY_FILES = [];
const EMPTY_COMMIT_CACHE = { sessionId: null, bySha: {} };

/**
 * Session-wide changed files vs base, loaded once per session while `enabled`.
 * `refresh()` is the only later session fetch. When `commitSha` is set, the list
 * is replaced by that commit's files (fetched once per sha until refresh).
 */
export function useSessionChangedFiles(session, commitSha = null, enabled = false) {
  const sessionId = session?.id;
  const skip = !sessionId || isGlobalSession(session ?? {});
  const [sessionNonce, setSessionNonce] = useState(0);
  const [commitNonce, setCommitNonce] = useState(0);
  const [commitCache, setCommitCache] = useState(EMPTY_COMMIT_CACHE);

  const commitBySha = sameScopeId(commitCache.sessionId, sessionId) ? commitCache.bySha : {};
  const hasCachedCommit =
    Boolean(commitSha) && Object.prototype.hasOwnProperty.call(commitBySha, commitSha);

  const sessionKey = skip || !sessionId ? '' : scopeKeyOf(sessionId);
  const { data: sessionFiles, loading: sessionLoading } = useScopedResource(sessionKey, {
    empty: undefined,
    enabled: enabled && !skip && !commitSha,
    revision: sessionNonce,
    load: async () => {
      try {
        return parseChangedFilesResponse(await sessionsService.changedFiles(sessionId));
      } catch (err) {
        toastFeathersError('Failed to load changed files', err);
        return EMPTY_FILES;
      }
    },
  });

  const commitKey = skip || !sessionId || !commitSha ? '' : scopeKeyOf(sessionId, commitSha);
  const { data: commitFiles } = useScopedResource(commitKey, {
    empty: undefined,
    enabled: enabled && !skip && Boolean(commitSha) && !hasCachedCommit,
    revision: commitNonce,
    load: async () => {
      try {
        return parseChangedFilesResponse(
          await sessionsService.changedFiles({ id: sessionId, commit: commitSha })
        );
      } catch (err) {
        toastFeathersError('Failed to load changed files', err);
        return EMPTY_FILES;
      }
    },
  });

  useEffect(() => {
    setCommitCache(EMPTY_COMMIT_CACHE);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !commitSha || commitFiles === undefined) return;
    setCommitCache((prev) => {
      const bySha = sameScopeId(prev.sessionId, sessionId) ? prev.bySha : {};
      if (bySha[commitSha] === commitFiles) return prev;
      return { sessionId, bySha: { ...bySha, [commitSha]: commitFiles } };
    });
  }, [sessionId, commitSha, commitFiles]);

  const invalidate = useCallback(() => {
    if (commitSha) {
      setCommitCache((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev.bySha, commitSha)) return prev;
        const next = { ...prev.bySha };
        delete next[commitSha];
        return { ...prev, bySha: next };
      });
      setCommitNonce((n) => n + 1);
      return;
    }
    setSessionNonce((n) => n + 1);
  }, [commitSha]);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  const refresh = useCallback(() => {
    if (commitSha) {
      setCommitCache((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev.bySha, commitSha)) return prev;
        const next = { ...prev.bySha };
        delete next[commitSha];
        return { ...prev, bySha: next };
      });
      setCommitNonce((n) => n + 1);
      return;
    }
    setSessionNonce((n) => n + 1);
  }, [commitSha]);

  if (skip) {
    return { files: EMPTY_FILES, loading: false, refresh };
  }
  if (commitSha) {
    const files = commitFiles !== undefined ? commitFiles : commitBySha[commitSha];
    return { files, loading: files === undefined, refresh };
  }
  return { files: sessionFiles, loading: sessionLoading, refresh };
}
