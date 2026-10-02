import { useEffect, useRef } from 'react';
import { sessionsService } from '../feathers.js';

const CHAT_ACTIVE = new Set(['running', 'provisioning', 'archiving']);

function chatAgentActive(session) {
  return !!session && !session.archived_at && CHAT_ACTIVE.has(session.status);
}

function reviewAgentActive(session) {
  return !!session && !session.archived_at && session.review_status === 'running';
}

function activeSlotsChanged(prev, next) {
  if (!next) return !!prev && (chatAgentActive(prev) || reviewAgentActive(prev));
  if (!prev) return chatAgentActive(next) || reviewAgentActive(next);
  return (
    chatAgentActive(prev) !== chatAgentActive(next) ||
    reviewAgentActive(prev) !== reviewAgentActive(next) ||
    prev.archived_at !== next.archived_at
  );
}

/**
 * Refetch navbar / usage active-agent data on turn start & end and when session
 * status or review_status changes active slot counts.
 */
export function useAgentActivityRefresh(reload) {
  const prevByIdRef = useRef(new Map());

  useEffect(() => {
    const refresh = () => reload?.(true);

    const onPatched = (session) => {
      if (!session?.id) return;
      const prev = prevByIdRef.current.get(session.id);
      prevByIdRef.current.set(session.id, session);
      if (activeSlotsChanged(prev, session)) refresh();
    };

    const onCreated = (session) => {
      if (!session?.id) return;
      prevByIdRef.current.set(session.id, session);
      if (chatAgentActive(session) || reviewAgentActive(session)) refresh();
    };

    sessionsService.on('turn:start', refresh);
    sessionsService.on('turn:complete', refresh);
    sessionsService.on('patched', onPatched);
    sessionsService.on('created', onCreated);

    return () => {
      sessionsService.off('turn:start', refresh);
      sessionsService.off('turn:complete', refresh);
      sessionsService.off('patched', onPatched);
      sessionsService.off('created', onCreated);
    };
  }, [reload]);
}
