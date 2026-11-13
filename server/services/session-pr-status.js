import { getGithubToken } from './agent-settings.js';
import { getPRStatus } from './github.js';
import logger from '../logger.js';

/**
 * Whether the stored `pr_status` is authoritative without calling GitHub.
 * Session GET still re-fetches when stored status is `closed` (PR may reopen);
 * loop runs treat stored `closed` as terminal like `merged`.
 */
export function storedPrStatusSkipsGithubRefresh(
  storedStatus,
  { treatStoredClosedAsTerminal = false } = {}
) {
  if (storedStatus === 'merged') return true;
  if (treatStoredClosedAsTerminal && storedStatus === 'closed') return true;
  return false;
}

/**
 * Resolve a session's PR status, refreshing from GitHub when appropriate.
 * @returns {Promise<'open'|'draft'|'closed'|'merged'|null>} null when the session has no PR
 */
export async function resolveSessionPrStatus(
  app,
  session,
  user,
  { treatStoredClosedAsTerminal = false, logLabel = 'PR status refresh' } = {}
) {
  if (!session?.pr_number || !session.repo_full_name) return null;
  if (storedPrStatusSkipsGithubRefresh(session.pr_status, { treatStoredClosedAsTerminal })) {
    return session.pr_status;
  }
  const token = getGithubToken(user);
  if (!token) return session.pr_status ?? null;
  try {
    const pr_status = await getPRStatus(token, session.repo_full_name, session.pr_number);
    if (pr_status !== session.pr_status) {
      await app
        .service('sessions')
        .patch(session.id, { pr_status }, { provider: undefined, user: { id: session.user_id } });
    }
    return pr_status;
  } catch (err) {
    logger.warn({ err, sessionId: session.id }, `Failed to refresh ${logLabel}`);
    return session.pr_status ?? null;
  }
}
