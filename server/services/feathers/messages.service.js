import { KnexService } from '@feathersjs/knex';
import { requireUser, scopeBySessionUser } from './hooks.js';
import { MESSAGES_PAGINATE } from '../../config.js';
import { attachSessionTurnModelFields, turnModelCreateFields } from '../../../shared/turn-model.js';
import { assignTurnOnUserMessageCreate } from '../../../shared/turn-assignment.js';
import { dispatchCreatedMessageToAgents } from '../agent-message-dispatch.js';
import { scopeAgentType } from './session-review-messages.service.js';

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

async function snapshotSessionModelOnUserMessage(context) {
  const data = context.data;
  if (!data?.session_id || data.type !== 'user') return context;
  const session = await context.app.get('db')('sessions').where({ id: data.session_id }).first();
  if (!session) return context;
  attachSessionTurnModelFields(data, session);
  return context;
}

async function queueTurnMessage(context) {
  await context.app.service('queued-messages').create(
    {
      session_id: context.data.session_id,
      message_json: context.data.message_json,
      kind: 'turn',
      ...turnModelCreateFields(context.data),
    },
    { user: context.params.user }
  );
  context.result = { queued: true };
  return context;
}

async function queueIfRunning(context) {
  if (!context.params?.provider || context.data?.type !== 'user') return context;
  const db = context.app.get('db');
  const session = await db('sessions').where({ id: context.data.session_id }).first();
  if (!session) return context;

  if (context.params._force) return context;
  // Queue while the agent is mid-turn, and while the worktree is still being created
  // so a prompt typed immediately after create is not dispatched with no cwd.
  const queueable = session.status === 'running' || session.status === 'provisioning';
  if (!queueable) return context;
  return queueTurnMessage(context);
}

async function afterCreateNotifySessions(context) {
  if (!context.result || context.result.queued) return context;
  const message = context.params._force ? { ...context.result, force: true } : context.result;
  await context.app.service('sessions').onMessageCreated(message);
  return context;
}

async function afterCreateDispatchAgents(context) {
  if (!context.result || context.result.queued) return context;
  await dispatchCreatedMessageToAgents(context.app, context.result, 'messages');
  return context;
}

async function assignChatTurn(context) {
  return assignTurnOnUserMessageCreate(context, 'chat');
}

export const messagesHooks = {
  before: {
    all: [requireUser, scopeBySessionUser, scopeAgentType('builder')],
    create: [extractForceParam, assignChatTurn, snapshotSessionModelOnUserMessage, queueIfRunning],
  },
  after: {
    create: [afterCreateNotifySessions, afterCreateDispatchAgents],
  },
};
