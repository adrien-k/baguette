import crypto from 'crypto';
import { KnexService } from '@feathersjs/knex';
import { NotAuthenticated } from '@feathersjs/errors';
import { requireUser, encryptFields, decryptFields } from './hooks.js';
import { encrypt } from '../../lib/encrypt.js';
import { MCP_HTTP_ENDPOINT } from '../../config.js';
import {
  mergeCursorModelPrefs,
  parseCursorModelPrefsJson,
  stringifyCursorModelPrefs,
} from '../../services/agent-preferences.js';
import { resolveDefaultAgent, withLastUsedFlag } from '../../services/agent-session-defaults.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { cacheScopeForUser, clearUserReposPickerCache } from '../github.js';
import { normalizeAnthropicBaseUrl } from '../session-env.js';
import { validatePiApiKeyEnvVarPatch } from './validate-pi-patch.js';

/**
 * Users service (table: users). Admin-only. Supports listing, getting,
 * and custom approve/reject methods.
 */
class UsersService extends KnexService {
  async approve(id, _params) {
    const db = this.options.Model;
    await db('users').where({ id }).update({ approved: true });
    return db('users').where({ id }).first();
  }

  async reject(id, _params) {
    const db = this.options.Model;
    const user = await db('users').where({ id }).first();
    if (!user) throw new Error('User not found');
    await db('users').where({ id }).update({ approved: false });
    return db('users').where({ id }).first();
  }

  /** Generate a new MCP API token (plaintext returned once). Replaces any previous token. */
  async generateMcpToken(_data, params) {
    assertSelfOnly(params);
    const token = `bgmcp_${crypto.randomBytes(32).toString('base64url')}`;
    const db = this.options.Model;
    await db('users')
      .where({ id: params.user.id })
      .update({ mcp_api_token_encrypted: encrypt(token) });
    return {
      token,
      endpoint: MCP_HTTP_ENDPOINT,
      message:
        'Copy this token now — it will not be shown again. Use Authorization: Bearer <token> when connecting external MCP clients.',
    };
  }

  /** Remove the MCP API token (external access disabled until regenerated). */
  async revokeMcpToken(_data, params) {
    assertSelfOnly(params);
    const db = this.options.Model;
    await db('users').where({ id: params.user.id }).update({ mcp_api_token_encrypted: null });
    return { ok: true };
  }

  /**
   * Effective default agent for new sessions: stored defaults when the user pinned an SDK,
   * otherwise the agent of their most recent session. Account-wide, not repo-scoped.
   */
  async defaultAgent(_data, params) {
    const db = this.options.Model;
    if (!params.user?.id) throw new NotAuthenticated('Not authenticated');
    return resolveDefaultAgent(db, params.user.id);
  }
}

function assertSelfOnly(params) {
  if (!params.user?.id) throw new NotAuthenticated('Not authenticated');
}

async function orderByCreatedAt(context) {
  const query = context.service.createQuery(context.params);
  context.params.knex = query.orderBy('created_at', 'desc');
  return context;
}

async function normalizeColorSchemePatch(context) {
  if (context.data.color_scheme === undefined) return context;
  context.data.color_scheme = context.data.color_scheme === 'light' ? 'light' : 'dark';
  return context;
}

/** Normalize the Claude base URL on user patches. */
async function normalizeAnthropicBaseUrlPatch(context) {
  if (context.data.anthropic_base_url === undefined) return context;
  context.data.anthropic_base_url = normalizeAnthropicBaseUrl(context.data.anthropic_base_url);
  return context;
}

async function normalizeClaudeFieldsPatch(context) {
  if (context.data.claude_gateway_model_discovery !== undefined) {
    delete context.data.claude_gateway_model_discovery;
  }
  if (context.data.claude_default_model !== undefined) {
    delete context.data.claude_default_model;
  }
  return context;
}

