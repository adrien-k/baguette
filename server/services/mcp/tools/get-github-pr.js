import { z } from 'zod';
import { getOpenPRByNumber } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createGetGithubPrTool(ctx) {
  const { resolveReadTargetSession, requireGitHubApiForSession, getToken } = ctx;
  return {
    name: 'GetGithubPr',
    description:
      'Get full details for a single pull request by number, including head/base branch names, body, labels, draft status, and timestamps. ' +
      'When running inside a repo session, omit session_id to use its repo. From a global session or when triaging another session, pass session_id (from GetSession or SearchSessions).',
    schema: {
      session_id: z.number().int().optional().describe('Target repo session id'),
      pr_number: z.number().int().describe('Pull request number'),
    },
    handler: async ({ session_id, pr_number } = {}) => {
      const { session, error } = await resolveReadTargetSession(session_id);
      if (error) return fail(error);
      const localErr = await requireGitHubApiForSession(session);
      if (localErr) return localErr;
      try {
        const pr = await getOpenPRByNumber(await getToken(), session.repo_full_name, pr_number);
        return ok({ pr });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
