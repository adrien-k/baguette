import { z } from 'zod';
import { listRepoTags } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createListGithubTagsTool(ctx) {
  const { resolveReadTargetSession, requireGitHubApiForSession, getToken } = ctx;
  return {
    name: 'ListGithubTags',
    description:
      "List git tags for a repo session's repository (most recent 50). " +
      'When running inside a repo session, omit session_id to use its repo. From a global session or when triaging another session, pass session_id (from GetSession or SearchSessions).',
    schema: {
      session_id: z.number().int().optional().describe('Target repo session id'),
    },
    handler: async ({ session_id } = {}) => {
      const { session, error } = await resolveReadTargetSession(session_id);
      if (error) return fail(error);
      const localErr = await requireGitHubApiForSession(session);
      if (localErr) return localErr;
      try {
        const tags = await listRepoTags(await getToken(), session.repo_full_name);
        return ok({ tags });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
