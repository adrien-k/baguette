import { BadRequest, NotFound } from '@feathersjs/errors';
import { encryptFields, decryptFields, requireUser } from './hooks.js';
import { authTest, slackEventsUrl, slackRedirectUri } from '../slack.js';
import { decrypt, encrypt } from '../../lib/encrypt.js';

/**
 * Admin-level Slack apps (table: slack_apps). Each row is one Slack bot the workspace can post as.
 * The stored token is workspace-wide — Slack MCP tools post with it, not a per-user credential.
 */
class SlackAppsService {
  constructor(options) {
    this.options = options;
  }

  get db() {
    return this.options.Model;
  }

  async _row(id) {
    const row = await this.db('slack_apps').where({ id }).first();
    if (!row) throw new NotFound('Slack app not found');
    return row;
  }

  async find(_params) {
    return this.db('slack_apps').select().orderBy('name', 'asc');
  }

  async get(id, _params) {
    return this._row(id);
  }

  async create(data, _params) {
    const [id] = await this.db('slack_apps').insert(data);
    return this._row(id);
  }

  async patch(id, data, _params) {
    await this._row(id);
    if (Object.keys(data).length) {
      await this.db('slack_apps').where({ id }).update(data);
    }
    return this._row(id);
  }

  async remove(id, _params) {
    const row = await this._row(id);
    await this.db('slack_apps').where({ id }).delete();
    return row;
  }

  /** Connects a Slack user to a Baguette user (moving an existing link to the new account). */
  async linkUser({ slack_app_id: slackAppId, slack_user_id: slackUserId, user_id: userId }) {
    await this._row(slackAppId);
    const existing = await this.db('slack_user_links')
      .where({ slack_app_id: slackAppId, slack_user_id: slackUserId })
      .first();
    if (existing) {
      await this.db('slack_user_links').where({ id: existing.id }).update({ user_id: userId });
      return;
    }
    await this.db('slack_user_links').insert({
      slack_app_id: slackAppId,
      slack_user_id: slackUserId,
      user_id: userId,
    });
  }

  /** Stores who the bot is in its workspace, learned when Socket Mode connects. */
  async saveIdentity(id, { bot_user_id, team_id, team_name, api_app_id }) {
    const identity = { bot_user_id, team_id, team_name, api_app_id };
    const defined = Object.fromEntries(Object.entries(identity).filter(([, v]) => v !== undefined));
    if (!Object.keys(defined).length) return;
    await this.db('slack_apps').where({ id }).update(defined);
  }

  /** Stores what "Add to Slack" returned: the bot token and the workspace it belongs to. */
  async saveInstall(id, access) {
    await this._row(id);
    const now = new Date().toISOString();
    await this.db('slack_apps')
      .where({ id })
      .update({
        bot_token_encrypted: encrypt(access.botToken),
        bot_user_id: access.botUserId,
        api_app_id: access.apiAppId,
        team_id: access.teamId,
        team_name: access.teamName,
        installed_at: now,
        updated_at: now,
      });
  }

  /** Verifies a stored token against Slack and reports the workspace it belongs to. */
  async test(id, _params) {
    const row = await this._row(id);
    let botToken = null;
    if (row.bot_token_encrypted) {
      try {
        botToken = decrypt(row.bot_token_encrypted);
      } catch {
        botToken = null;
      }
    }
    if (!botToken) throw new BadRequest('No Slack bot token configured.');
    return authTest(botToken);
  }
}

function pickSlackAppFields(context) {
  const data = {};
  if (context.data.name !== undefined) {
    data.name = typeof context.data.name === 'string' ? context.data.name.trim() : '';
  }
  for (const field of ['bot_token', 'app_token', 'client_id', 'client_secret', 'signing_secret']) {
    if (context.data[field] !== undefined) data[field] = context.data[field];
  }
  if (typeof data.client_id === 'string') data.client_id = data.client_id.trim();
  context.data = data;
  return context;
}

function requireNameOnCreate(context) {
  if (!context.data.name) throw new BadRequest('name is required');
  return context;
}

