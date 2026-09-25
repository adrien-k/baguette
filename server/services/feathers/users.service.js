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
import { DEFAULT_PAGINATE } from '../../config.js';

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
  anthropic_api_key: 'anthropic_api_key_encrypted',
  cursor_api_key: 'cursor_api_key_encrypted',
  mcp_api_token: 'mcp_api_token_encrypted',
});

const decryptUserSecrets = decryptFields({
  access_token: 'access_token_encrypted',
  anthropic_api_key: 'anthropic_api_key_encrypted',
  cursor_api_key: 'cursor_api_key_encrypted',
  mcp_api_token: 'mcp_api_token_encrypted',
});

function restrictPatchToSelf(context) {
  if (!context.params.provider) return context; // internal calls are trusted
  if (String(context.params.user?.id) !== String(context.id)) {
    throw new NotAuthenticated('Can only patch own user');
  }
  return context;
}

export const usersHooks = {
  before: {
    all: [requireUser],
    find: [orderByCreatedAt],
    create: [normalizeColorSchemePatch, normalizeCursorModelPrefsPatch, encryptUserSecrets],
    patch: [
      restrictPatchToSelf,
      normalizeColorSchemePatch,
      normalizeCursorModelPrefsPatch,
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
    ],
  });
  app.service(path).hooks(usersHooks);
}
