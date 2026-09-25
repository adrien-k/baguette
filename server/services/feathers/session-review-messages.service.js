import { KnexService } from '@feathersjs/knex';
import { requireUser, scopeBySessionUser, disableExternal } from './hooks.js';
import { MESSAGES_PAGINATE } from '../../config.js';

export class SessionReviewMessagesService extends KnexService {}

export function registerSessionReviewMessagesService(app, path = 'session-review-messages') {
  const options = {
    Model: app.get('db'),
    name: 'session_review_messages',
    id: 'id',
    paginate: MESSAGES_PAGINATE,
  };
  app.use(path, new SessionReviewMessagesService(options));
  app.service(path).hooks({
    before: {
      all: [requireUser, scopeBySessionUser],
      create: [disableExternal],
      patch: [disableExternal],
      remove: [disableExternal],
    },
  });
}
