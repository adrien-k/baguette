import { z } from 'zod';
import { getPRComments } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createPrCommentsTool(ctx) {
  const { resolveReadTargetSession, requireGitHubApiForSession, getToken } = ctx;
  return {
    name: 'PrComments',
    description:
      'List PR conversation comments and inline review comments on the diff for a repo session. ' +
      'Conversation feedback is in issueComments (commentType "issue" or "review_body"); inline code comments are in reviewComments (commentType "review"). Check warnings if conversation comments are missing. ' +
      'When running inside a repo session, omit session_id to read its PR. ' +
      'From a global session or when triaging another session, pass session_id (from GetSession or SearchSessions).',
    schema: {
      session_id: z.number().int().optional().describe('Target repo session id'),
    },
    handler: async ({ session_id } = {}) => {
      const { session, error } = await resolveReadTargetSession(session_id);
      if (error) return fail(error);
      const localErr = await requireGitHubApiForSession(session);
      if (localErr) return localErr;
      if (!session?.pr_number) {
        return fail('No pull request associated with this session');
      }
      const result = await getPRComments(
        await getToken(),
        session.repo_full_name,
        session.pr_number
      );
      return ok(result);
    },
  };
}
