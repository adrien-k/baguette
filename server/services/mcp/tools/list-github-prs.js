import { z } from 'zod';
import { listRepoPRs } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createListGithubPrsTool(ctx) {
  const { resolveReadTargetSession, requireGitHubApiForSession, getToken } = ctx;
  return {
    name: 'ListGithubPrs',
    description:
      "List pull requests for a repo session's repository with optional filters. When author, label, or text is provided, uses the GitHub Search API. Otherwise uses the Pulls API. " +
      'When running inside a repo session, omit session_id to use its repo. From a global session or when triaging another session, pass session_id (from GetSession or SearchSessions).',
    schema: {
      session_id: z.number().int().optional().describe('Target repo session id'),
      state: z
        .enum(['open', 'closed', 'all'])
        .optional()
        .describe('PR state filter (default: open)'),
      author: z.string().optional().describe('Filter by GitHub username (author of the PR)'),
      label: z.string().optional().describe('Filter by label name'),
      base: z
        .string()
        .optional()
        .describe('Filter by base branch (only used when author/label/text are not set)'),
      text: z.string().optional().describe('Full-text search query'),
    },
    handler: async ({ session_id, state = 'open', author, label, base, text } = {}) => {
      const { session, error } = await resolveReadTargetSession(session_id);
      if (error) return fail(error);
      const localErr = await requireGitHubApiForSession(session);
      if (localErr) return localErr;
      try {
        const prs = await listRepoPRs(await getToken(), session.repo_full_name, {
          state,
          author,
          label,
          base,
          text,
        });
        return ok({ prs });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}
