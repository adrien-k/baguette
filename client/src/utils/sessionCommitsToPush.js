import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';

/** Local commits not yet on the session remote branch (0 for global sessions). */
export async function fetchSessionCommitsToPush(session) {
  if (!session?.id || isGlobalSession(session)) return 0;
  const status = await sessionsService.sessionGitStatus(session.id);
  return status.commitsToPush ?? 0;
}
