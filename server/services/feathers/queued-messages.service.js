import { KnexService } from '@feathersjs/knex';
import { BadRequest, NotFound } from '@feathersjs/errors';
import { requireUser, scopeByUser, only, disableExternal } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';

export class QueuedMessagesService extends KnexService {
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
  await context.app.service('sessions').get(context.data.session_id, { user: context.params.user });
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
      only(['session_id', 'message_json']),
      validateSessionOwnership,
      normalizeInternalCreate,
      scopeByUser,
    ],
    schedule: [only(['session_id', 'message_json', 'send_at']), validateSessionOwnership],
    find: [scopeByUser],
    get: [scopeByUser],
    patch: [scopeByUser, requireOwnQueuedMessage, only(['message_json'])],
    remove: [scopeByUser],
  },
};
