import crypto from 'crypto';
import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden, NotAuthenticated, NotFound } from 'feathers/errors';
import { requireUser, requireAdmin, encryptFields, decryptFields } from './hooks.js';
import { encrypt } from '../../lib/encrypt.js';
import { MCP_HTTP_ENDPOINT } from '../../config.js';
import { getGithubAppConfig } from '../../lib/instance-settings.js';
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
  inviteUrlForToken,
} from '../../lib/user-invite.js';
import {
  mergeCursorModelPrefs,
  parseCursorModelPrefsJson,
  stringifyCursorModelPrefs,
} from '../../services/agent-preferences.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { cacheScopeForUser, clearUserReposPickerCache } from '../github.js';
import { parseAgentDefaultModelJson } from '../../../shared/agent-default-model.js';
import { normalizeUserAgentDefaultsPatch } from '../../services/user-agent-defaults.js';
import {
  buildPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  buildPasskeyChallengeSetCookie,
  buildPasskeyChallengeClearCookie,
  challengeCookieHeaderFromParams,
  countPasskeysForUser,
} from '../../lib/webauthn.js';
import {
  USER_STATUS_APPROVED,
  USER_STATUS_PENDING,
  USER_STATUS_REVOKED,
  USER_STATUS_VALUES,
  isApprovedUser,
  resolveUserStatus,
} from '../../../shared/user-status.js';

/**
 * Users service (table: users). Admin-only. Supports listing, getting,
 * and custom approve/reject methods.
 */
class UsersService extends KnexService {
  setup(app) {
    this.app = app;
  }

  async approve(id, _params) {
    const db = this.options.Model;
    await db('users').where({ id }).update({ status: USER_STATUS_APPROVED });
    return db('users').where({ id }).first();
  }

  async reject(id, _params) {
    const db = this.options.Model;
    const user = await db('users').where({ id }).first();
    if (!user) throw new Error('User not found');
    if (!!user.admin && (await countAdmins(db)) <= 1) {
      throw new Forbidden('Cannot revoke the last admin');
    }
    await db('users').where({ id }).update({ status: USER_STATUS_REVOKED });
    return db('users').where({ id }).first();
  }

  /**
   * Promote or demote an admin.
   *
   * Feathers custom methods are `(data, params)` on both REST and the service.
   * The REST client sends the first argument as the JSON body (`POST /users`
   * with `X-Service-Method: setAdmin`), so the working client call is:
   *
   *   usersService.setAdmin({ id, admin: true })
   *
   * Internal/tests may also pass the target id on `params.route.id`
   * (`setAdmin({ admin: true }, { route: { id }, user, provider })`).
   * `setAdmin(id, { admin })` is not used: the REST client would treat
   * `{ admin }` as params, not the body, and drop the flag.
   */
  async setAdmin(data, params) {
    const id = setAdminTargetId(data, params);
    if (id == null) throw new BadRequest('User id is required');
    const db = this.options.Model;
    const user = await db('users').where({ id }).first();
    if (!user) throw new NotFound('User not found');
    const admin = !!(data && typeof data === 'object' && data.admin);
    if (!admin && !!user.admin && (await countAdmins(db)) <= 1) {
      throw new Forbidden('Cannot demote the last admin');
    }
    await db('users')
      .where({ id })
      .update({ admin: admin ? 1 : 0 });
    return db('users').where({ id }).first();
  }

