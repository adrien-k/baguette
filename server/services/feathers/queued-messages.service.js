import { KnexService } from '@feathersjs/knex';
import { BadRequest } from '@feathersjs/errors';
import { requireUser, scopeByUser, only, disableExternal } from './hooks.js';
import { DEFAULT_PAGINATE } from '../../config.js';

export class QueuedMessagesService extends KnexService {}

export function registerQueuedMessagesService(app, path = 'queued-messages') {
  const options = {
    Model: app.get('db'),
    name: 'queued_messages',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  app.use(path, new QueuedMessagesService(options));
  app.service(path).hooks(queuedMessagesHooks);
}

async function validateSessionOwnership(context) {
  if (!context.data.session_id) throw new BadRequest('session_id is required');
  await context.app
    .service('sessions')
    .get(context.data.session_id, { user: context.params.user });
  return context;
}

const queuedMessagesHooks = {
  before: {
    all: [requireUser],
    create: [disableExternal, only(['session_id', 'message_json']), validateSessionOwnership, scopeByUser],
    find: [scopeByUser],
    get: [scopeByUser],
    patch: [scopeByUser, only(['message_json'])],
    remove: [scopeByUser],
  },
};
