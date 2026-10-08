import { KnexService } from '@feathersjs/knex';
import logger from '../../logger.js';
import { requireUser, scopeBySessionUser } from './hooks.js';
import { MESSAGES_PAGINATE } from '../../config.js';
import { assignTurnOnUserMessageCreate } from '../../../shared/turn-assignment.js';
import { scopeAgentTypeDefaultFind, requireMessageIdentity } from './message-identity.js';

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

async function queueTurnMessage(context) {
  await context.app.service('queued-messages').create(
    {
      session_id: context.data.session_id,
      message_json: context.data.message_json,
      kind: 'turn',
      agent_type: context.data.agent_type,
      agent_sdk: context.data.agent_sdk,
      model: context.data.model,
      ...(context.data.model_params != null ? { model_params: context.data.model_params } : {}),
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

  const agentType = context.data.agent_type === 'reviewer' ? 'reviewer' : 'builder';
  const queueable =
    agentType === 'reviewer'
      ? session.review_status === 'running'
      : session.status === 'running' || session.status === 'provisioning';
  if (!queueable) return context;
  return queueTurnMessage(context);
}

async function afterCreateNotifySessions(context) {
  if (!context.result || context.result.queued) return context;
  const message = context.params._force ? { ...context.result, force: true } : context.result;
  await context.app.service('sessions').onMessageCreated(message);
  return context;
}

async function afterCreateDispatchAgent(context) {
  if (!context.result || context.result.queued) return context;
  if (context.result.type !== 'user') return context;
  if (context.params._skipAgentDispatch) return context;
  if (!context.app.services?.['agent-configs']) return context;
  const row = context.params._force ? { ...context.result, force: true } : context.result;
  try {
    await context.app.service('agent-configs').dispatchCreatedMessage(row);
  } catch (err) {
    logger.error(
      { err: err.message, sessionId: row.session_id },
      'Failed to dispatch user message to agent SDK'
    );
  }
  return context;
}

async function assignTurn(context) {
  const channel = context.data?.agent_type === 'reviewer' ? 'review' : 'chat';
  return assignTurnOnUserMessageCreate(context, channel);
}

export const messagesHooks = {
  before: {
    all: [requireUser, scopeAgentTypeDefaultFind, scopeBySessionUser],
    create: [extractForceParam, requireMessageIdentity, assignTurn, queueIfRunning],
  },
  after: {
    create: [afterCreateNotifySessions, afterCreateDispatchAgent],
  },
};
