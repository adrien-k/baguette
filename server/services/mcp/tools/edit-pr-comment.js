import { z } from 'zod';
import { editPRComment } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createEditPrCommentTool(ctx) {
  const { getSession, getToken, withSessionHeader } = ctx;
  return {
    name: 'EditPrComment',
    description:
      'Edit a comment previously posted by Baguette on the pull request (replaces its body). Only comments posted under your own GitHub account can be edited, never comments by other users. Use the comment id returned by PrComment or listed by PrComments.',
    schema: {
      commentId: z.number().int().describe('ID of the comment to edit'),
      commentType: z
        .enum(['issue', 'review'])
        .describe(
          '"issue" for conversation thread comments, "review" for inline review comments on the diff'
        ),
      body: z.string().describe('New comment text (markdown supported); replaces the old body'),
    },
    handler: async ({ commentId, commentType, body }) => {
      const session = await getSession();
      if (!session?.pr_number) return fail('No pull request associated with this session.');
      try {
        const comment = await editPRComment(
          await getToken(),
          session.repo_full_name,
          commentId,
          commentType,
          withSessionHeader(body, session)
        );
        return ok(comment);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
