/** Which repositories a Slack app's global sessions may work in (`slack_apps.allowed_repo_ids`). */

/** Repo ids from the stored JSON; null (no limit) when unset, empty or unreadable. */
export function parseRepoScope(raw) {
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return null;
    const repoIds = ids.filter(Number.isInteger);
    return repoIds.length ? repoIds : null;
  } catch {
    return null;
  }
}

/** The JSON to store for the ids an admin picked (none picked → no limit). */
export function serializeRepoScope(ids) {
  if (!Array.isArray(ids)) return null;
  const repoIds = [...new Set(ids.map(Number).filter(Number.isInteger))];
  return repoIds.length ? JSON.stringify(repoIds) : null;
}

/**
 * Repo ids a session is limited to: only Slack global session sessions are, and only when their Slack
 * app has a scope configured. Null means no limit.
 */
export async function sessionRepoScope(app, session) {
  if (!session?.slack_app_id) return null;
  return app.service('slack-global-sessions').repoScope(session.slack_app_id);
}

export async function isRepoInSlackScope(app, session, repoId) {
  const scope = await sessionRepoScope(app, session);
  return scope === null || scope.includes(repoId);
}