async function normalizeCursorModelPrefsPatch(context) {
  if (context.data.agent_preferences === undefined) return context;

  const existing = await context.service.get(context.id, {
    ...context.params,
    provider: undefined,
  });
  const merged = mergeCursorModelPrefs(existing.agent_preferences, context.data.agent_preferences);
  context.data.agent_preferences = stringifyCursorModelPrefs(merged);
  return context;
}

function formatUserExternal(context) {
  if (!context.params.provider) return context;
  const process = (user) => {
    // access_token is always hidden from external callers (even masked)
    delete user.access_token;
    user.mcp_token_configured = Boolean(user.mcp_api_token);
    user.mcp_endpoint = MCP_HTTP_ENDPOINT;
    user.agent_preferences = parseCursorModelPrefsJson(user.agent_preferences);
    user.agent_defaults = withLastUsedFlag(user.agent_defaults);
    return user;
  };
  if (Array.isArray(context.result)) {
    context.result = context.result.map(process);
  } else if (context.result?.data) {
    context.result.data = context.result.data.map(process);
  } else if (context.result) {
    context.result = process(context.result);
  }
  return context;
}

const encryptUserSecrets = encryptFields({
  access_token: 'access_token_encrypted',
  github_token: 'github_token_encrypted',
  anthropic_api_key: 'anthropic_api_key_encrypted',
  anthropic_auth_token: 'anthropic_auth_token_encrypted',
  cursor_api_key: 'cursor_api_key_encrypted',
  pi_api_key: 'pi_api_key_encrypted',
  mcp_api_token: 'mcp_api_token_encrypted',
});

const decryptUserSecrets = decryptFields({
  access_token: 'access_token_encrypted',
  github_token: 'github_token_encrypted',
  anthropic_api_key: 'anthropic_api_key_encrypted',
  anthropic_auth_token: 'anthropic_auth_token_encrypted',
  cursor_api_key: 'cursor_api_key_encrypted',
  pi_api_key: 'pi_api_key_encrypted',
  mcp_api_token: 'mcp_api_token_encrypted',
});

function restrictPatchToSelf(context) {
  if (!context.params.provider) return context; // internal calls are trusted
  if (String(context.params.user?.id) !== String(context.id)) {
    throw new NotAuthenticated('Can only patch own user');
  }
  return context;
}

async function clearGithubPickerCacheOnTokenPatch(context) {
  if (context.data?.github_token === undefined) return context;
  clearUserReposPickerCache(cacheScopeForUser({ id: context.id }));
  return context;
}

export const usersHooks = {
  before: {
    all: [requireUser],
    find: [orderByCreatedAt],
    create: [
      normalizeColorSchemePatch,
      normalizeAnthropicBaseUrlPatch,
      normalizeClaudeFieldsPatch,
      normalizeCursorModelPrefsPatch,
      validatePiApiKeyEnvVarPatch,
      encryptUserSecrets,
    ],
    patch: [
      restrictPatchToSelf,
      normalizeColorSchemePatch,
      normalizeAnthropicBaseUrlPatch,
      normalizeClaudeFieldsPatch,
      normalizeCursorModelPrefsPatch,
      validatePiApiKeyEnvVarPatch,
      clearGithubPickerCacheOnTokenPatch,
      encryptUserSecrets,
    ],
  },
  after: {
    find: [decryptUserSecrets, formatUserExternal],
    get: [decryptUserSecrets, formatUserExternal],
    create: [decryptUserSecrets, formatUserExternal],
    patch: [decryptUserSecrets, formatUserExternal],
  },
};

export function registerUsersService(app, path = 'users') {
  const options = {
    Model: app.get('db'),
    name: 'users',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new UsersService(options), {
    events: ['github:bad-credentials'],
    methods: [
      'find',
      'get',
      'create',
      'patch',
      'remove',
      'approve',
      'reject',
      'generateMcpToken',
      'revokeMcpToken',
      'defaultAgent',
    ],
  });
  app.service(path).hooks(usersHooks);
}
