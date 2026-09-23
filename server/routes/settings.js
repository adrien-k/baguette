import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { DOCKER_COMPOSE_PATH } from '../config.js';
import { getGithubToken } from '../services/agent-settings.js';
import { listModels, refreshModels } from '../services/anthropic-models.js';
import { listCursorModels, refreshCursorModels } from '../services/cursor-models.js';
import { decrypt } from '../lib/encrypt.js';
import db from '../db.js';

const execFileAsync = promisify(execFile);

const COST_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

// Usage rows for the signed-in user over the reported window, optionally narrowed
// by repository (`?repo=owner/name`) and/or agent SDK (`?sdk=claude|cursor`).
function usageQuery(userId, { repo = null, sdk = null } = {}) {
  const since = new Date(Date.now() - COST_HISTORY_MS).toISOString();
  const q = db('usage').where({ user_id: userId }).where('created_at', '>=', since);
  if (repo) q.where({ repo_full_name: repo });
  if (sdk) q.where({ agent_sdk: sdk });
  return q;
}

export default function createSettingsRoutes(requireAuth) {
  const router = Router();

  router.get('/api/settings/models', requireAuth, async (req, res) => {
    try {
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/settings/models/refresh', requireAuth, async (req, res) => {
    try {
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Usage ---

  // One row per (day, repo, sdk) over the last 30 days, so usage graphs can break token
  // usage down by repo or agent without a second round trip.
  router.get('/api/usage/breakdown', requireAuth, async (req, res) => {
    try {
      const rows = await usageQuery(req.user.id, {
        repo: req.query.repo || null,
        sdk: req.query.sdk || null,
      })
        .select(db.raw('date(created_at) as day'), 'repo_full_name', 'agent_sdk')
        .sum('cost_usd as cost_usd')
        .sum('input_tokens as input_tokens')
        .sum('output_tokens as output_tokens')
        .sum('cache_read_tokens as cache_read_tokens')
        .sum('cache_write_tokens as cache_write_tokens')
        .sum('total_tokens as total_tokens')
        .groupBy('day', 'repo_full_name', 'agent_sdk')
        .orderBy('day', 'asc');

      res.json(
        rows.map((r) => ({
          day: r.day,
          repo_full_name: r.repo_full_name,
          agent_sdk: r.agent_sdk || 'claude',
          cost_usd: parseFloat(r.cost_usd),
          input_tokens: Number(r.input_tokens ?? 0),
          output_tokens: Number(r.output_tokens ?? 0),
          cache_read_tokens: Number(r.cache_read_tokens ?? 0),
          cache_write_tokens: Number(r.cache_write_tokens ?? 0),
          total_tokens: Number(r.total_tokens ?? 0),
        }))
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Docker Compose ---

  router.get('/api/settings/docker-compose', requireAuth, async (req, res) => {
    try {
      const content = await fs.promises.readFile(DOCKER_COMPOSE_PATH, 'utf8').catch((err) => {
        if (err.code === 'ENOENT') return '';
        throw err;
      });
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/settings/docker-compose/services', requireAuth, async (req, res) => {
    try {
      let content;
      try {
        content = await fs.promises.readFile(DOCKER_COMPOSE_PATH, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return res.json({ services: [] });
        throw err;
      }
      const parsed = yaml.load(content);
      const services =
        parsed && typeof parsed.services === 'object' && parsed.services !== null
          ? Object.keys(parsed.services)
          : [];
      res.json({ services });
    } catch (err) {
      // Graceful failure for missing file or invalid YAML
      res.json({ services: [], error: err.message });
    }
  });

  router.put('/api/settings/docker-compose', requireAuth, async (req, res) => {
    try {
      const { content } = req.body;
      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'content must be a string' });
      }
      await fs.promises.mkdir(path.dirname(DOCKER_COMPOSE_PATH), { recursive: true });
      await fs.promises.writeFile(DOCKER_COMPOSE_PATH, content, 'utf8');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/settings/docker-compose/containers', requireAuth, async (req, res) => {
    try {
      try {
        await fs.promises.access(DOCKER_COMPOSE_PATH);
      } catch {
        return res.json({ containers: [] });
      }
      const { stdout } = await execFileAsync(
        'docker',
        ['compose', '-f', DOCKER_COMPOSE_PATH, 'ps', '--format', 'json', '-a'],
        { timeout: 15000 }
      );
      const containers = stdout.trim()
        ? stdout
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [];
      res.json({ containers });
    } catch (err) {
      res.json({ containers: [], error: err.message });
    }
  });

  router.post(
    '/api/settings/docker-compose/containers/:name/:action',
    requireAuth,
    async (req, res) => {
      const { name, action } = req.params;
      const allowed = ['start', 'stop', 'restart', 'up', 'down'];
      if (!allowed.includes(action)) {
        return res.status(400).json({ error: `Invalid action: ${action}` });
      }
      try {
        try {
          await fs.promises.access(DOCKER_COMPOSE_PATH);
        } catch {
          return res.status(400).json({ error: 'No docker-compose.yml configured' });
        }
        const args = ['compose', '-f', DOCKER_COMPOSE_PATH, action];
        if (action === 'up') args.push('-d');
        args.push(name);
        await execFileAsync('docker', args, { timeout: 60000 });
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.stderr || err.message });
      }
    }
  );

  /**
   * GET /api/repos/:repoFullName/prs
   * Lists open pull requests for a repository (for the reviewer session form).
   */
  router.get('/api/repos/:repoFullName/prs', requireAuth, async (req, res) => {
    try {
      const token = getGithubToken(req.user);
      if (!token) {
        return res.status(401).json({ error: 'No GitHub token configured' });
      }
      const repoFullName = req.params.repoFullName;
      const ghRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/pulls?state=open&per_page=50&sort=updated`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'baguette-app',
          },
        }
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
