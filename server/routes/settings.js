import { Router } from 'express';
import { getGithubToken } from '../services/agent-settings.js';
import { githubFetch } from '../services/github-api.js';
import { asyncHandler } from '../lib/app-error-handler.js';
import {
  loadFullSessionPromptTemplate,
  loadFullSubagentPromptTemplate,
  loadFullReviewPromptTemplate,
} from '../services/session-prompt.js';
import { getNavbarSystemInformation, getSystemInfo } from '../services/system-information.js';

export default function createSettingsRoutes(requireAuth) {
  const router = Router();

  router.get(
    '/api/settings/prompt-templates',
    requireAuth,
    asyncHandler(async (_req, res) => {
      const [session, subagent, review] = await Promise.all([
        loadFullSessionPromptTemplate(),
        loadFullSubagentPromptTemplate(),
        loadFullReviewPromptTemplate(),
      ]);
      res.json({ session, subagent, review });
    })
  );

  router.get(
    '/api/settings/system-information',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getNavbarSystemInformation(req.user.id));
    })
  );

  router.get(
    '/api/settings/system',
    requireAuth,
    asyncHandler(async (_req, res) => {
      res.json(getSystemInfo());
    })
  );

  /**
   * GET /api/repos/:repoFullName/prs
   * Lists open pull requests for a repository (for the reviewer session form).
   */
  router.get(
    '/api/repos/:repoFullName/prs',
    requireAuth,
    asyncHandler(async (req, res) => {
      const token = getGithubToken(req.user);
      if (!token) {
        return res.status(401).json({ error: 'No GitHub token configured' });
      }
      const repoFullName = req.params.repoFullName;
      const ghRes = await githubFetch(
        `https://api.github.com/repos/${repoFullName}/pulls?state=open&per_page=50&sort=updated`,
        { token }
      );
      if (!ghRes.ok) {
        const text = await ghRes.text().catch(() => '');
        return res.status(ghRes.status).json({ error: `GitHub API error: ${text}` });
      }
      const prs = await ghRes.json();
      res.json(
        prs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          user: pr.user?.login,
          head: pr.head.ref,
          base: pr.base.ref,
          updated_at: pr.updated_at,
          html_url: pr.html_url,
        }))
      );
    })
  );

  return router;
}
