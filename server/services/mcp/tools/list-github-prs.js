import { z } from 'zod';
import { listRepoPRs } from '../../github.js';
import { ok, fail } from '../lib/result.js';

export function createListGithubPrsTool(ctx) {
  const { getRepo, getToken, requireGitHubRepo } = ctx;
  return {
    name: 'ListGithubPrs',
    description:
      'List pull requests for the current repo with optional filters. When author, label, or text is provided, uses the GitHub Search API. Otherwise uses the Pulls API.',
    schema: {
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
    handler: async ({ state = 'open', author, label, base, text } = {}) => {
      const localErr = await requireGitHubRepo();
      if (localErr) return localErr;
      const repo = await getRepo();
      if (!repo?.full_name) return fail('No repo linked to this session.');
      try {
        const prs = await listRepoPRs(await getToken(), repo.full_name, {
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
