/** Navbar / dashboard: list sessions across every repository. */
export const ALL_REPOS = '__all__';
/** Navbar / dashboard: sessions that are not tied to a single repository. */
export const GLOBAL_SCOPE = '__global__';

export function isGlobalSession(session) {
  return Boolean(session?.is_global);
}

/** True on All sessions (`/`), unscoped session view (`/sessions/:id`), and loop edit (`/loop/:id`). */
export function isAllSessionsPath(pathname) {
  if (!pathname) return false;
  return pathname === '/' || pathname.startsWith('/sessions/') || pathname.startsWith('/loop/');
}

/** Dashboard home for the current picker scope (All sessions, Global, or a repo). */
export function homeUrlForScope({ fromAllSessions, selectedRepo, repoId } = {}) {
  if (fromAllSessions || selectedRepo === ALL_REPOS || !selectedRepo) return '/';
  if (selectedRepo === GLOBAL_SCOPE) return '/global';
  if (repoId == null) return '/';
  return `/repos/${repoId}`;
}

function scopedItemUrl(id, segment, scope) {
  const home = homeUrlForScope(scope);
  if (!id) return home;
  if (home === '/') return `/${segment}/${id}`;
  return `${home}/${segment}/${id}`;
}

/** Session URL that stays in the same picker scope as `homeUrlForScope`. */
export function sessionUrlForScope(sessionId, scope) {
  return scopedItemUrl(sessionId, 'sessions', scope);
}

/** Loop-edit URL that stays in the same picker scope as `homeUrlForScope`. */
export function loopEditUrlForScope(loopId, scope) {
  return scopedItemUrl(loopId, 'loop', scope);
}

export function sessionHref(session, { fromAllSessions } = {}) {
  if (!session?.short_id) return '/';
  if (fromAllSessions) return `/sessions/${session.short_id}`;
  if (isGlobalSession(session) || !session.repo_id) {
    return `/global/sessions/${session.short_id}`;
  }
  return `/repos/${session.repo_id}/sessions/${session.short_id}`;
}

/**
 * Git / PR / current-repo MCP tools that do not apply when the agent cwd is the
 * shared `repos/` folder rather than a single worktree.
 */
export const GLOBAL_SESSION_EXCLUDED_MCP_TOOLS = [
  'GitPull',
  'GitPush',
  'GitFetch',
  'PrRead',
  'PrUpsert',
  'PrComments',
  'PrMarkCommentViewed',
  'PrComment',
  'PrReview',
  'PrWorkflows',
  'PrWorkflowLogs',
  'ListGithubPrs',
  'GetGithubPr',
  'AddGithubLabel',
  'ListGithubTags',
  'ConfigRepoPrompt',
  'ConfigRepoStart',
  'ShowDiff',
  'ListProjectCommands',
  'RunProjectCommand',
];
