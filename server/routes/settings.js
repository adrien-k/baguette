import { Router } from 'express';
import { getGithubToken } from '../services/agent-settings.js';
import { githubFetch } from '../services/github-api.js';
import { listModels, refreshModels } from '../services/anthropic-models.js';
import { listCursorModels, refreshCursorModels } from '../services/cursor-models.js';
import { decrypt } from '../lib/encrypt.js';
import { asyncHandler } from '../lib/app-error-handler.js';
import db from '../db.js';
import {
  loadFullSessionPromptTemplate,
  loadFullReviewPromptTemplate,
} from '../services/session-prompt.js';
import { getLiveMetrics } from '../services/live-metrics.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_USAGE_DAYS = 30;

function parseUsageDays(value) {
  const n = Number(value);
  return n === 7 || n === 30 || n === 90 ? n : DEFAULT_USAGE_DAYS;
}

// Usage rows for the signed-in user over the reported window, optionally narrowed
// by repository (`?repo=owner/name` or `__global__`), agent SDK, and activity kind.
function usageQuery(
  userId,
  { repo = null, sdk = null, kind = null, days = DEFAULT_USAGE_DAYS } = {}
) {
  const since = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  const q = db('usage').where({ user_id: userId }).where('created_at', '>=', since);
  if (repo === '__global__') q.where({ repo_full_name: '' });
  else if (repo) q.where({ repo_full_name: repo });
  if (sdk) q.where({ agent_sdk: sdk });
  if (kind === 'review') q.where({ kind: 'review' });
  else if (kind === 'session') {
    q.where((b) => b.whereNull('kind').orWhere('kind', '<>', 'review'));
  }
  return q;
}

export default function createSettingsRoutes(requireAuth) {
  const router = Router();

  router.get(
    '/api/settings/models',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (req.query.sdk === 'cursor') {
        const userRow = await db('users').where({ id: req.user.id }).first();
        const apiKey = userRow?.cursor_api_key_encrypted
          ? decrypt(userRow.cursor_api_key_encrypted)
          : null;
        const models = await listCursorModels(apiKey);
        return res.json({ models });
      }
      const models = await listModels();
      res.json({ models });
    })
  );

  router.get(
    '/api/settings/prompt-templates',
    requireAuth,
    asyncHandler(async (_req, res) => {
      const [session, review] = await Promise.all([
        loadFullSessionPromptTemplate(),
        loadFullReviewPromptTemplate(),
      ]);
      res.json({ session, review });
    })
  );

  router.post(
    '/api/settings/models/refresh',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (req.query.sdk === 'cursor') {
        const userRow = await db('users').where({ id: req.user.id }).first();
        const apiKey = userRow?.cursor_api_key_encrypted
          ? decrypt(userRow.cursor_api_key_encrypted)
          : null;
        const models = await refreshCursorModels(apiKey);
        return res.json({ models });
      }
      const models = await refreshModels();
      res.json({ models });
    })
  );

  // --- Usage ---

  // One row per (day, repo, sdk, kind, model) over the requested window, so the usage
  // page can stack a timeline and collapse a table without a second round trip.
  router.get(
    '/api/usage/breakdown',
    requireAuth,
    asyncHandler(async (req, res) => {
      const days = parseUsageDays(req.query.days);
      const rows = await usageQuery(req.user.id, {
        repo: req.query.repo || null,
        sdk: req.query.sdk || null,
        kind: req.query.kind || null,
        days,
      })
        .select(
          db.raw('date(created_at) as day'),
          'repo_full_name',
          'agent_sdk',
          db.raw("CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END as usage_kind"),
          'model'
        )
        .sum('cost_usd as cost_usd')
        .sum('input_tokens as input_tokens')
        .sum('output_tokens as output_tokens')
        .sum('cache_read_tokens as cache_read_tokens')
        .sum('cache_write_tokens as cache_write_tokens')
        .sum('total_tokens as total_tokens')
        .groupByRaw(
          "date(created_at), repo_full_name, agent_sdk, CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END, model"
        )
        .orderBy('day', 'asc');

      res.json(
        rows.map((r) => ({
          day: r.day,
          repo_full_name: r.repo_full_name,
          agent_sdk: r.agent_sdk || 'claude',
          kind: r.usage_kind === 'review' ? 'review' : 'session',
          model: r.model || '',
          cost_usd: parseFloat(r.cost_usd),
          input_tokens: Number(r.input_tokens ?? 0),
          output_tokens: Number(r.output_tokens ?? 0),
          cache_read_tokens: Number(r.cache_read_tokens ?? 0),
          cache_write_tokens: Number(r.cache_write_tokens ?? 0),
          total_tokens: Number(r.total_tokens ?? 0),
        }))
      );
    })
  );

  router.get(
    '/api/settings/live-metrics',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getLiveMetrics(req.user.id));
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