/** A manual bot token, or the OAuth credentials that let "Add to Slack" mint one. */
function requireTokenOrOAuthCredentialsOnCreate(context) {
  const token = typeof context.data.bot_token === 'string' ? context.data.bot_token.trim() : '';
  if (token) {
    context.data.bot_token = token;
    return context;
  }
  delete context.data.bot_token;
  const { client_id, client_secret, signing_secret } = context.data;
  if (!client_id || !client_secret || !signing_secret) {
    throw new BadRequest(
      'Provide a bot_token, or client_id, client_secret and signing_secret to install via OAuth'
    );
  }
  return context;
}

/** OAuth-pending apps have no token until installed; the column is NOT NULL. */
function defaultEmptyBotToken(context) {
  if (context.data.bot_token_encrypted == null) context.data.bot_token_encrypted = '';
  return context;
}

function rejectEmptyBotToken(context) {
  if (context.data.bot_token === undefined) return context;
  const token = typeof context.data.bot_token === 'string' ? context.data.bot_token.trim() : '';
  if (!token) throw new BadRequest('bot_token cannot be empty');
  context.data.bot_token = token;
  return context;
}

async function requireUniqueName(context) {
  if (context.data.name === undefined) return context;
  if (!context.data.name) throw new BadRequest('name is required');
  const query = context.app.get('db')('slack_apps').where({ name: context.data.name });
  if (context.id != null) query.whereNot('id', context.id);
  if (await query.first()) {
    throw new BadRequest(`A Slack app named "${context.data.name}" already exists.`);
  }
  return context;
}

function touchTimestamps(context) {
  const now = new Date().toISOString();
  if (context.method === 'create') context.data.created_at = now;
  context.data.updated_at = now;
  return context;
}

const SECRET_FIELDS = {
  bot_token: 'bot_token_encrypted',
  app_token: 'app_token_encrypted',
  client_secret: 'client_secret_encrypted',
  signing_secret: 'signing_secret_encrypted',
};
const encryptToken = encryptFields(SECRET_FIELDS);
const decryptInternal = decryptFields(SECRET_FIELDS);

/**
 * Stored secrets never leave the server: external callers only learn whether each one is set
 * (`has_bot_token`, …). Server-side callers (the bot, Socket Mode) get the plaintext.
 */
function exposeSecrets(context) {
  if (!context.params.provider) return decryptInternal(context);
  const hide = (row) => {
    for (const [plain, encrypted] of Object.entries(SECRET_FIELDS)) {
      row[`has_${plain}`] = Boolean(row[encrypted]);
      delete row[encrypted];
      delete row[plain];
    }
  };
  if (Array.isArray(context.result)) context.result.forEach(hide);
  else if (context.result) hide(context.result);
  return context;
}

/** What the Slack app's settings page needs to point Slack at this server. */
function addInstallInfo(context) {
  const decorate = (row) => {
    row.events_url = slackEventsUrl();
    row.redirect_uri = slackRedirectUri();
    row.installed = Boolean(row.team_id);
  };
  if (Array.isArray(context.result)) context.result.forEach(decorate);
  else if (context.result) decorate(context.result);
  return context;
}

const slackHooks = {
  before: {
    all: [requireUser],
    create: [
      pickSlackAppFields,
      requireNameOnCreate,
      requireTokenOrOAuthCredentialsOnCreate,
      requireUniqueName,
      encryptToken,
      defaultEmptyBotToken,
      touchTimestamps,
    ],
    patch: [
      pickSlackAppFields,
      rejectEmptyBotToken,
      requireUniqueName,
      encryptToken,
      touchTimestamps,
    ],
  },
  after: {
    find: [exposeSecrets, addInstallInfo],
    get: [exposeSecrets, addInstallInfo],
    create: [exposeSecrets, addInstallInfo],
    patch: [exposeSecrets, addInstallInfo],
    remove: [exposeSecrets],
  },
};

export function registerSlackService(app, path = 'admin/slack') {
  app.use(path, new SlackAppsService({ Model: app.get('db') }), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'test'],
  });
  app.service(path).hooks(slackHooks);
  // Server-side calls get plaintext secrets, so no event of this service may ever reach a client.
  app.service(path).publish?.(() => null);
}
