import { Router } from 'express';
import { getGithubToken } from '../services/agent-settings.js';
import { githubFetch } from '../services/github-api.js';
import { listCursorModels, refreshCursorModels } from '../services/cursor-models.js';
import { decrypt } from '../lib/encrypt.js';
import { asyncHandler } from '../lib/app-error-handler.js';
import db from '../db.js';
import { buildClaudeEnvFromPlainUser, normalizeAnthropicBaseUrl } from '../services/session-env.js';
import { listClaudeModels } from '../services/claude-gateway-models.js';
import {
  loadFullSessionPromptTemplate,
  loadFullReviewPromptTemplate,
} from '../services/session-prompt.js';
import {
  getActiveAgents,
  getNavbarSystemInformation,
  getSystemInfo,
} from '../services/system-information.js';
import {
  stringifyAgentSessionDefaults,
  validateAgentSessionDefaults,
  withLastUsedFlag,
} from '../services/agent-session-defaults.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function userRowForAgentValidation(userRow) {
  if (!userRow) return null;
  return {
    id: userRow.id,
    anthropic_api_key: userRow.anthropic_api_key_encrypted
      ? decrypt(userRow.anthropic_api_key_encrypted)
      : null,
    anthropic_auth_token: userRow.anthropic_auth_token_encrypted
      ? decrypt(userRow.anthropic_auth_token_encrypted)
      : null,
    anthropic_base_url: userRow.anthropic_base_url ?? null,
    cursor_api_key: userRow.cursor_api_key_encrypted
      ? decrypt(userRow.cursor_api_key_encrypted)
      : null,
  };
}
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

/**
 * Claude models for the signed-in user (account level): the models exposed by the configured
 * gateway when a base URL is set, otherwise the SDK's built-in list. Throws on gateway
 * failure — callers decide how to surface the error.
 */