  /**
   * Create or regenerate a one-time invite (plaintext URL returned once).
   * Only when the GitHub App is not configured. Feathers REST body:
   *   usersService.invite({ username }) or usersService.invite({ id })
   */
  async invite(data, _params) {
    const db = this.options.Model;
    const github = await getGithubAppConfig(db);
    if (github.configured) {
      throw new BadRequest('Invites are only available when GitHub sign-in is not configured');
    }

    const id =
      data && typeof data === 'object' && data.id != null && data.id !== ''
        ? Number(data.id)
        : null;
    const username =
      data && typeof data === 'object' && typeof data.username === 'string'
        ? data.username.trim()
        : '';

    if (id == null && !username) {
      throw new BadRequest('Username is required');
    }
    if (username.length > 64) {
      throw new BadRequest('Username is too long');
    }

    let user;
    if (id != null) {
      if (!Number.isFinite(id)) throw new BadRequest('User id is required');
      user = await db('users').where({ id }).first();
      if (!user) throw new NotFound('User not found');
    } else {
      user = await db('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
    }

    if (user) {
      if (user.github_id != null) {
        throw new BadRequest('That user already signs in with GitHub');
      }
      const passkeyCount = await countPasskeysForUser(db, user.id);
      if (passkeyCount > 0) {
        throw new BadRequest('That user already has a passkey');
      }
      if (!user.invite_token_hash && id == null) {
        throw new BadRequest('Username is already taken');
      }
    }

    const token = generateInviteToken();
    const invite_token_hash = hashInviteToken(token);
    const invite_expires_at = inviteExpiresAt();

    if (user) {
      await db('users').where({ id: user.id }).update({ invite_token_hash, invite_expires_at });
    } else {
      const [newId] = await db('users').insert({
        github_id: null,
        username,
        status: USER_STATUS_APPROVED,
        admin: 0,
        onboarding_completed: false,
        invite_token_hash,
        invite_expires_at,
      });
      user = await db('users').where({ id: newId }).first();
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        approved: true,
        admin: !!user.admin,
        invite_pending: true,
      },
      invite_url: inviteUrlForToken(token),
      expires_at: invite_expires_at,
      message: 'Copy this invite link now — it will not be shown again.',
    };
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

  async passkeyRegisterOptions(data, params) {
    assertSelfOnly(params);
    const db = this.options.Model;
    return buildPasskeyRegistrationOptions(db, params.user, data);
  }

  async passkeyRegisterVerify(data, params) {
    assertSelfOnly(params);
    const db = this.options.Model;
    const cookieHeader = challengeCookieHeaderFromParams(params);
    await verifyPasskeyRegistration(db, params.user, data, cookieHeader);

    if (typeof data?.username === 'string') {
      const username = data.username.trim();
      if (username) {
        await db('users').where({ id: params.user.id }).update({ username });
      }
    }

    const passkey_count = await countPasskeysForUser(db, params.user.id);
    return { ok: true, passkey_count };
  }

  async passkeyList(_data, params) {
    assertSelfOnly(params);
    const db = this.options.Model;
    const rows = await db('user_passkeys')
      .where({ user_id: params.user.id })
      .orderBy('created_at', 'desc');
    return rows.map((row) => ({
      id: row.id,
      device_type: row.device_type,
      created_at: row.created_at,
      backed_up: !!row.backed_up,
    }));
  }

  async passkeyRemove(data, params) {
    assertSelfOnly(params);
    const db = this.options.Model;
    let query = db('user_passkeys').where({ user_id: params.user.id });
    if (data?.credential_id != null && data.credential_id !== '') {
      query = query.andWhere({ credential_id: String(data.credential_id) });
    } else if (data?.id != null && data.id !== '') {
      query = query.andWhere({ id: Number(data.id) });
    } else {
      throw new BadRequest('credential_id is required');
    }
    const removed = await query.delete();
    if (!removed) throw new NotFound('Passkey not found');
    return { ok: true };
  }
}

function assertSelfOnly(params) {
  if (!params.user?.id) throw new NotAuthenticated('Not authenticated');
}

async function countAdmins(db) {
  const row = await db('users').where({ admin: 1 }).count('* as cnt').first();
  return Number(row?.cnt ?? 0);
}

async function preventRemoveLastAdmin(context) {
  const db = context.service.options.Model;
  const user = await db('users').where({ id: context.id }).first();
  if (user && !!user.admin && (await countAdmins(db)) <= 1) {
    throw new Forbidden('Cannot delete the last admin');
  }
  return context;
}

function setAdminTargetId(data, params) {
  if (data != null && typeof data === 'object' && data.id != null && data.id !== '') {
    return data.id;
  }
  if (params?.route?.id != null && params.route.id !== '') {
    return params.route.id;
  }
  if (params?.id != null && params.id !== '') {
    return params.id;
  }
  if (data != null && typeof data !== 'object') {
    return data;
  }
  return null;
}

function restrictGetToSelfOrAdmin(context) {
  if (!context.params.provider) return context;
  if (context.params.user?.admin) return context;
  if (String(context.params.user?.id) !== String(context.id)) {
    throw new Forbidden('Not allowed');
  }
  return context;
}

async function stripPrivilegedFieldsFromExternalPatch(context) {
  if (!context.params?.provider) return context;
  delete context.data.admin;
  delete context.data.github_id;
  delete context.data.approved;
  return context;
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

function normalizeUserStatusWrite(context) {
  if (!context.data || typeof context.data !== 'object') return context;
  // Status changes go through approve/reject, never patch.
  if (context.method === 'patch') {
    delete context.data.status;
    delete context.data.approved;
    delete context.data.revoked;
    return context;
  }
  if (context.data.status != null) {
    if (!USER_STATUS_VALUES.includes(context.data.status)) {
      throw new BadRequest(
        `Invalid user status "${context.data.status}". Must be one of: ${USER_STATUS_VALUES.join(', ')}`
      );
    }
    delete context.data.approved;
    delete context.data.revoked;
    return context;
  }
  if (context.data.revoked) context.data.status = USER_STATUS_REVOKED;
  else if (context.data.approved !== undefined) {
    context.data.status = context.data.approved ? USER_STATUS_APPROVED : USER_STATUS_PENDING;
  }
  delete context.data.approved;
  delete context.data.revoked;
  return context;
}

function formatUserExternal(context) {
  const process = (user) => {
    if (!context.params.provider) return user;
    // access_token is always hidden from external callers (even masked)
    delete user.access_token;
    user.status = resolveUserStatus(user);
    user.approved = isApprovedUser(user);
    delete user.revoked;
    user.invite_pending = Boolean(user.invite_token_hash);
    delete user.invite_token_hash;
    delete user.invite_expires_at;
    user.mcp_token_configured = Boolean(user.mcp_api_token);
    user.mcp_endpoint = MCP_HTTP_ENDPOINT;
    user.agent_preferences = parseCursorModelPrefsJson(user.agent_preferences);
    user.agent_default_model = parseAgentDefaultModelJson(user.agent_default_model);
    user.reviewer_default_model = parseAgentDefaultModelJson(user.reviewer_default_model);
    user.subagent_default_model = parseAgentDefaultModelJson(user.subagent_default_model);
    user.admin = !!user.admin;
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
  mcp_api_token: 'mcp_api_token_encrypted',
});

const decryptUserSecrets = decryptFields({
  access_token: 'access_token_encrypted',
  github_token: 'github_token_encrypted',
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

async function passkeyRegisterOptionsAfter(context) {
  if (context.method !== 'passkeyRegisterOptions' || !context.params.provider) return context;
  const challenge = context.result?.challenge;
  if (!challenge) return context;
  context.http = {
    ...context.http,
    headers: {
      ...(context.http?.headers || {}),
      'Set-Cookie': buildPasskeyChallengeSetCookie({
        challenge,
        purpose: 'register',
        userId: context.params.user.id,
      }),
    },
  };
  return context;
}

async function passkeyRegisterVerifyAfter(context) {
  if (context.method !== 'passkeyRegisterVerify' || !context.params.provider) return context;
  context.http = {
    ...context.http,
    headers: {
      ...(context.http?.headers || {}),
      'Set-Cookie': buildPasskeyChallengeClearCookie(),
    },
  };
  return context;
}

const usersHooks = {
  before: {
    all: [requireUser],
    find: [requireAdmin, orderByCreatedAt],
    get: [restrictGetToSelfOrAdmin],
    create: [
      requireAdmin,
      normalizeUserStatusWrite,
      normalizeColorSchemePatch,
      normalizeCursorModelPrefsPatch,
      encryptUserSecrets,
    ],
    remove: [requireAdmin, preventRemoveLastAdmin],
    approve: [requireAdmin],
    reject: [requireAdmin],
    setAdmin: [requireAdmin],
    invite: [requireAdmin],
    patch: [
      restrictPatchToSelf,
      stripPrivilegedFieldsFromExternalPatch,
      normalizeUserStatusWrite,
      normalizeColorSchemePatch,
      normalizeCursorModelPrefsPatch,
      normalizeUserAgentDefaultsPatch,
      clearGithubPickerCacheOnTokenPatch,
      encryptUserSecrets,
    ],
  },
  after: {
    find: [decryptUserSecrets, formatUserExternal],
    get: [decryptUserSecrets, formatUserExternal],
    create: [decryptUserSecrets, formatUserExternal],
    patch: [decryptUserSecrets, formatUserExternal],
    setAdmin: [decryptUserSecrets, formatUserExternal],
    passkeyRegisterOptions: [passkeyRegisterOptionsAfter],
    passkeyRegisterVerify: [passkeyRegisterVerifyAfter],
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
      'setAdmin',
      'invite',
      'generateMcpToken',
      'revokeMcpToken',
      'passkeyRegisterOptions',
      'passkeyRegisterVerify',
      'passkeyList',
      'passkeyRemove',
    ],
  });
  app.service(path).hooks(usersHooks);
}
