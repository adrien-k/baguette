import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createPRReview } from '../../github.js';
import { ok, fail } from '../lib/result.js';

const execFileAsync = promisify(execFile);

export function createPrReviewTool(ctx) {
  const { getSession, getToken, withSessionHeader, absoluteWorktreePath } = ctx;
  return {
    name: 'PrReview',
    description:
      'Submit a pull request review decision. Pass inline comments via the `comments` array to have them posted as part of the review rather than as standalone comments.',
    schema: {
      event: z
        .enum(['approve', 'request-changes', 'comment'])
        .describe('Review decision: approve, request-changes, or comment'),
      body: z.string().describe('Review summary message'),
      comments: z
        .array(
          z.object({
            body: z.string().describe('Comment text (markdown supported)'),
            path: z.string().describe('File path relative to repo root'),
            line: z.coerce.number().int().describe('Line number in the file'),
            side: z
              .enum(['LEFT', 'RIGHT'])
              .optional()
              .describe(
                'Which side of the diff: RIGHT for added/context lines (default), LEFT for deleted lines.'
              ),
          })
        )
        .optional()
        .describe('Inline comments to include as part of the review'),
    },
    handler: async ({ event, body, comments = [] }) => {
      const eventMap = {
        approve: 'APPROVE',
        'request-changes': 'REQUEST_CHANGES',
        comment: 'COMMENT',
      };
      const session = await getSession();
      if (!session?.pr_number) return fail('No pull request associated with this session.');

      let commitId = null;
      if (comments.length > 0) {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
          cwd: absoluteWorktreePath,
        });
        commitId = stdout.trim();
      }

      const review = await createPRReview(
        await getToken(),
        session.repo_full_name,
        session.pr_number,
        eventMap[event],
        withSessionHeader(body, session),
        comments.map((c) => ({ ...c, body: withSessionHeader(c.body, session) })),
        commitId
      );
      return ok(review);
    },
  };
}
