import { getPRComments } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createPrCommentsTool(ctx) {
  const { getSession, getToken } = ctx;
  return {
    name: 'PrComments',
    description: 'List PR conversation comments and inline review comments on the diff.',
    schema: {},
    handler: async () => {
      const session = await getSession();
      if (!session?.pr_number) {
        return fail(
          'No pull request associated with this session. Create one first with PrUpsert.'
        );
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
