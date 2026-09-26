import { KnexService } from '@feathersjs/knex';
import { NotFound } from '@feathersjs/errors';
import { requireUser, scopeByUser, encryptFields, decryptFields, only } from './hooks.js';

const WRITABLE_USER_REPO_FIELDS = [
  'anthropic_api_key',
  'cursor_api_key',
  'agent_prompt',
  'review_prompt',
  'show_in_all_sessions',
];

const USER_REPO_SECRETS = {
  anthropic_api_key: 'anthropic_api_key_encrypted',
  cursor_api_key: 'cursor_api_key_encrypted',
};

class UserReposService extends KnexService {}

/**
 * scopeByUser sets params.knex; @feathersjs/knex _patch then re-fetches with id $in but
 * _find ignores params.query when params.knex is set, so the post-patch find returns
 * all user_repos for the user (or wrong count) and throws NotFound. Same pattern as
 * requireOwnSession in sessions.service.js — verify ownership, then clear knex.
 */
async function requireOwnUserRepo(context) {
  if (context.method !== 'patch' || context.id == null) return context;
  const db = context.app.get('db');
  const userId = context.params.user?.id;
  const row = await db('user_repos').where({ id: context.id, user_id: userId }).first();
  if (!row) throw new NotFound('User repository link not found');
  delete context.params.knex;
  return context;
}

export const userReposHooks = {
  before: {
    all: [requireUser, scopeByUser],
    patch: [requireOwnUserRepo, only(WRITABLE_USER_REPO_FIELDS), encryptFields(USER_REPO_SECRETS)],
  },
  after: {
    find: [decryptFields(USER_REPO_SECRETS)],
    get: [decryptFields(USER_REPO_SECRETS)],
    patch: [decryptFields(USER_REPO_SECRETS)],
  },
};

export function registerUserReposService(app, path = 'user-repos') {
  const options = {
    Model: app.get('db'),
    name: 'user_repos',
    id: 'id',
    paginate: false,
  };
  app.use(path, new UserReposService(options), {
    methods: ['find', 'get', 'patch'],
  });
  app.service(path).hooks(userReposHooks);
}
