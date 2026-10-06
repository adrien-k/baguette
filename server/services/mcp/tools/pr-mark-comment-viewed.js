import { z } from 'zod';
import { addReactionToComment } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createPrMarkCommentViewedTool(ctx) {
  const { getSession, getToken } = ctx;
  return {
    name: 'PrMarkCommentViewed',
    description:
      'Mark a PR comment as viewed by adding a 👀 eyes reaction on GitHub. Viewed comments are excluded from future PrComments results. Use the comment id from PrComments output.',
    schema: {
      commentId: z.number().int().describe('Comment ID from PrComments'),
      commentType: z
        .enum(['issue', 'review'])
        .describe('"issue" for conversation thread comments, "review" for inline review comments'),
    },
    handler: async ({ commentId, commentType }) => {
      const session = await getSession();
      if (!session?.pr_number) return fail('No pull request associated with this session.');
      const result = await addReactionToComment(
        await getToken(),
        session.repo_full_name,
        commentId,
        commentType
      );
      return ok({ reactionId: result.id, content: result.content });
    },
  };
}
