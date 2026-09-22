import { KnexService } from '@feathersjs/knex';
import { NotAuthenticated } from '@feathersjs/errors';
import { requireUser, encryptFields, decryptFields } from './hooks.js';
import { SYSTEM_ALLOWED_COMMANDS } from '../../services/agent-settings.js';
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
}

async function orderByCreatedAt(context) {
  const query = context.service.createQuery(context.params);
  context.params.knex = query.orderBy('created_at', 'desc');
  return context;
}

function encryptAllowedCommands(context) {
  if (context.data.allowed_commands !== undefined) {
    context.data.allowed_commands = JSON.stringify(
      Array.isArray(context.data.allowed_commands) ? context.data.allowed_commands : []
    );
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

// Non-secret fields only visible externally + parsed allowed_commands
function formatUserExternal(context) {
  if (!context.params.provider) return context;
  const process = (user) => {
    // access_token is always hidden from external callers (even masked)
    delete user.access_token;
    user.allowed_commands = user.allowed_commands ? JSON.parse(user.allowed_commands) : [];
    user.agent_preferences = parseCursorModelPrefsJson(user.agent_preferences);
    user.system_allowed_commands = SYSTEM_ALLOWED_COMMANDS;
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
});

const decryptUserSecrets = decryptFields({
  access_token: 'access_token_encrypted',
  anthropic_api_key: 'anthropic_api_key_encrypted',
  cursor_api_key: 'cursor_api_key_encrypted',
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
    create: [encryptAllowedCommands, normalizeCursorModelPrefsPatch, encryptUserSecrets],
    patch: [
      restrictPatchToSelf,
      encryptAllowedCommands,
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
    methods: ['find', 'get', 'create', 'patch', 'remove', 'approve', 'reject'],
  });
  app.service(path).hooks(usersHooks);
}
