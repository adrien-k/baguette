import { BadRequest, NotFound } from '@feathersjs/errors';
import { encryptFields, decryptFields, requireUser } from './hooks.js';
import { authTest } from '../slack.js';
import { decrypt } from '../../lib/encrypt.js';

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
  if (context.data.bot_token !== undefined) data.bot_token = context.data.bot_token;
  context.data = data;
  return context;
}

function requireNameOnCreate(context) {
  if (!context.data.name) throw new BadRequest('name is required');
  return context;
}

function requireBotTokenOnCreate(context) {
  const token = typeof context.data.bot_token === 'string' ? context.data.bot_token.trim() : '';
  if (!token) throw new BadRequest('bot_token is required');
  context.data.bot_token = token;
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

const encryptToken = encryptFields({ bot_token: 'bot_token_encrypted' });
const decryptToken = decryptFields({ bot_token: 'bot_token_encrypted' });

export const slackHooks = {
  before: {
    all: [requireUser],
    create: [
      pickSlackAppFields,
      requireNameOnCreate,
      requireBotTokenOnCreate,
      requireUniqueName,
      encryptToken,
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
    find: [decryptToken],
    get: [decryptToken],
    create: [decryptToken],
    patch: [decryptToken],
    remove: [decryptToken],
  },
};

export function registerSlackService(app, path = 'admin/slack') {
  app.use(path, new SlackAppsService({ Model: app.get('db') }), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'test'],
  });
  app.service(path).hooks(slackHooks);
}
