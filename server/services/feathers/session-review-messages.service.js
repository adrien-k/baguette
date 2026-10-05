import { KnexService } from '@feathersjs/knex';
import { requireUser, scopeBySessionUser, disableExternal } from './hooks.js';
import { MESSAGES_PAGINATE } from '../../config.js';
import { assignTurnOnUserMessageCreate } from '../../../shared/turn-assignment.js';
import { dispatchCreatedMessageToAgents } from '../agent-message-dispatch.js';

/**
 * All chat and review messages live in the shared `session_messages` table,
 * differentiated by `agent_type` ('builder' | 'reviewer').
 */
export class SessionReviewMessagesService extends KnexService {}

/** Keep every method scoped to reviewer rows and stamp created rows. */
export function scopeAgentType(agentType) {
  return (context) => {
    if (context.method === 'create') {
      if (context.data) context.data.agent_type = agentType;
      return context;
    }
    // patch/update/remove: feathers-knex filters these by id through params.query
    // and ignores params.query when params.knex is set, so scope via the query.
    if (context.method === 'patch' || context.method === 'update' || context.method === 'remove') {
      context.params.query = { ...context.params.query, agent_type: agentType };
      return context;
    }
    // Chain onto the session-user scoping builder when present.
    const base = context.params.knex
      ? context.params.knex.clone()
      : context.service.createQuery(context.params);
    context.params.knex = base.andWhere('agent_type', agentType);
    return context;
  };
}

export function registerSessionReviewMessagesService(app, path = 'session-review-messages') {
  const options = {
    Model: app.get('db'),
    name: 'session_messages',
    id: 'id',
    paginate: MESSAGES_PAGINATE,
  };
  app.use(path, new SessionReviewMessagesService(options));
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser, scopeAgentType('reviewer')],
      create: [disableExternal, (context) => assignTurnOnUserMessageCreate(context, 'review')],
      patch: [disableExternal],
      remove: [disableExternal],
    },
    after: {
      create: [
        async (context) => {
          if (context.result) {
            await dispatchCreatedMessageToAgents(
              context.app,
              context.result,
              'session-review-messages'
            );
          }
          return context;
        },
      ],
    },
  });
}
