import { ok } from '../lib/result.js';

export function createListReposTool(ctx) {
  const { app, userParams } = ctx;
  return {
    name: 'ListRepos',
    description:
      'List repositories linked to your Baguette account (id, full_name, default_branch, session_count).',
    schema: {},
    handler: async () => {
      const repos = await app.service('repos').find(userParams);
      const list = (Array.isArray(repos) ? repos : (repos?.data ?? [])).map((r) => ({
        id: r.id,
        full_name: r.full_name,
        default_branch: r.default_branch,
        session_count: r.session_count ?? 0,
        exists_on_fs: r.exists_on_fs ?? false,
      }));
      return ok({ repos: list });
    },
  };
}
