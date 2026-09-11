import { KnexService } from '@feathersjs/knex';
import { requireUser, scopeBySessionUser } from './hooks.js';
import { MESSAGES_PAGINATE } from '../../config.js';

/**
 * Messages service (table: session_messages). Scoped by session; access restricted to sessions owned by params.user.
 */
export class MessagesService extends KnexService {}

export function registerMessagesService(app, path = 'messages') {
  const options = {
    Model: app.get('db'),
    name: 'session_messages',
    id: 'id',
    paginate: MESSAGES_PAGINATE,
  };
  app.use(path, new MessagesService(options));
  app.service(path).hooks(messagesHooks);
}

function extractForceParam(context) {
  if (context.data?.force) {
    context.params._force = true;
    delete context.data.force;
  }
  return context;
}

async function queueIfRunning(context) {
  if (!context.params?.provider || context.data?.type !== 'user') return context;
  if (context.params._force) return context;
  const db = context.app.get('db');
  const session = await db('sessions').where({ id: context.data.session_id }).first();
  if (!session || session.status !== 'running') return context;
  await context.app.service('queued-messages').create(
    { session_id: context.data.session_id, message_json: context.data.message_json },
    { user: context.params.user }
  );
  context.result = { queued: true };
  return context;
}

async function afterCreateNotifySessionsAndAgent(context) {
  if (!context.result || context.result.queued) return context;
  const message = context.params._force ? { ...context.result, force: true } : context.result;
  await context.app.service('sessions').onMessageCreated(message);
  const session = await context.app.get('db')('sessions').where({ id: message.session_id }).first();
  if (session?.agent_sdk === 'cursor') {
    await context.app.service('cursor-agent').onMessageCreated(message);
  } else {
    await context.app.service('claude-agent').onMessageCreated(message);
  }
  return context;
}

export const messagesHooks = {
  before: {
    all: [requireUser, scopeBySessionUser],
    create: [extractForceParam, queueIfRunning],
  },
  after: {
    create: [afterCreateNotifySessionsAndAgent],
  },
};
