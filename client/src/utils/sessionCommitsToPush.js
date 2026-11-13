import { sessionsService } from '../feathers.js';
import { isGlobalSession } from '@baguette/shared/session-scope.js';

function emptyStatus() {
  return { commitsToPush: 0, commitsNotOnAnyRemote: 0 };
}

/** Named-branch unpushed count and commits on HEAD not on any remote (0 for global sessions). */
export async function fetchSessionGitStatus(session) {
  if (!session?.id || isGlobalSession(session)) return emptyStatus();
  const status = await sessionsService.sessionGitStatus(session.id);
  return {
    commitsToPush: status.commitsToPush ?? 0,
    commitsNotOnAnyRemote: status.commitsNotOnAnyRemote ?? 0,
  };
}

/** Local commits not yet on the session remote branch (0 for global sessions). */
export async function fetchSessionCommitsToPush(session) {
  const { commitsToPush } = await fetchSessionGitStatus(session);
  return commitsToPush;
}
