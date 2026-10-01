import { useState, useEffect, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';

function shouldSkipConfigCommands(session) {
  if (!session?.id) return true;
  if (isGlobalSession(session)) return true;
  if (!session.worktree_path) return true;
  return session.status === 'archiving' || session.status === 'archived';
}

/** `.baguette.yaml` task list for the session task panel; refreshes after setup and each turn. */
export function useSessionConfigCommands(session) {
  const sessionId = session?.id;
  const skip = shouldSkipConfigCommands(session);
  const [configCommands, setConfigCommands] = useState([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const invalidate = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  useEffect(() => {
    if (skip) {
      setConfigCommands([]);
      return;
    }
    let cancelled = false;
    sessionsService
      .commands(sessionId)
      .then((d) => {
        if (!cancelled) setConfigCommands(d.commands || []);
      })
      .catch(() => {
        if (!cancelled) setConfigCommands([]);
      });
    return () => {
      cancelled = true;
    };
  }, [skip, sessionId, refreshNonce]);

  return configCommands;
}
