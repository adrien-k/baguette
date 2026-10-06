import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createPRComment, createPRLineComment } from '../../github.js';
import { ok, fail } from '../lib/result.js';

const execFileAsync = promisify(execFile);

export function createPrCommentTool(ctx) {
  const { getSession, getToken, withSessionHeader, absoluteWorktreePath } = ctx;
  return {
    name: 'PrComment',
    description:
      'Post a comment on the pull request. Omit path/line for a general PR comment; provide both to post an inline comment on a specific line.',
    schema: {
      body: z.string().describe('Comment text (markdown supported)'),
      path: z
        .string()
        .optional()
        .describe('File path for an inline comment (relative to repo root)'),
      line: z.coerce
        .number()
        .int()
        .optional()
        .describe('Line number in the file for an inline comment (integer)'),
      side: z
        .enum(['LEFT', 'RIGHT'])
        .optional()
        .describe(
          'Which side of the diff: RIGHT for added/context lines (new file), LEFT for deleted lines (old file). Defaults to RIGHT.'
        ),
    },
    handler: async ({ body, path: filePath, line, side }) => {
      const session = await getSession();
      if (!session?.pr_number) return fail('No pull request associated with this session.');
      const token = await getToken();
      const bodyWithHeader = withSessionHeader(body, session);
      if (filePath && line) {
        const { stdout: commitId } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
          cwd: absoluteWorktreePath,
        });
        const comment = await createPRLineComment(
          token,
          session.repo_full_name,
          session.pr_number,
          {
            body: bodyWithHeader,
            path: filePath,
            line,
            commitId: commitId.trim(),
            side,
          }
        );
        return ok(comment);
      }
      const comment = await createPRComment(
        token,
        session.repo_full_name,
        session.pr_number,
        bodyWithHeader
      );
      return ok(comment);
    },
  };
}
