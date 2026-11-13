/**
 * Account-scoped context for MCP tools (repos, sessions, loops).
 */
export function createAccountContext(user, app, { callerSession = null, callerAgent = null } = {}) {
  const userId = user.id;
  const userParams = { provider: undefined, user: { id: userId } };

  const requireRepoAccess = async (repoId) => {
    const db = app.get('db');
    const row = await db('repos')
      .join('user_repos', 'repos.id', 'user_repos.repo_id')
      .where('user_repos.user_id', userId)
      .where('repos.id', repoId)
      .whereNull('repos.deleted_at')
      .select(
        'repos.id',
        'repos.full_name',
        'repos.default_branch',
        'user_repos.id as user_repo_id'
      )
      .first();
    return row ?? null;
  };

  const loadRepoWithKeys = async (repoId) => {
    const repos = await app.service('repos').find(userParams);
    const list = Array.isArray(repos) ? repos : (repos?.data ?? []);
    return list.find((r) => r.id === repoId) ?? null;
  };

  return {
    user,
    userId,
    userParams,
    app,
    callerSession,
    callerAgent,
    requireRepoAccess,
    loadRepoWithKeys,
  };
}
