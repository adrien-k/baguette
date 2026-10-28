/** Navbar / dashboard: list sessions across every repository. */
export const ALL_REPOS = '__all__';

/** URL segment for the in-app “new session” form (`…/sessions/new`). */
export const NEW_SESSION_ROUTE_ID = 'new';

export function isNewSessionRouteId(routeValue) {
  return routeValue === NEW_SESSION_ROUTE_ID;
}
/** Navbar / dashboard: sessions that are not tied to a single repository. */
export const GLOBAL_SCOPE = '__global__';

export function isGlobalSession(session) {
  return Boolean(session?.is_global);
}

/** Strip `/loops` list or edit suffix so agent-scope helpers see the equivalent agents path. */
export function agentsScopePathFromPathname(pathname) {
  if (!pathname) return '/';
  const stripped = pathname.replace(/\/loops(\/[^/]+)?$/, '');
  return stripped || '/';
}

/** True when the dashboard is showing loops (list or edit). */
export function isLoopsPath(pathname) {
  if (!pathname) return false;
  return pathname === '/loops' || pathname.endsWith('/loops') || pathname.includes('/loops/');
}

/** True on All sessions (`/`), unscoped session view (`/sessions/:id`), and unscoped loops (`/loops/…`). */
export function isAllSessionsPath(pathname) {
  if (!pathname) return false;
  const scopePath = agentsScopePathFromPathname(pathname);
  return scopePath === '/' || scopePath.startsWith('/sessions/');
}

/** Dashboard home for agents in the current picker scope (All sessions, Global, or a repo). */
export function homeUrlForScope({ fromAllSessions, selectedRepo, repoId } = {}) {
  if (fromAllSessions || selectedRepo === ALL_REPOS || !selectedRepo) return '/';
  if (selectedRepo === GLOBAL_SCOPE) return '/global';
  if (repoId == null) return '/';
  return `/repos/${repoId}`;
}

/** Dashboard home for loops in the current picker scope. */
export function loopsHomeUrlForScope({ fromAllSessions, selectedRepo, repoId } = {}) {
  if (fromAllSessions || selectedRepo === ALL_REPOS || !selectedRepo) return '/loops';
  if (selectedRepo === GLOBAL_SCOPE) return '/global/loops';
  if (repoId == null) return '/loops';
  return `/repos/${repoId}/loops`;
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

/** Loop-edit URL that stays in the same picker scope as `loopsHomeUrlForScope`. */
export function loopEditUrlForScope(loopId, scope) {
  const home = loopsHomeUrlForScope(scope);
  if (!loopId) return home;
  return `${home}/${loopId}`;
}

export function sessionHref(session, { fromAllSessions } = {}) {
  if (!session?.id) return '/';
  if (fromAllSessions) return `/sessions/${session.id}`;
  if (isGlobalSession(session) || !session.repo_id) {
    return `/global/sessions/${session.id}`;
  }
  return `/repos/${session.repo_id}/sessions/${session.id}`;
}

/**
 * Git / PR / current-repo MCP tools that do not apply when the agent cwd is the
 * shared `repos/` folder rather than a single worktree.
 */
/** MCP tools omitted for `agent_type` subagent (delegated work; no session shipping or PR ownership). */
export const SUBAGENT_EXCLUDED_MCP_TOOLS = [
  'UpdateSession',
  'UpdateIssueStatus',
  'CreatePlan',
  'EditPlan',
  'StartSubagent',
  'CreateSession',
  'CreateLoop',
  'UpdateLoop',
  'DeleteLoop',
  'ConfigRepoPrompt',
  'PrComment',
  'EditPrComment',
  'PrReview',
  'PrMarkCommentViewed',
  'PrComments',
  'PrWorkflows',
  'PrWorkflowLogs',
  'AddGithubLabel',
  'ListGithubPrs',
  'GetGithubPr',
  'ListGithubTags',
];

export const GLOBAL_SESSION_EXCLUDED_MCP_TOOLS = [
  'GitPull',
  'GitPush',
  'GitFetch',
  'PrUpsert',
  'PrComments',
  'PrMarkCommentViewed',
  'PrComment',
  'EditPrComment',
  'PrReview',
  'PrWorkflows',
  'PrWorkflowLogs',
  'ListGithubPrs',
  'GetGithubPr',
  'AddGithubLabel',
  'ListGithubTags',
  'ConfigRepoPrompt',
  'ListProjectCommands',
  'RunTask',
  'AwaitDetachedTask',
];
