import { getGithubToken } from '../../agent-settings.js';
import { getOpenPRByNumber, splitPrBody } from '../../github.js';

/**
 * Read PR metadata for a repo session (any owned session when called from global/external MCP).
 * @param {object} app
 * @param {object} session - full sessions row
 */
export async function readPrForSession(app, session) {
  const result = {
    session_id: session.id,
    short_id: session.short_id ?? null,
    pr_url: session.pr_url ?? null,
    pr_number: session.pr_number ?? null,
    branch: session.remote_branch || session.local_branch || null,
    title: null,
    description: null,
  };
  if (!result.pr_url) {
    result.message =
      'No pull request exists yet. Commit your changes, set label and description with UpdateSession, and push from the UI or enable auto-push.';
    return result;
  }
  const user = await app.service('users').get(session.user_id, {});
  const token = getGithubToken(user);
  if (token && session.pr_number && session.repo_full_name) {
    const pr = await getOpenPRByNumber(token, session.repo_full_name, session.pr_number);
    result.title = pr.title;
    result.description = splitPrBody(pr.body).baguetteContent;
  }
  return result;
}
