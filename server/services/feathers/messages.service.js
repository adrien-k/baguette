import { KnexService } from '@feathersjs/knex';
import logger from '../../logger.js';
import { requireUser, scopeBySessionUser } from './hooks.js';
import { MESSAGES_PAGINATE } from '../../config.js';
import { assignTurnOnUserMessageCreate } from '../../../shared/turn-assignment.js';
import { scopeAgentDefaultFind, requireMessageIdentity } from './message-identity.js';
import { getAgentById } from '../agents-db.js';
import { primeReviewerUserMessageCreate } from '../reviewer-turn-prime.js';

/**
 * Messages service (table: session_messages). Scoped by session; access restricted to sessions owned by params.user.
 */
class MessagesService extends KnexService {}

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
      agent_id: context.data.agent_id,
      agent_sdk: context.data.agent_sdk,
      model: context.data.model,
      ...(context.data.model_params != null ? { model_params: context.data.model_params } : {}),
      ...(context.data.agent_config_id != null
        ? { agent_config_id: context.data.agent_config_id }
        : {}),
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

  const agentId = context.data.agent_id;
  const agent = agentId ? await getAgentById(db, agentId) : null;
  if (!agent) return context;

  const queueable =
    agent.status === 'running' || (agent.is_primary && session.status === 'provisioning');
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
  return assignTurnOnUserMessageCreate(context);
}

const messagesHooks = {
  before: {
    all: [requireUser, scopeAgentDefaultFind, scopeBySessionUser],
    create: [
      extractForceParam,
      requireMessageIdentity,
      assignTurn,
      queueIfRunning,
      (context) => primeReviewerUserMessageCreate(context.app, context),
    ],
  },
  after: {
    create: [afterCreateNotifySessions, afterCreateDispatchAgent],
  },
};