async function listClaudeModelsForRequest(req, { refresh = false } = {}) {
  const userRow = await db('users').where({ id: req.user.id }).first();
  const config = {
    apiKey: userRow?.anthropic_api_key_encrypted
      ? decrypt(userRow.anthropic_api_key_encrypted)
      : null,
    authToken: userRow?.anthropic_auth_token_encrypted
      ? decrypt(userRow.anthropic_auth_token_encrypted)
      : null,
    baseUrl: userRow?.anthropic_base_url ?? null,
  };
  return listClaudeModels(config, { refresh });
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
      const models = await listClaudeModelsForRequest(req);
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

  router.get(
    '/api/settings/agent-defaults',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userRow = await db('users').where({ id: req.user.id }).first();
      res.json(withLastUsedFlag(userRow?.agent_defaults));
    })
  );

  router.put(
    '/api/settings/agent-defaults',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userRow = await db('users').where({ id: req.user.id }).first();
      if (!userRow) return res.status(404).json({ error: 'User not found' });
      const userForValidation = userRowForAgentValidation(userRow);
      const validated = await validateAgentSessionDefaults(userForValidation, req.body ?? {});
      const stored = stringifyAgentSessionDefaults(validated);
      await db('users').where({ id: req.user.id }).update({ agent_defaults: stored });
      res.json(withLastUsedFlag(stored));
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
      const models = await listClaudeModelsForRequest(req, { refresh: true });
      res.json({ models });
    })
  );

  // --- Claude gateway connectivity test ---

  const CLAUDE_TEST_TIMEOUT_MS = 20_000;

  /**
   * Test the Claude credential / gateway config for a repo scope.
   * Body: { repo_id?: number, anthropic_api_key?: string, anthropic_auth_token?: string,
   *         anthropic_base_url?: string }
   * Unsent fields fall back to the effective (repo → account) saved config. Sent plaintext
   * secrets are used as-is; sent non-secrets are normalized like on save.
   *
   * Returns { ok, base_url, effective, checks: [{ id, label, ok, detail }] }.
   */
  router.post(
    '/api/settings/claude/test',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userRow = await db('users').where({ id: req.user.id }).first();
      if (!userRow) return res.status(404).json({ error: 'User not found' });

      const data = req.body ?? {};
      const userId = req.user.id;
      let repoRowData = null;
      if (data.repo_id != null && data.repo_id !== '') {
        repoRowData = await repoRow(data.repo_id, userId);
        if (!repoRowData) return res.status(400).json({ error: 'Repository not linked' });
      }

      /** Unsent field → effective saved config (repo overrides account); sent → as provided. */
      const pick = (override, saved) => (override !== undefined ? override : saved);

      const effective = {
        anthropic_api_key:
          pick(
            data.anthropic_api_key,
            decryptIfSet(repoRowData?.anthropic_api_key_encrypted) ||
              decryptIfSet(userRow.anthropic_api_key_encrypted)
          ) || null,
        anthropic_auth_token:
          pick(
            data.anthropic_auth_token,
            decryptIfSet(repoRowData?.anthropic_auth_token_encrypted) ||
              decryptIfSet(userRow.anthropic_auth_token_encrypted)
          ) || null,
        anthropic_base_url: normalizeAnthropicBaseUrl(
          pick(
            data.anthropic_base_url,
            firstNonEmpty(repoRowData?.anthropic_base_url, userRow.anthropic_base_url)
          )
        ),
      };

      const env = buildClaudeTestEnv(userRow, effective);
      const result = await runClaudeConnectivityTest(env, {
        baseUrl: effective.anthropic_base_url,
      });
      // Never echo secrets back — report only whether each is configured.
      const { anthropic_api_key, anthropic_auth_token, ...nonSecrets } = effective;
      result.effective = {
        ...nonSecrets,
        anthropic_api_key_configured: Boolean(anthropic_api_key),
        anthropic_auth_token_configured: Boolean(anthropic_auth_token),
      };
      res.json(result);
    })
  );

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function decryptIfSet(ciphertext) {
    return ciphertext ? decrypt(ciphertext) : null;
  }

  async function repoRow(repoId, userId) {
    if (repoId == null || repoId === '') return null;
    return db('user_repos').where({ user_id: userId, repo_id: repoId }).first();
  }

  /** Plaintext env for the test fetch, mirroring the session env cascade (host env fallbacks). */
  function buildClaudeTestEnv(userRow, effective) {
    return buildClaudeEnvFromPlainUser(
      { username: userRow.username, github_id: userRow.github_id },
      effective.anthropic_api_key,
      effective.anthropic_base_url,
      {
        anthropicAuthToken: effective.anthropic_auth_token,
      }
    );
  }

  /** Anthropic auth headers for a plaintext Claude env (Bearer for tokens, x-api-key for keys). */
  function claudeTestHeaders(env) {
    const headers = { 'anthropic-version': '2023-06-01' };
    if (env.ANTHROPIC_AUTH_TOKEN || env.CLAUDE_CODE_OAUTH_TOKEN) {
      headers.Authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN || env.CLAUDE_CODE_OAUTH_TOKEN}`;
    } else if (env.ANTHROPIC_API_KEY) {
      headers['x-api-key'] = env.ANTHROPIC_API_KEY;
    }
    return headers;
  }

  function timeoutCheck(timeoutMs) {
    return `Timed out after ${Math.round(timeoutMs / 1000)}s`;
  }

  /**
   * Two probes against the effective endpoint:
   * 1. GET /v1/models — connectivity + auth + the gateway's model list.
   * 2. POST /v1/messages (max_tokens: 1) — fallback for connectivity/auth when the endpoint
   *    does not implement /v1/models (404).
   */
  async function runClaudeConnectivityTest(env, { baseUrl } = {}) {
    const base = normalizeAnthropicBaseUrl(baseUrl) || 'https://api.anthropic.com';
    const checks = [];
    const modelIds = [];

    let modelsRes = null;
    let modelsParsed = null;
    try {
      modelsRes = await fetch(`${base}/v1/models?limit=100`, {
        method: 'GET',
        headers: claudeTestHeaders(env),
        signal: AbortSignal.timeout(CLAUDE_TEST_TIMEOUT_MS),
      });
      const text = await modelsRes.text();
      try {
        modelsParsed = JSON.parse(text);
      } catch {
        /* non-JSON response (proxy error page etc.) */
      }
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        return {
          ok: false,
          base_url: base,
          checks: [
            {
              id: 'connectivity',
              label: 'Connectivity',
              ok: false,
              detail: timeoutCheck(CLAUDE_TEST_TIMEOUT_MS),
            },
          ],
        };
      }
      modelsRes = null;
    }

    const modelsReached = Boolean(modelsRes);
    const modelsOk = Boolean(modelsRes?.ok);

    // When /v1/models is unavailable or rejected, the messages probe takes over for
    // connectivity and auth.
    const needMessagesProbe = !modelsReached || !modelsOk;
    const probeModel = 'claude-sonnet-4-5';
    let messagesRes = null;
    let messagesParsed = null;
    let messagesErrorDetail = null;
    if (needMessagesProbe) {
      try {
        messagesRes = await fetch(`${base}/v1/messages`, {
          method: 'POST',
          headers: claudeTestHeaders(env),
          body: JSON.stringify({
            model: probeModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(CLAUDE_TEST_TIMEOUT_MS),
        });
        const text = await messagesRes.text();
        try {
          messagesParsed = JSON.parse(text);
        } catch {
          /* non-JSON response */
        }
      } catch (err) {
        messagesErrorDetail =
          err?.name === 'TimeoutError' || err?.name === 'AbortError'
            ? timeoutCheck(CLAUDE_TEST_TIMEOUT_MS)
            : (err?.cause?.code ?? err?.message ?? 'Network error');
      }
    }

    const reached = modelsReached || Boolean(messagesRes);
    if (!reached) {
      return {
        ok: false,
        base_url: base,
        checks: [
          { id: 'connectivity', label: 'Connectivity', ok: false, detail: messagesErrorDetail },
        ],
      };
    }

    // Auth is judged from whichever probe succeeded: a 2xx /v1/models proves the credential,
    // otherwise the messages probe decides (its 404s are model errors, not auth errors).
    const authOk = modelsOk || Boolean(messagesRes?.ok);
    const authStatus = authOk ? null : (modelsRes ?? messagesRes);
    checks.push({
      id: 'connectivity',
      label: 'Connectivity',
      ok: true,
      detail: authOk ? undefined : `${authStatus.status} ${authStatus.statusText}`.trim(),
    });
    checks.push({
      id: 'auth',
      label: 'Authentication',
      ok: authOk,
      detail: !authOk
        ? (modelsParsed?.error?.message ?? messagesParsed?.error?.message ?? 'Unauthorized')
        : undefined,
    });

    if (modelsReached) {
      const list = Array.isArray(modelsParsed?.data) ? modelsParsed.data : [];
      for (const entry of list) {
        const id = entry?.id ?? entry?.name;
        if (typeof id === 'string' && id) modelIds.push(id);
      }
      const unsupported = !modelsOk && [404, 405, 501].includes(modelsRes.status);
      checks.push({
        id: 'models',
        label: 'Models endpoint',
        // Informational only — never gates the overall result (auth/connectivity already do).
        ok: unsupported ? null : modelsOk && modelIds.length > 0 ? true : modelsOk ? false : null,
        detail: !modelsOk
          ? `${modelsRes.status} ${modelsRes.statusText}`.trim()
          : modelIds.length === 0
            ? 'Gateway returned no models — model discovery may not be supported.'
            : `${modelIds.length} model${modelIds.length === 1 ? '' : 's'} listed`,
      });
    } else {
      checks.push({
        id: 'models',
        label: 'Models endpoint',
        ok: null,
        detail: 'Gateway does not expose /v1/models — checked /v1/messages instead',
      });
    }

    const required = checks.filter((c) => c.ok !== null);
    return { ok: required.every((c) => c.ok), base_url: base, models: modelIds, checks };
  }

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
    '/api/usage/active-agents',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getActiveAgents(req.user.id));
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
