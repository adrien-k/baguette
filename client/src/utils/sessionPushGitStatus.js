import { isGlobalSession } from '@baguette/shared/session-scope.js';

/** Do not poll git status (provisioning / archive teardown). */
export function shouldSkipSessionCommitsToPush(session) {
  if (!session?.id) return true;
  if (isGlobalSession(session)) return true;
  return (
    session.status === 'provisioning' ||
    session.status === 'archiving' ||
    session.status === 'archived' ||
    !!session.archived_at
  );
}

/** Hide/disable header and chat push controls. */
export function isSessionPushToolReadonly(session) {
  if (!session) return true;
  return !!session.archived_at || session.status === 'archiving' || session.status === 'archived';
}
