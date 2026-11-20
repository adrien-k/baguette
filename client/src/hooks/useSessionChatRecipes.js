import { useState, useEffect, useCallback } from 'react';
import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useInvalidateOnSessionTurnComplete } from './useInvalidateOnSessionTurnComplete.js';

function shouldSkipRecipes(session) {
  if (!session?.id) return true;
  if (isGlobalSession(session)) return true;
  if (!session.session_path) return true;
  return session.status === 'archiving' || session.status === 'archived';
}

/** Composer recipes dropdown (built-in + `.baguette.yaml` custom). */
export function useSessionChatRecipes(session, activeAgent) {
  const sessionId = session?.id;
  const agentType = activeAgent?.agent_type ?? 'builder';
  const skip = shouldSkipRecipes(session);
  const [recipes, setRecipes] = useState([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const invalidate = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);
  useInvalidateOnSessionTurnComplete(sessionId, invalidate);

  useEffect(() => {
    if (skip) {
      setRecipes([]);
      return;
    }
    let cancelled = false;
    sessionsService
      .recipes({ id: sessionId, agent_type: agentType })
      .then((d) => {
        if (!cancelled) setRecipes(d.recipes || []);
      })
      .catch(() => {
        if (!cancelled) setRecipes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [skip, sessionId, agentType, refreshNonce]);

  return recipes;
}
