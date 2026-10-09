import { KnexService } from '@feathersjs/knex';
import { NotFound } from '@feathersjs/errors';
import { parseAgentDefaultModelJson } from '../../../shared/agent-default-model.js';
import { normalizeUserRepoAgentDefaultsPatch } from '../../services/user-agent-defaults.js';
import { requireUser, scopeByUser, only } from './hooks.js';

const WRITABLE_USER_REPO_FIELDS = [
  'agent_prompt',
  'review_prompt',
  'show_in_all_sessions',
  'agent_default_config_id',
  'agent_default_model',
  'reviewer_default_config_id',
  'reviewer_default_model',
];

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

function formatUserRepoExternal(context) {
  if (!context.params.provider) return context;
  const process = (row) => {
    row.agent_default_model = parseAgentDefaultModelJson(row.agent_default_model);
    row.reviewer_default_model = parseAgentDefaultModelJson(row.reviewer_default_model);
    return row;
  };
  if (Array.isArray(context.result)) {
    context.result = context.result.map(process);
  } else if (context.result) {
    context.result = process(context.result);
  }
  return context;
}

const userReposHooks = {
  before: {
    all: [requireUser, scopeByUser],
    patch: [
      requireOwnUserRepo,
      normalizeUserRepoAgentDefaultsPatch,
      only(WRITABLE_USER_REPO_FIELDS),
    ],
  },
  after: {
    all: [formatUserRepoExternal],
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
