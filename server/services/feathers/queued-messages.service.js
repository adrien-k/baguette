import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from 'feathers/errors';
import { requireUser, scopeByUser, only, disableExternal } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import logger from '../../logger.js';
import { requireQueuedMessageIdentity } from './message-identity.js';
import { getPrimaryBuilderAgent } from '../agents-db.js';

const SCHEDULED_DISPATCH_BATCH = 20;

class QueuedMessagesService extends KnexService {
  setup(app) {
    this.app = app;
  }

  /**
   * Send queued_messages with kind=scheduled once send_at is due.
   * Called by LoopScheduler; not exposed as a REST method.
   */
  async runDue(nowMs = Date.now()) {
    const db = this.app.get('db');
    const due = await db('queued_messages')
      .where({ kind: 'scheduled' })
      .where('send_at', '<=', new Date(nowMs).toISOString())
      .orderBy('send_at', 'asc')
      .limit(SCHEDULED_DISPATCH_BATCH);

    for (const row of due) {
      // Atomic claim: overlapping ticks or multiple app instances may see the same row in
      // `due`; only one DELETE succeeds, so a transaction around read-then-delete is unnecessary.
      const claimed = await db('queued_messages').where({ id: row.id, kind: 'scheduled' }).delete();
      if (!claimed) continue;

      try {
        // messages.queueIfRunning only runs when params.provider is set. Use 'rest' so a
        // firing schedule behaves like the user clicking Send: if the turn is still running,
        // the message becomes a kind=turn queued row instead of starting a parallel agent.
        await this.app.service('messages').create(
          {
            session_id: row.session_id,
            type: 'user',
            message_json: row.message_json,
            agent_id: row.agent_id,
            agent_sdk: row.agent_sdk,
            model: row.model,
            ...(row.model_params != null ? { model_params: row.model_params } : {}),
            ...(row.agent_config_id != null ? { agent_config_id: row.agent_config_id } : {}),
          },
          { provider: 'rest', user: { id: row.user_id } }
        );
      } catch (err) {
        logger.error(
          { err, queuedId: row.id, sessionId: row.session_id },
          'Failed to send scheduled message after claim'
        );
      }
    }
  }

  /**
   * Schedule a user message to be sent at send_at (ISO timestamp).
   * Stored as kind=scheduled; dispatched by the server scheduler.
   */
  async schedule(data, params) {
    if (!data?.send_at) throw new BadRequest('send_at is required');
    const when = new Date(data.send_at);
    if (Number.isNaN(when.getTime())) throw new BadRequest('send_at must be a valid date');
    if (when.getTime() <= Date.now()) throw new BadRequest('send_at must be in the future');
    if (!data.session_id) throw new BadRequest('session_id is required');
    if (!data.message_json) throw new BadRequest('message_json is required');

    return this.create(
      {
        session_id: data.session_id,
        message_json: data.message_json,
        kind: 'scheduled',
        send_at: when.toISOString(),
        agent_id: data.agent_id,
        agent_sdk: data.agent_sdk,
        model: data.model,
        ...(data.model_params != null ? { model_params: data.model_params } : {}),
        ...(data.agent_config_id != null ? { agent_config_id: data.agent_config_id } : {}),
      },
      { user: params.user }
    );
  }
}

export function registerQueuedMessagesService(app, path = 'queued-messages') {
  const options = {
    Model: app.get('db'),
    name: 'queued_messages',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new QueuedMessagesService(options), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'schedule'],
  });
  app.service(path).hooks(queuedMessagesHooks);
}

async function validateSessionOwnership(context) {
  if (!context.data.session_id) throw new BadRequest('session_id is required');
  await context.app.service('sessions').get(context.data.session_id, {
    user: context.params.user,
  });
  const db = context.app.get('db');
  const sessionId = context.data.session_id;
  let agentRow = null;
  if (context.data.agent_id != null) {
    agentRow = await db('agents')
      .where({ id: context.data.agent_id, session_id: sessionId })
      .first();
    if (!agentRow) throw new BadRequest('Agent not found');
  } else {
    agentRow = await getPrimaryBuilderAgent(db, sessionId);
    if (agentRow) context.data.agent_id = agentRow.id;
  }
  if (context.data.agent_config_id == null && agentRow?.agent_config_id != null) {
    context.data.agent_config_id = agentRow.agent_config_id;
  }
  return context;
}

/**
 * scopeByUser sets params.knex; @feathersjs/knex _patch re-fetches with id $in but _find
 * ignores params.query when params.knex is set, so the post-patch find returns every row
 * for the user and throws NotFound when there is more than one queued message.
 */
async function requireOwnQueuedMessage(context) {
  if (context.method !== 'patch' || context.id == null) return context;
  const userId = context.params.user?.id;
  if (!userId) return context;
  const row = await context.app
    .get('db')('queued_messages')
    .where({ id: context.id, user_id: userId })
    .first();
  if (!row) throw new NotFound('Queued message not found');
  delete context.params.knex;
  return context;
}

async function normalizeInternalCreate(context) {
  if (context.params?.provider) return context;
  const kind = context.data.kind ?? 'turn';
  if (kind !== 'turn' && kind !== 'scheduled') {
    throw new BadRequest('Invalid queued message kind');
  }
  if (kind === 'scheduled' && !context.data.send_at) {
    throw new BadRequest('send_at is required for scheduled queued messages');
  }
  if (kind === 'turn') {
    context.data.send_at = null;
  }
  context.data.kind = kind;
  return context;
}

const queuedMessagesHooks = {
  before: {
    all: [requireUser],
    create: [
      disableExternal,
      only([
        'session_id',
        'message_json',
        'kind',
        'send_at',
        'model',
        'model_params',
        'agent_id',
        'agent_sdk',
        'agent_config_id',
      ]),
      validateSessionOwnership,
      normalizeInternalCreate,
      requireQueuedMessageIdentity,
      scopeByUser,
    ],
    schedule: [
      only([
        'session_id',
        'message_json',
        'send_at',
        'model',
        'model_params',
        'agent_id',
        'agent_sdk',
        'agent_config_id',
      ]),
      validateSessionOwnership,
    ],
    find: [scopeByUser],
    get: [scopeByUser],
    patch: [scopeByUser, requireOwnQueuedMessage, only(['message_json'])],
    remove: [scopeByUser],
  },
};
